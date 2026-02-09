/**
 * Proxy Server Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProxyServer, createProxyServer } from '../src/server.js';
import { createLedger } from '@relayplane/ledger';
import { MemoryAuthProfileStorage } from '@relayplane/auth-gate';

// Helper to make HTTP requests
async function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({
            status: res.statusCode ?? 500,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('ProxyServer', () => {
  let server: ProxyServer;
  let dbPath: string;
  const port = 3099; // Use non-standard port for testing

  beforeEach(async () => {
    // Use temp directory for ledger
    dbPath = path.join(os.tmpdir(), `proxy-test-${Date.now()}.db`);

    const ledger = createLedger({ dbPath });
    const authStorage = new MemoryAuthProfileStorage();

    // Seed test auth profiles
    await authStorage.seedTestData('test_workspace');

    server = createProxyServer({
      port,
      ledger,
      authStorage,
      verbose: false,
      defaultWorkspaceId: 'test_workspace',
      defaultAgentId: 'test_agent',
    });

    await server.start();
    // Wait a bit for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterEach(async () => {
    await server.stop();
    await server.getLedger().close();

    // Clean up test database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(dbPath + '-wal')) {
      fs.unlinkSync(dbPath + '-wal');
    }
    if (fs.existsSync(dbPath + '-shm')) {
      fs.unlinkSync(dbPath + '-shm');
    }
  });

  describe('Health endpoint', () => {
    it('should respond to /health', async () => {
      const res = await request(port, 'GET', '/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', version: '0.1.0' });
    });

    it('should respond to /', async () => {
      const res = await request(port, 'GET', '/');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', version: '0.1.0' });
    });
  });

  describe('Models endpoint', () => {
    it('should list available models', async () => {
      const res = await request(port, 'GET', '/v1/models');

      expect(res.status).toBe(200);
      const body = res.body as { object: string; data: Array<{ id: string }> };
      expect(body.object).toBe('list');
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.some((m) => m.id === 'claude-3-5-sonnet')).toBe(true);
    });
  });

  describe('Chat completions endpoint', () => {
    it('should return error when provider not configured', async () => {
      const res = await request(
        port,
        'POST',
        '/v1/chat/completions',
        {
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        {
          'X-RelayPlane-Workspace': 'test_workspace',
          'X-RelayPlane-Agent': 'test_agent',
        }
      );

      expect(res.status).toBe(500);
      const body = res.body as { error: { code: string; run_id?: string } };
      expect(body.error.code).toBe('provider_not_configured');
      // Should still have a run_id for debugging
      expect(body.error.run_id).toBeDefined();
    });

    it('should record run in ledger even on failure', async () => {
      await request(
        port,
        'POST',
        '/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        {
          'X-RelayPlane-Workspace': 'test_workspace',
          'X-RelayPlane-Agent': 'test_agent',
        }
      );

      // Check ledger has the run
      const runs = await server.getLedger().queryRuns({
        workspace_id: 'test_workspace',
        limit: 10,
      });

      expect(runs.items.length).toBeGreaterThan(0);
      expect(runs.items[0]?.status).toBe('failed');
      expect(runs.items[0]?.agent_id).toBe('test_agent');
    });

    it('should track auth_type from header detection', async () => {
      // Make request with API key style auth
      await request(
        port,
        'POST',
        '/v1/chat/completions',
        {
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        {
          'Authorization': 'Bearer sk-ant-api123',
          'X-RelayPlane-Workspace': 'test_workspace',
        }
      );

      const runs = await server.getLedger().queryRuns({
        workspace_id: 'test_workspace',
        limit: 1,
      });

      expect(runs.items[0]?.auth_type).toBe('api');
    });

    it('should detect automated requests via header', async () => {
      await request(
        port,
        'POST',
        '/v1/chat/completions',
        {
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        {
          'X-RelayPlane-Automated': 'true',
          'X-RelayPlane-Workspace': 'test_workspace',
        }
      );

      const runs = await server.getLedger().queryRuns({
        workspace_id: 'test_workspace',
        limit: 1,
      });

      expect(runs.items[0]?.execution_mode).toBe('background');
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight', async () => {
      const res = await request(port, 'OPTIONS', '/v1/chat/completions');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(port, 'GET', '/v1/unknown');

      expect(res.status).toBe(404);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('not_found');
    });
  });
});

describe('createProxyServer', () => {
  it('should create server with default config', () => {
    const server = createProxyServer();
    expect(server).toBeInstanceOf(ProxyServer);
  });

  it('should create server with custom config', () => {
    const server = createProxyServer({
      port: 9999,
      host: '0.0.0.0',
      verbose: true,
    });
    expect(server).toBeInstanceOf(ProxyServer);
  });
});

describe('Policy Integration', () => {
  let server: ProxyServer;
  let dbPath: string;
  const port = 3098;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `proxy-policy-test-${Date.now()}.db`);

    const ledger = createLedger({ dbPath });
    const authStorage = new MemoryAuthProfileStorage();

    await authStorage.seedTestData('test_workspace');

    server = createProxyServer({
      port,
      ledger,
      authStorage,
      verbose: false,
      defaultWorkspaceId: 'test_workspace',
      defaultAgentId: 'test_agent',
      enforcePolicies: true,
    });

    await server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterEach(async () => {
    await server.stop();
    await server.getLedger().close();

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
  });

  describe('Policy Management API', () => {
    it('should create and list policies', async () => {
      // Create a policy via API
      const createRes = await request(
        port,
        'POST',
        '/v1/policies',
        {
          workspace_id: 'test_workspace',
          name: 'No Opus',
          description: 'Block expensive model',
          type: 'model.denylist',
          enabled: true,
          priority: 100,
          scope: { applies_to: 'workspace' },
          conditions: [],
          action: { type: 'deny', parameters: { models: ['claude-3-opus'] } },
          created_by: 'test_user',
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      expect(createRes.status).toBe(201);
      const created = createRes.body as { policy: { policy_id: string; name: string } };
      expect(created.policy.name).toBe('No Opus');
      expect(created.policy.policy_id).toBeDefined();

      // List policies
      const listRes = await request(port, 'GET', '/v1/policies', undefined, {
        'X-RelayPlane-Workspace': 'test_workspace',
      });

      expect(listRes.status).toBe(200);
      const list = listRes.body as { policies: Array<{ name: string }> };
      expect(list.policies.some((p) => p.name === 'No Opus')).toBe(true);
    });

    it('should get policy by ID', async () => {
      const createRes = await request(
        port,
        'POST',
        '/v1/policies',
        {
          workspace_id: 'test_workspace',
          name: 'Test Policy',
          description: '',
          type: 'model.allowlist',
          enabled: true,
          priority: 100,
          scope: { applies_to: 'workspace' },
          conditions: [],
          action: { type: 'deny' },
          created_by: 'test_user',
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      const policyId = (createRes.body as { policy: { policy_id: string } }).policy.policy_id;

      const getRes = await request(port, 'GET', `/v1/policies/${policyId}`);

      expect(getRes.status).toBe(200);
      const got = getRes.body as { policy: { policy_id: string } };
      expect(got.policy.policy_id).toBe(policyId);
    });

    it('should update policy', async () => {
      const createRes = await request(
        port,
        'POST',
        '/v1/policies',
        {
          workspace_id: 'test_workspace',
          name: 'Original',
          description: '',
          type: 'model.allowlist',
          enabled: true,
          priority: 100,
          scope: { applies_to: 'workspace' },
          conditions: [],
          action: { type: 'deny' },
          created_by: 'test_user',
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      const policyId = (createRes.body as { policy: { policy_id: string } }).policy.policy_id;

      const updateRes = await request(port, 'PATCH', `/v1/policies/${policyId}`, {
        name: 'Updated',
        priority: 50,
      });

      expect(updateRes.status).toBe(200);
      const updated = updateRes.body as { policy: { name: string; priority: number } };
      expect(updated.policy.name).toBe('Updated');
      expect(updated.policy.priority).toBe(50);
    });

    it('should delete policy', async () => {
      const createRes = await request(
        port,
        'POST',
        '/v1/policies',
        {
          workspace_id: 'test_workspace',
          name: 'To Delete',
          description: '',
          type: 'model.allowlist',
          enabled: true,
          priority: 100,
          scope: { applies_to: 'workspace' },
          conditions: [],
          action: { type: 'deny' },
          created_by: 'test_user',
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      const policyId = (createRes.body as { policy: { policy_id: string } }).policy.policy_id;

      const deleteRes = await request(port, 'DELETE', `/v1/policies/${policyId}`);
      expect(deleteRes.status).toBe(204);

      const getRes = await request(port, 'GET', `/v1/policies/${policyId}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('Policy Testing (Dry Run)', () => {
    it('should test policy without side effects', async () => {
      // Create a blocking policy
      await request(
        port,
        'POST',
        '/v1/policies',
        {
          workspace_id: 'test_workspace',
          name: 'Block Opus',
          description: '',
          type: 'model.denylist',
          enabled: true,
          priority: 100,
          scope: { applies_to: 'workspace' },
          conditions: [],
          action: { type: 'deny', parameters: { models: ['claude-3-opus'] } },
          created_by: 'test_user',
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      // Test the policy
      const testRes = await request(port, 'POST', '/v1/policies/test', {
        workspace_id: 'test_workspace',
        agent_id: 'test_agent',
        request: {
          model: 'claude-3-opus',
          provider: 'anthropic',
        },
      });

      expect(testRes.status).toBe(200);
      const result = testRes.body as { decision: { allow: boolean; action: string } };
      expect(result.decision.allow).toBe(false);
      expect(result.decision.action).toBe('deny');
    });
  });

  describe('Policy Enforcement', () => {
    it('should deny request when policy blocks model', async () => {
      // Create a blocking policy
      await request(
        port,
        'POST',
        '/v1/policies',
        {
          workspace_id: 'test_workspace',
          name: 'Block GPT',
          description: '',
          type: 'model.denylist',
          enabled: true,
          priority: 100,
          scope: { applies_to: 'workspace' },
          conditions: [],
          action: { type: 'deny', parameters: { models: ['gpt-4o'] } },
          created_by: 'test_user',
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      // Try to use blocked model
      const res = await request(
        port,
        'POST',
        '/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        { 'X-RelayPlane-Workspace': 'test_workspace' }
      );

      expect(res.status).toBe(403);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('policy_denied');
    });
  });
});
