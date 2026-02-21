/**
 * Type stubs for internal monorepo packages.
 * These allow the proxy to build in isolation (CI) when these packages
 * are not available. When the full monorepo is built, the real types
 * from the packages take precedence.
 */

declare module '@relayplane/ledger' {
  export type AuthEnforcementMode = 'permissive' | 'strict' | 'recommended' | string;
  export type ExecutionMode = string;
  export type AuthType = string;
  export interface LedgerStorage {}
  export interface Ledger {
    recordPolicyEvaluation(runId: string, policies: any[]): Promise<void>;
    recordRouting(runId: string, data: any): Promise<void>;
    completeRun(runId: string, data: any): Promise<void>;
    [key: string]: any;
  }
  export function createLedger(...args: any[]): Ledger;
}

declare module '@relayplane/auth-gate' {
  export interface AuthProfileStorage {}
  export interface AuthResult {
    [key: string]: any;
  }
  export class MemoryAuthProfileStorage implements AuthProfileStorage {}
  export class AuthGate {
    [key: string]: any;
  }
  export function createAuthGate(config?: any): AuthGate;
}

declare module '@relayplane/policy-engine' {
  export interface PolicyStorage {}
  export class MemoryPolicyStorage implements PolicyStorage {}
  export class PolicyEngine {
    [key: string]: any;
  }
  export function createPolicyEngine(config?: any): PolicyEngine;
}

declare module '@relayplane/routing-engine' {
  export interface CapabilityRegistry {
    [key: string]: any;
  }
  export interface ProviderManager {
    [key: string]: any;
  }
  export interface RoutingRequest {
    [key: string]: any;
  }
  export interface Capability {
    [key: string]: any;
  }
  export class RoutingEngine {
    [key: string]: any;
  }
  export function createRoutingEngine(config?: any): RoutingEngine;
  export function createCapabilityRegistry(config?: any): CapabilityRegistry;
  export function createProviderManagerWithBuiltIns(config?: any): ProviderManager;
}

declare module '@relayplane/explainability' {
  export interface PolicySimulationRequest {
    [key: string]: any;
  }
  export interface RoutingSimulationRequest {
    [key: string]: any;
  }
  export class ExplanationEngine {
    [key: string]: any;
  }
  export class RunComparator {
    [key: string]: any;
  }
  export class Simulator {
    [key: string]: any;
  }
  export function createExplanationEngine(config?: any): ExplanationEngine;
  export function createRunComparator(config?: any): RunComparator;
  export function createSimulator(config?: any): Simulator;
}

declare module '@relayplane/learning-engine' {
  export interface LearningEngineConfig {
    [key: string]: any;
  }
  export class LearningEngine {
    [key: string]: any;
  }
  export function createLearningEngine(...args: any[]): LearningEngine;
}

declare module '@relayplane/mesh-core' {
  export interface AtomStore { [key: string]: any; }
  export interface KnowledgeAtom { [key: string]: any; }
  export function captureToolCall(...args: any[]): any;
  export function captureOutcome(...args: any[]): any;
  export function getTopAtoms(...args: any[]): any;
  export function searchAtoms(...args: any[]): any;
  export const AtomStore: any;
}

declare module '@relayplane/mesh-openclaw' {
  export function createOpenClawHook(...args: any[]): any;
  export class ContextInjector { [key: string]: any; }
  export interface OpenClawHookConfig { [key: string]: any; }
}

declare module '@relayplane/adapters' {
  export function createAdapter(...args: any[]): any;
  export interface ProviderAdapter { [key: string]: any; }
}

declare module '@relayplane/mesh-sync' {
  export class SyncEngine { [key: string]: any; }
  export function createSyncEngine(...args: any[]): any;
  export function startAutoSync(...args: any[]): any;
  export function resolveSyncConfig(...args: any[]): any;
  export function syncWithMesh(...args: any[]): any;
  export interface SyncConfig { [key: string]: any; }
}

