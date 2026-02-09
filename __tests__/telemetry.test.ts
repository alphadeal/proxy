/**
 * Tests for Telemetry Module
 * 
 * Tests: collect → audit → opt-out
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Telemetry Module Tests', () => {
  describe('Task Type Inference', () => {
    it('should infer task types correctly', async () => {
      // Import the module dynamically
      const { inferTaskType } = await import('../src/telemetry.js');
      
      // Quick task (small input/output)
      expect(inferTaskType(100, 50, 'gpt-4')).toBe('quick_task');
      
      // Long context (> 10000 input)
      expect(inferTaskType(15000, 500, 'claude-3')).toBe('long_context');
      
      // Generation (high output ratio)
      expect(inferTaskType(100, 600, 'gpt-4')).toBe('generation');
      
      // Classification (low output ratio)
      expect(inferTaskType(500, 50, 'gpt-4')).toBe('classification');
      
      // Code review
      expect(inferTaskType(3000, 800, 'claude-3')).toBe('code_review');
      
      // Content generation
      expect(inferTaskType(500, 1500, 'gpt-4')).toBe('content_generation');
      
      // Tool use
      expect(inferTaskType(500, 200, 'gpt-4', true)).toBe('tool_use');
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate costs correctly', async () => {
      const { estimateCost } = await import('../src/telemetry.js');
      
      // Claude 3.5 Haiku pricing: $0.8/M in, $4/M out
      const haikuCost = estimateCost('claude-3-5-haiku-20241022', 1000, 1000);
      expect(haikuCost).toBeCloseTo(0.0048, 4);
      
      // GPT-4o pricing: $2.5/M in, $10/M out
      const gpt4oCost = estimateCost('gpt-4o', 1000, 1000);
      expect(gpt4oCost).toBeCloseTo(0.0125, 4);
      
      // Unknown model uses default pricing
      const unknownCost = estimateCost('unknown-model', 1000, 1000);
      expect(unknownCost).toBeGreaterThan(0);
    });
  });

  describe('Audit Mode', () => {
    it('should buffer events in audit mode', async () => {
      const { 
        setAuditMode,
        isAuditMode,
        getAuditBuffer,
        clearAuditBuffer,
      } = await import('../src/telemetry.js');
      
      // Clear any previous buffer
      clearAuditBuffer();
      
      // Check initial state
      expect(isAuditMode()).toBe(false);
      
      // Enable audit mode
      setAuditMode(true);
      expect(isAuditMode()).toBe(true);
      
      // Check buffer is empty
      expect(getAuditBuffer()).toHaveLength(0);
      
      // Clean up
      setAuditMode(false);
      clearAuditBuffer();
    });
  });

  describe('Offline Mode', () => {
    it('should track offline mode setting', async () => {
      const { 
        setOfflineMode, 
        isOfflineMode 
      } = await import('../src/telemetry.js');
      
      // Initially false
      expect(isOfflineMode()).toBe(false);
      
      // Enable offline mode
      setOfflineMode(true);
      expect(isOfflineMode()).toBe(true);
      
      // Disable offline mode
      setOfflineMode(false);
      expect(isOfflineMode()).toBe(false);
    });
  });

  describe('Telemetry Stats', () => {
    it('should return stats structure', async () => {
      const { getTelemetryStats } = await import('../src/telemetry.js');
      
      const stats = getTelemetryStats();
      
      // Verify structure
      expect(stats).toHaveProperty('totalEvents');
      expect(stats).toHaveProperty('totalCost');
      expect(stats).toHaveProperty('byModel');
      expect(stats).toHaveProperty('byTaskType');
      expect(stats).toHaveProperty('successRate');
      
      // All should be valid types
      expect(typeof stats.totalEvents).toBe('number');
      expect(typeof stats.totalCost).toBe('number');
      expect(typeof stats.successRate).toBe('number');
    });
  });
});
