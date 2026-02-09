/**
 * Swarm API Client
 * 
 * Calls the RelayPlane Swarm API for intelligent routing decisions.
 * Only used for Pro/Trial users with valid API keys.
 * 
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { getConfigDir } from './config.js';
import { inferTaskType, isOfflineMode } from './telemetry.js';

const BRAIN_API_URL = process.env.RELAYPLANE_API_URL || 'https://api.relayplane.com';
const BRAIN_TIMEOUT_MS = 5000; // 5 second timeout for Brain calls

/**
 * Route request to Swarm API
 */
export interface BrainRouteRequest {
  taskType: string;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  requiresVision?: boolean;
  requiresToolUse?: boolean;
  requiresThinking?: boolean;
  currentModel?: string;
  prioritizeSpeed?: boolean;
  prioritizeQuality?: boolean;
}

/**
 * Route response from Swarm API
 */
export interface BrainRouteResponse {
  success: boolean;
  recommendedModel: string;
  confidence: number;
  estimatedCostUsd: number;
  staticWouldChoose: string;
  staticCostUsd: number;
  savingsUsd: number;
  explanation: {
    reason: string;
    factors: Array<{
      name: string;
      value: string;
      impact: 'positive' | 'negative' | 'neutral';
      weight: number;
    }>;
    networkData?: {
      similarTaskSuccessRate: number;
      totalSimilarTasks: number;
    };
  };
  processingTimeMs: number;
}

/**
 * Check if user has Brain access (Pro API key)
 */
export function hasBrainAccess(): boolean {
  if (isOfflineMode()) return false;
  
  const apiKey = getApiKey();
  if (!apiKey) return false;
  
  // Pro keys start with 'rp_live_' or 'rp_trial_'
  return apiKey.startsWith('rp_live_') || apiKey.startsWith('rp_trial_');
}

/**
 * Get configured API key
 */
export function getApiKey(): string | null {
  try {
    const configPath = path.join(getConfigDir(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.apiKey || null;
    }
  } catch (err) {
    // Ignore config read errors
  }
  return process.env.RELAYPLANE_API_KEY || null;
}

/**
 * Set API key
 */
export function setApiKey(apiKey: string): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const configPath = path.join(configDir, 'config.json');
  let config: Record<string, unknown> = {};
  
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    // Start fresh
  }
  
  config.apiKey = apiKey;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get routing recommendation from Swarm API
 * 
 * Falls back to static routing if Brain is unavailable.
 */
export async function getRouteRecommendation(
  request: BrainRouteRequest
): Promise<BrainRouteResponse | null> {
  if (!hasBrainAccess()) {
    return null;
  }
  
  const apiKey = getApiKey();
  if (!apiKey) return null;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
    
    const response = await fetch(`${BRAIN_API_URL}/v1/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      // Brain unavailable - fall back to static
      console.warn(`[Brain] Route request failed: ${response.status}`);
      return null;
    }
    
    const result = await response.json() as BrainRouteResponse;
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[Brain] Route request timed out');
    } else {
      console.warn('[Brain] Route request failed:', err);
    }
    return null;
  }
}

/**
 * Get routing recommendation for a request
 * 
 * Analyzes the request and calls Swarm API to get the optimal model.
 */
export async function getBrainRouting(
  inputTokens: number,
  outputTokens: number,
  currentModel: string,
  hasTools: boolean = false,
  hasVision: boolean = false
): Promise<{ model: string; reason: string; isBrain: boolean }> {
  // Infer task type
  const taskType = inferTaskType(inputTokens, outputTokens, currentModel, hasTools);
  
  // Try Swarm API
  const brainResponse = await getRouteRecommendation({
    taskType,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    requiresVision: hasVision,
    requiresToolUse: hasTools,
    currentModel,
  });
  
  if (brainResponse && brainResponse.success) {
    return {
      model: brainResponse.recommendedModel,
      reason: brainResponse.explanation.reason,
      isBrain: true,
    };
  }
  
  // Fall back to static routing
  return {
    model: currentModel,
    reason: 'Static routing (Brain unavailable)',
    isBrain: false,
  };
}

/**
 * Get provider status from Swarm API
 */
export async function getProviderStatus(): Promise<Array<{
  provider: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyP50Ms: number;
  latencyP99Ms: number;
  successRate: number;
}> | null> {
  if (!hasBrainAccess()) {
    return null;
  }
  
  const apiKey = getApiKey();
  if (!apiKey) return null;
  
  try {
    const response = await fetch(`${BRAIN_API_URL}/v1/status`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const result = await response.json();
    return result.providers || null;
  } catch (err) {
    return null;
  }
}
