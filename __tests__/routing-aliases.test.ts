import { describe, it, expect } from 'vitest';
import {
  RELAYPLANE_ALIASES,
  SMART_ALIASES,
  resolveModelAlias,
  getAvailableModelNames,
  MODEL_MAPPING,
  sanitizeAnthropicToolResultMessages,
} from '../src/standalone-proxy.js';

describe('RELAYPLANE_ALIASES', () => {
  it('should map relayplane:auto to rp:balanced', () => {
    expect(RELAYPLANE_ALIASES['relayplane:auto']).toBe('rp:balanced');
  });

  it('should map rp:auto to rp:balanced', () => {
    expect(RELAYPLANE_ALIASES['rp:auto']).toBe('rp:balanced');
  });
});

describe('SMART_ALIASES', () => {
  it('should have rp:best pointing to a valid model', () => {
    expect(SMART_ALIASES['rp:best']).toBeDefined();
    expect(SMART_ALIASES['rp:best'].provider).toBe('anthropic');
    expect(SMART_ALIASES['rp:best'].model).toContain('claude');
  });

  it('should have rp:fast pointing to a fast model', () => {
    expect(SMART_ALIASES['rp:fast']).toBeDefined();
    expect(SMART_ALIASES['rp:fast'].model).toContain('haiku');
  });

  it('should have rp:cheap pointing to a cheap model', () => {
    expect(SMART_ALIASES['rp:cheap']).toBeDefined();
    expect(SMART_ALIASES['rp:cheap'].model).toContain('mini');
  });

  it('should have rp:balanced pointing to a balanced model', () => {
    expect(SMART_ALIASES['rp:balanced']).toBeDefined();
  });

  it('should point to existing models', () => {
    // Model IDs can be date-suffixed (claude-sonnet-4-20250514) or versioned (claude-opus-4-6)
    const validModelPattern = /^claude-[\w-]+$/;
    expect(SMART_ALIASES['rp:best'].model).toMatch(validModelPattern);
    expect(SMART_ALIASES['rp:fast'].model).toMatch(validModelPattern);
    expect(SMART_ALIASES['rp:balanced'].model).toMatch(validModelPattern);
  });
});

describe('resolveModelAlias', () => {
  it('should resolve relayplane:auto to rp:balanced', () => {
    expect(resolveModelAlias('relayplane:auto')).toBe('rp:balanced');
  });

  it('should resolve rp:auto to rp:balanced', () => {
    expect(resolveModelAlias('rp:auto')).toBe('rp:balanced');
  });

  it('should return unchanged for non-alias models', () => {
    expect(resolveModelAlias('claude-sonnet-4')).toBe('claude-sonnet-4');
    expect(resolveModelAlias('gpt-4o')).toBe('gpt-4o');
    expect(resolveModelAlias('rp:best')).toBe('rp:best');
  });

  it('should return unchanged for unknown models', () => {
    expect(resolveModelAlias('unknown-model')).toBe('unknown-model');
  });
});

describe('getAvailableModelNames', () => {
  it('should include MODEL_MAPPING keys', () => {
    const available = getAvailableModelNames();
    expect(available).toContain('claude-sonnet-4');
    expect(available).toContain('gpt-4o');
  });

  it('should include SMART_ALIASES keys', () => {
    const available = getAvailableModelNames();
    expect(available).toContain('rp:best');
    expect(available).toContain('rp:fast');
    expect(available).toContain('rp:balanced');
  });

  it('should include relayplane routing models', () => {
    const available = getAvailableModelNames();
    expect(available).toContain('relayplane:auto');
    expect(available).toContain('relayplane:cost');
    expect(available).toContain('relayplane:fast');
    expect(available).toContain('relayplane:quality');
  });
});

describe('MODEL_MAPPING', () => {
  it('should have updated sonnet pointing to claude-sonnet-4', () => {
    expect(MODEL_MAPPING['sonnet'].model).toContain('claude-sonnet-4');
  });

  it('should have updated opus pointing to claude-opus-4', () => {
    expect(MODEL_MAPPING['opus'].model).toContain('claude-opus-4');
  });
});

describe('sanitizeAnthropicToolResultMessages', () => {
  it('keeps valid tool_result blocks paired with previous assistant tool_use', () => {
    const input = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_valid', name: 'Read', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_valid', content: 'ok' }],
      },
    ];

    const out = sanitizeAnthropicToolResultMessages(input);
    expect(out.droppedToolResults).toBe(0);
    expect(out.droppedMessages).toBe(0);
    expect(out.messages).toEqual(input);
  });

  it('drops orphan tool_result blocks and removes now-empty user message', () => {
    const out = sanitizeAnthropicToolResultMessages([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_orphan', content: 'orphan' }],
      },
    ]);

    expect(out.droppedToolResults).toBe(1);
    expect(out.droppedMessages).toBe(1);
    expect(out.messages).toEqual([]);
  });

  it('keeps text while removing invalid tool_result blocks in mixed user content', () => {
    const out = sanitizeAnthropicToolResultMessages([
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'continuing without tools' },
          { type: 'tool_result', tool_use_id: 'toolu_missing', content: 'bad' },
        ],
      },
    ]);

    expect(out.droppedToolResults).toBe(1);
    expect(out.droppedMessages).toBe(0);
    expect(out.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'continuing without tools' }] },
    ]);
  });
});
