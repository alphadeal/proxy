/**
 * RelayPlane Main Class
 *
 * The main entry point for the agent optimization layer.
 *
 * @packageDocumentation
 */

import { Store, getDefaultDbPath } from './storage/index.js';
import { RoutingEngine } from './routing/index.js';
import { OutcomeRecorder } from './learning/outcomes.js';
import { PatternDetector } from './learning/patterns.js';
import { calculateCost, calculateSavings, type SavingsReport } from './learning/savings.js';
import type {
  RelayPlaneConfig,
  RunInput,
  RunResult,
  OutcomeInput,
  Outcome,
  Stats,
  Suggestion,
  TaskType,
  Provider,
  ProviderConfig,
} from './types.js';

// Type-only import for adapters to avoid runtime dependency if not used
type ModelAdapter = {
  execute(args: {
    model: string;
    input: any;
    apiKey: string;
    baseUrl?: string;
  }): Promise<{
    success: boolean;
    output?: any;
    error?: { message: string };
    durationMs: number;
    tokensIn?: number;
    tokensOut?: number;
  }>;
};

/**
 * RelayPlane - Agent Optimization Layer
 *
 * Provides intelligent routing, outcome tracking, and learning for AI model selection.
 *
 * @example Basic usage
 * ```typescript
 * import { RelayPlane } from '@relayplane/core';
 *
 * const relay = new RelayPlane();
 *
 * // Run a task - automatically infers type and routes to best model
 * const result = await relay.run({
 *   prompt: 'Review this code for bugs...',
 * });
 *
 * // Record the outcome for learning
 * await relay.recordOutcome(result.runId, { success: true, quality: 'good' });
 *
 * // Get suggestions for routing improvements
 * const suggestions = await relay.getSuggestions();
 * ```
 */
export class RelayPlane {
  private store: Store;
  private _routing: RoutingEngine;
  private outcomeRecorder: OutcomeRecorder;
  private patternDetector: PatternDetector;
  private config: RelayPlaneConfig;
  private adapterRegistry: any | null = null;

  /**
   * Creates a new RelayPlane instance.
   *
   * @param config - Configuration options
   */
  constructor(config: RelayPlaneConfig = {}) {
    this.config = {
      dbPath: config.dbPath ?? getDefaultDbPath(),
      defaultProvider: config.defaultProvider ?? 'local',
      defaultModel: config.defaultModel ?? 'llama3.2',
      providers: config.providers ?? {},
    };

    // Initialize storage
    this.store = new Store(this.config.dbPath);

    // Initialize components
    this._routing = new RoutingEngine(this.store);
    this.outcomeRecorder = new OutcomeRecorder(this.store);
    this.patternDetector = new PatternDetector(this.store);
  }

  /**
   * Gets the routing engine for direct access.
   */
  get routing(): RoutingEngine {
    return this._routing;
  }

  /**
   * Runs a prompt through the appropriate model.
   *
   * @param input - The run input
   * @returns The run result
   */
  async run(input: RunInput): Promise<RunResult> {
    const startTime = Date.now();

    // Resolve routing
    const resolved = this._routing.resolve(input.prompt, input.taskType, input.model);

    // Get the adapter
    const adapter = await this.getAdapter(resolved.provider as Provider);
    if (!adapter) {
      // No adapter available - record and return error
      const runId = this.store.recordRun({
        prompt: input.prompt,
        systemPrompt: input.systemPrompt ?? null,
        taskType: resolved.taskType,
        model: resolved.model,
        success: false,
        output: null,
        error: `No adapter configured for provider: ${resolved.provider}`,
        durationMs: Date.now() - startTime,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });

      return {
        runId,
        success: false,
        error: `No adapter configured for provider: ${resolved.provider}`,
        taskType: resolved.taskType,
        model: resolved.model,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    // Get API key for the provider
    const providerConfig = this.config.providers?.[resolved.provider as Provider];
    const apiKey = providerConfig?.apiKey ?? this.getEnvApiKey(resolved.provider as Provider);

    // Build the full prompt
    const fullInput = input.systemPrompt
      ? `${input.systemPrompt}\n\n${input.prompt}`
      : input.prompt;

    // Execute the adapter
    const result = await adapter.execute({
      model: resolved.modelName,
      input: fullInput,
      apiKey: apiKey ?? '',
      baseUrl: providerConfig?.baseUrl,
    });

    const durationMs = Date.now() - startTime;

    // Calculate cost based on tokens
    const tokensIn = result.tokensIn ?? 0;
    const tokensOut = result.tokensOut ?? 0;
    const costUsd = calculateCost(resolved.model, tokensIn, tokensOut);

    // Record the run
    const runId = this.store.recordRun({
      prompt: input.prompt,
      systemPrompt: input.systemPrompt ?? null,
      taskType: resolved.taskType,
      model: resolved.model,
      success: result.success,
      output: result.output ?? null,
      error: result.error?.message ?? null,
      durationMs,
      tokensIn: result.tokensIn ?? null,
      tokensOut: result.tokensOut ?? null,
      costUsd: costUsd > 0 ? costUsd : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });

    return {
      runId,
      success: result.success,
      output: result.output,
      error: result.error?.message,
      taskType: resolved.taskType,
      model: resolved.model,
      durationMs,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Gets an adapter for a provider.
   * Note: In the standalone proxy package, adapters are not used.
   * The proxy handles provider calls directly via HTTP.
   */
  private async getAdapter(_provider: Provider): Promise<ModelAdapter | null> {
    // Adapters not available in standalone proxy package
    // The proxy handles all provider calls directly
    return null;
  }

  /**
   * Gets an API key from environment variables.
   */
  private getEnvApiKey(provider: Provider): string | undefined {
    const envVars: Record<Provider, string> = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_API_KEY',
      xai: 'XAI_API_KEY',
      moonshot: 'MOONSHOT_API_KEY',
      local: '',
    };

    const envVar = envVars[provider];
    return envVar ? process.env[envVar] : undefined;
  }

  /**
   * Records an outcome for a run.
   *
   * @param runId - The run ID
   * @param outcome - The outcome details
   * @returns The recorded outcome
   */
  recordOutcome(runId: string, outcome: Omit<OutcomeInput, 'runId'>): Outcome {
    return this.outcomeRecorder.record({
      runId,
      ...outcome,
    });
  }

  /**
   * Gets an outcome for a run.
   *
   * @param runId - The run ID
   * @returns The outcome, or null if not found
   */
  getOutcome(runId: string): Outcome | null {
    return this.outcomeRecorder.get(runId);
  }

  /**
   * Gets statistics for runs.
   *
   * @param options - Optional filters
   * @returns Statistics object
   */
  stats(options?: { from?: string; to?: string }): Stats {
    const raw = this.store.getStats(options);

    // Build stats by task type
    const byTaskType: Stats['byTaskType'] = {} as Stats['byTaskType'];
    const taskTypes: TaskType[] = [
      'code_generation',
      'code_review',
      'summarization',
      'analysis',
      'creative_writing',
      'data_extraction',
      'translation',
      'question_answering',
      'general',
    ];

    for (const taskType of taskTypes) {
      const taskStats = raw.byTaskType[taskType];
      byTaskType[taskType] = {
        taskType,
        totalRuns: taskStats?.runs ?? 0,
        successfulRuns: Math.round((taskStats?.runs ?? 0) * (taskStats?.successRate ?? 0)),
        successRate: taskStats?.successRate ?? 0,
        avgDurationMs: taskStats?.avgDurationMs ?? 0,
        byModel: {},
      };
    }

    // Add model breakdown
    for (const [model, modelStats] of Object.entries(raw.byModel)) {
      // Find which task type this model belongs to (simplified - assumes model is used for one task type)
      // In a real implementation, we'd query runs grouped by task type AND model
      for (const taskType of taskTypes) {
        if (!byTaskType[taskType].byModel[model]) {
          byTaskType[taskType].byModel[model] = {
            runs: 0,
            successRate: 0,
            avgDurationMs: 0,
          };
        }
      }
    }

    return {
      totalRuns: raw.totalRuns,
      overallSuccessRate: raw.totalRuns > 0 ? raw.successfulRuns / raw.totalRuns : 0,
      byTaskType,
      period: {
        from: options?.from ?? '',
        to: options?.to ?? new Date().toISOString(),
      },
    };
  }

  /**
   * Gets a savings report.
   *
   * @param days - Number of days to include (default: 30)
   * @returns Savings report
   */
  savingsReport(days: number = 30): SavingsReport {
    return calculateSavings(this.store, days);
  }

  /**
   * Gets routing improvement suggestions.
   *
   * @returns Array of suggestions
   */
  getSuggestions(): Suggestion[] {
    // Get pending suggestions from the database
    const pending = this.store.getPendingSuggestions();

    return pending.map((record) => ({
      id: record.id,
      taskType: record.taskType,
      currentModel: record.currentModel,
      suggestedModel: record.suggestedModel,
      reason: record.reason,
      confidence: record.confidence,
      expectedImprovement: JSON.parse(record.expectedImprovement),
      sampleCount: record.sampleCount,
      createdAt: record.createdAt,
      accepted: record.accepted ?? undefined,
      acceptedAt: record.acceptedAt ?? undefined,
    }));
  }

  /**
   * Generates new suggestions based on current data.
   *
   * @returns Array of newly generated suggestions
   */
  generateSuggestions(): Suggestion[] {
    return this.patternDetector.generateSuggestions();
  }

  /**
   * Accepts a suggestion and updates routing.
   *
   * @param suggestionId - The suggestion ID to accept
   * @returns True if successful
   */
  acceptSuggestion(suggestionId: string): boolean {
    return this.store.acceptSuggestion(suggestionId);
  }

  /**
   * Rejects a suggestion.
   *
   * @param suggestionId - The suggestion ID to reject
   * @returns True if successful
   */
  rejectSuggestion(suggestionId: string): boolean {
    return this.store.rejectSuggestion(suggestionId);
  }

  /**
   * Closes the RelayPlane instance and releases resources.
   */
  close(): void {
    this.store.close();
  }
}
