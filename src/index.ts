/**
 * @relayplane/proxy
 *
 * RelayPlane Agent Ops Proxy Server
 *
 * Intelligent AI model routing with integrated observability.
 * This is a standalone proxy that routes requests to optimal models
 * based on task type and cost optimization.
 *
 * @example
 * ```typescript
 * import { startProxy } from '@relayplane/proxy';
 *
 * // Start the proxy server
 * await startProxy({ port: 3001 });
 * ```
 *
 * @packageDocumentation
 */

// Standalone proxy (requires only @relayplane/core)
export { startProxy } from './standalone-proxy.js';
export type { ProxyConfig } from './standalone-proxy.js';

// Configuration
export {
  loadConfig,
  saveConfig,
  updateConfig,
  isFirstRun,
  markFirstRunComplete,
  isTelemetryEnabled,
  enableTelemetry,
  disableTelemetry,
  getDeviceId,
  setApiKey,
  getApiKey,
  getConfigDir,
  getConfigPath,
} from './config.js';
export type { ProxyConfig as ProxyLocalConfig } from './config.js';

// Telemetry
export {
  recordTelemetry,
  inferTaskType,
  estimateCost,
  setAuditMode,
  isAuditMode,
  setOfflineMode,
  isOfflineMode,
  getAuditBuffer,
  clearAuditBuffer,
  getLocalTelemetry,
  getTelemetryStats,
  clearTelemetry,
  getTelemetryPath,
  printTelemetryDisclosure,
} from './telemetry.js';
export type { TelemetryEvent } from './telemetry.js';

// Re-export core types
export type { Provider, TaskType } from '@relayplane/core';

// Note: Advanced features (ProxyServer, streaming, etc.) require additional
// dependencies. Install @relayplane/ledger, @relayplane/auth-gate, etc.
// for full functionality. See documentation for details.
