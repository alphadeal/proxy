/**
 * Mesh Learning Layer integration for the RelayPlane proxy.
 *
 * Captures routing decisions as knowledge atoms, injects tips into agent
 * workspaces, and optionally syncs with the mesh server.
 *
 * @packageDocumentation
 */

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { MeshConfig } from './relay-config.js';

// Lazy-loaded mesh modules (graceful degradation if unavailable)
let AtomStore: any;
let captureToolCall: any;
let getTopAtoms: any;
let searchAtoms: any;
let ContextInjector: any;
let startAutoSync: any;
let resolveSyncConfig: any;

let meshAvailable = false;

async function loadMeshModules(): Promise<boolean> {
  try {
    const core = await import('@relayplane/mesh-core');
    AtomStore = core.AtomStore;
    captureToolCall = core.captureToolCall;
    getTopAtoms = core.getTopAtoms;
    searchAtoms = core.searchAtoms;

    const openclaw = await import('@relayplane/mesh-openclaw');
    ContextInjector = openclaw.ContextInjector;

    const sync = await import('@relayplane/mesh-sync');
    startAutoSync = sync.startAutoSync;
    resolveSyncConfig = sync.resolveSyncConfig;

    meshAvailable = true;
    return true;
  } catch (err) {
    console.log(`[MESH] Mesh packages not available: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export interface MeshHandle {
  /** Capture a completed proxy request as a knowledge atom */
  captureRequest(params: CaptureParams): void;
  /** Get current tips that would be injected */
  getTips(maxCount?: number): Array<{ observation: string; fitness: number; type: string }>;
  /** Get mesh status info */
  getStatus(): MeshStatus;
  /** Force sync now */
  sync(): Promise<{ pushed: number; pulled: number } | null>;
  /** Stop all mesh activity */
  stop(): void;
}

export interface CaptureParams {
  toolName: string;
  model: string;
  provider: string;
  success: boolean;
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  taskType?: string;
  errorCode?: string;
}

export interface MeshStatus {
  available: boolean;
  enabled: boolean;
  atomCount: number;
  contributing: boolean;
  meshUrl: string;
  dataDir: string;
}

/**
 * Initialize the mesh learning layer. Returns a handle for capturing
 * requests and managing the mesh, or a no-op handle if mesh packages
 * are unavailable.
 */
export async function initMesh(config: MeshConfig): Promise<MeshHandle> {
  const noopHandle: MeshHandle = {
    captureRequest() {},
    getTips() { return []; },
    getStatus() {
      return { available: false, enabled: config.enabled, atomCount: 0, contributing: false, meshUrl: config.meshUrl, dataDir: config.dataDir };
    },
    async sync() { return null; },
    stop() {},
  };

  if (!config.enabled) return noopHandle;

  const loaded = await loadMeshModules();
  if (!loaded) return noopHandle;

  try {
    // Ensure data directory exists
    mkdirSync(config.dataDir, { recursive: true });

    const dbPath = join(config.dataDir, 'atoms.db');
    const store = new AtomStore(dbPath);

    // Start context injector
    const workspaceDir = join(process.env.HOME ?? '/root', '.openclaw', 'workspace');
    const injector = new ContextInjector(store, {
      workspaceDir,
      maxTips: 10,
      updateIntervalMs: config.injectIntervalMs,
    });
    injector.start();

    // Start auto-sync if contributing
    let autoSync: { stop(): void } | null = null;
    if (config.contribute) {
      const syncConfig = resolveSyncConfig({
        meshUrl: config.meshUrl,
        autoSync: true,
        syncIntervalMs: config.syncIntervalMs,
      });
      autoSync = startAutoSync(store, syncConfig);
    }

    return {
      captureRequest(params: CaptureParams) {
        try {
          const toolDesc = params.taskType
            ? `${params.taskType}→${params.model}`
            : `proxy→${params.model}`;

          captureToolCall(
            store,
            toolDesc,
            {
              model: params.model,
              provider: params.provider,
              task_type: params.taskType ?? 'unknown',
              input_tokens: params.inputTokens,
              output_tokens: params.outputTokens,
              cost_usd: params.costUsd,
            },
            params.success ? { ok: true } : null,
            params.success ? null : (params.errorCode ?? 'request_failed'),
            params.latencyMs,
          );
        } catch (err) {
          // Silent — don't break proxy for mesh capture errors
        }
      },

      getTips(maxCount = 10) {
        try {
          const atoms = getTopAtoms(store, undefined, maxCount);
          return atoms.map((a: any) => ({
            observation: a.observation,
            fitness: a.fitness_score,
            type: a.type,
          }));
        } catch {
          return [];
        }
      },

      getStatus() {
        try {
          const allAtoms = getTopAtoms(store, undefined, 100000);
          return {
            available: true,
            enabled: true,
            atomCount: allAtoms.length,
            contributing: config.contribute,
            meshUrl: config.meshUrl,
            dataDir: config.dataDir,
          };
        } catch {
          return { available: true, enabled: true, atomCount: 0, contributing: config.contribute, meshUrl: config.meshUrl, dataDir: config.dataDir };
        }
      },

      async sync() {
        if (!config.contribute) return null;
        try {
          const { syncWithMesh } = await import('@relayplane/mesh-sync');
          const result = await syncWithMesh(store, config.meshUrl);
          return { pushed: (result as any)?.pushed ?? 0, pulled: (result as any)?.pulled ?? 0 };
        } catch {
          return null;
        }
      },

      stop() {
        try {
          injector.stop();
          autoSync?.stop();
          store.close();
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    console.log(`[MESH] Failed to initialize mesh: ${err instanceof Error ? err.message : err}`);
    return noopHandle;
  }
}
