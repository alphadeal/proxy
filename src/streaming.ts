/**
 * Streaming Support for RelayPlane Proxy
 *
 * Provides SSE (Server-Sent Events) streaming for LLM responses
 * and real-time updates.
 *
 * @packageDocumentation
 */

import type { ServerResponse } from 'node:http';

/**
 * SSE message structure
 */
export interface SSEMessage {
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

/**
 * Stream writer for SSE responses
 */
export class SSEWriter {
  private response: ServerResponse;
  private closed = false;

  constructor(response: ServerResponse) {
    this.response = response;

    // Set SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Handle client disconnect
    response.on('close', () => {
      this.closed = true;
    });
  }

  /**
   * Write an SSE message
   */
  write(message: SSEMessage): boolean {
    if (this.closed) return false;

    const lines: string[] = [];

    if (message.event) {
      lines.push(`event: ${message.event}`);
    }

    if (message.id) {
      lines.push(`id: ${message.id}`);
    }

    if (message.retry !== undefined) {
      lines.push(`retry: ${message.retry}`);
    }

    // Data can be multi-line, each line needs data: prefix
    const dataStr = typeof message.data === 'string'
      ? message.data
      : JSON.stringify(message.data);

    for (const line of dataStr.split('\n')) {
      lines.push(`data: ${line}`);
    }

    lines.push(''); // Empty line to end message
    lines.push('');

    try {
      this.response.write(lines.join('\n'));
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  /**
   * Write a data-only message (convenience method)
   */
  writeData(data: unknown): boolean {
    return this.write({ data });
  }

  /**
   * Send a comment (keep-alive)
   */
  comment(text: string): boolean {
    if (this.closed) return false;
    try {
      this.response.write(`: ${text}\n\n`);
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  /**
   * Close the stream
   */
  close(): void {
    if (!this.closed) {
      this.write({ data: '[DONE]' });
      this.response.end();
      this.closed = true;
    }
  }

  /**
   * Check if stream is still open
   */
  isOpen(): boolean {
    return !this.closed;
  }
}

/**
 * Create an SSE writer
 */
export function createSSEWriter(response: ServerResponse): SSEWriter {
  return new SSEWriter(response);
}

/**
 * Stream a provider response to SSE
 */
export async function streamProviderResponse(
  providerUrl: string,
  request: unknown,
  headers: Record<string, string>,
  writer: SSEWriter,
  callbacks?: {
    onChunk?: (chunk: unknown) => void;
    onComplete?: (fullResponse: unknown) => void;
    onError?: (error: Error) => void;
  }
): Promise<{ success: boolean; chunks: unknown[]; ttftMs?: number }> {
  const chunks: unknown[] = [];
  let ttftMs: number | undefined;
  const startTime = Date.now();

  try {
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = new Error(`Provider returned ${response.status}`);
      callbacks?.onError?.(error);
      writer.write({
        event: 'error',
        data: { error: { message: error.message, status: response.status } },
      });
      writer.close();
      return { success: false, chunks };
    }

    if (!response.body) {
      const error = new Error('No response body');
      callbacks?.onError?.(error);
      writer.close();
      return { success: false, chunks };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (ttftMs === undefined) {
        ttftMs = Date.now() - startTime;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            chunks.push(parsed);
            callbacks?.onChunk?.(parsed);

            // Forward to client
            if (!writer.write({ data: parsed })) {
              // Client disconnected
              return { success: false, chunks, ttftMs };
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          chunks.push(parsed);
          callbacks?.onChunk?.(parsed);
          writer.write({ data: parsed });
        } catch {
          // Invalid JSON
        }
      }
    }

    callbacks?.onComplete?.(chunks);
    writer.close();

    return { success: true, chunks, ttftMs };
  } catch (error) {
    callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
    writer.write({
      event: 'error',
      data: { error: { message: error instanceof Error ? error.message : 'Stream error' } },
    });
    writer.close();
    return { success: false, chunks, ttftMs };
  }
}

/**
 * Aggregate streaming chunks into a complete response
 */
export function aggregateStreamingResponse(chunks: unknown[]): {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
  finish_reason?: string;
} {
  let content = '';
  let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
  let model: string | undefined;
  let finish_reason: string | undefined;

  for (const chunk of chunks) {
    if (typeof chunk !== 'object' || chunk === null) continue;

    const c = chunk as Record<string, unknown>;

    // Extract model
    if (c.model && typeof c.model === 'string') {
      model = c.model;
    }

    // Extract content from choices
    if (Array.isArray(c.choices) && c.choices.length > 0) {
      const choice = c.choices[0] as Record<string, unknown>;

      // Delta content (streaming)
      if (choice.delta && typeof choice.delta === 'object') {
        const delta = choice.delta as Record<string, unknown>;
        if (typeof delta.content === 'string') {
          content += delta.content;
        }
      }

      // Finish reason
      if (choice.finish_reason && typeof choice.finish_reason === 'string') {
        finish_reason = choice.finish_reason;
      }
    }

    // Extract usage (usually in last chunk)
    if (c.usage && typeof c.usage === 'object') {
      const u = c.usage as Record<string, unknown>;
      if (
        typeof u.prompt_tokens === 'number' &&
        typeof u.completion_tokens === 'number'
      ) {
        usage = {
          prompt_tokens: u.prompt_tokens,
          completion_tokens: u.completion_tokens,
          total_tokens: (u.total_tokens as number) ?? u.prompt_tokens + u.completion_tokens,
        };
      }
    }
  }

  return { content, usage, model, finish_reason };
}

/**
 * Keep-alive ping for long-running streams
 */
export function startKeepAlive(
  writer: SSEWriter,
  intervalMs = 15000
): () => void {
  const timer = setInterval(() => {
    if (!writer.isOpen()) {
      clearInterval(timer);
      return;
    }
    writer.comment('ping');
  }, intervalMs);

  return () => clearInterval(timer);
}
