import { describe, it, expect } from "vitest";
import {
    assessComplexityForRouting,
    applyOpusGate,
    applySimpleEffortStrip,
    summarizeRoutingInsights,
    toTelemetryRun,
} from "../src/standalone-proxy.js";

function makeConfig(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        enabled: true,
        modelOverrides: {},
        profiles: {},
        routing: {
            mode: "cascade",
            cascade: {
                enabled: true,
                models: [
                    "claude-haiku-4-5-20251001",
                    "claude-sonnet-4-6",
                    "claude-opus-4-6",
                ],
                escalateOn: "uncertainty",
                maxEscalations: 1,
            },
            complexity: {
                enabled: true,
                simple: "claude-haiku-4-5-20251001",
                moderate: "claude-sonnet-4-6",
                complex: "claude-opus-4-6",
                opusGate: {
                    enabled: true,
                    minScore: 7,
                    requireSignals: [
                        "architecture",
                        "multi_step",
                        "large_context",
                        "cross_file_refactor",
                    ],
                    maxTokensInBypass: 300,
                    blockIntents: [
                        "git_ops",
                        "housekeeping",
                        "small_refactor",
                    ],
                },
            },
            alphadeal: {
                enabled: true,
                simple: "gpt-5-nano",
                moderate: "gpt-5.2",
                complex: "gpt-5.2-pro",
            },
        },
        reliability: {
            cooldowns: {
                enabled: true,
                allowedFails: 3,
                windowSeconds: 60,
                cooldownSeconds: 120,
            },
        },
        ...overrides,
    };
}

describe("standalone routing helpers", () => {
    it("downgrades a complex score for git operations in routing assessment", () => {
        const tools = Array.from({ length: 15 }, (_, i) => ({
            name: `tool-${i}`,
        }));
        const config = makeConfig();
        const { complexity, routingMeta } = assessComplexityForRouting(
            [
                {
                    role: "user",
                    content:
                        "first refactor this function, then commit and push",
                },
            ],
            tools,
            "",
            config as never,
        );

        expect(complexity).toBe("moderate");
        expect(routingMeta.opusGateDecision).toContain("blocked:");
        expect(routingMeta.intentHints).toContain("git_ops");
    });

    it("respects opus gate override when disabled", () => {
        const gate = applyOpusGate(
            "complex",
            {
                complexity: "complex",
                score: 5,
                currentTokens: 100,
                signals: ["multi_step", "engineering_keyword"],
                intentHints: ["multi_step"],
            },
            makeConfig({
                routing: {
                    mode: "cascade",
                    complexity: {
                        enabled: true,
                        simple: "claude-haiku-4-5-20251001",
                        moderate: "claude-sonnet-4-6",
                        complex: "claude-opus-4-6",
                        opusGate: { enabled: false },
                    },
                    cascade: {
                        enabled: true,
                        models: ["a", "b", "c"],
                        escalateOn: "uncertainty",
                        maxEscalations: 1,
                    },
                    alphadeal: {
                        enabled: true,
                        simple: "x",
                        moderate: "y",
                        complex: "z",
                    },
                },
            }) as never,
        );

        expect(gate.decision).toBe("allowed");
        expect(gate.complexity).toBe("complex");
    });

    it("applies minScore override for strong-signal complex prompts", () => {
        const tools = Array.from({ length: 15 }, (_, i) => ({
            name: `tool-${i}`,
        }));
        const config = makeConfig({
            routing: {
                mode: "cascade",
                cascade: {
                    enabled: true,
                    models: [
                        "claude-haiku-4-5-20251001",
                        "claude-sonnet-4-6",
                        "claude-opus-4-6",
                    ],
                    escalateOn: "uncertainty",
                    maxEscalations: 1,
                },
                complexity: {
                    enabled: true,
                    simple: "claude-haiku-4-5-20251001",
                    moderate: "claude-sonnet-4-6",
                    complex: "claude-opus-4-6",
                    opusGate: {
                        enabled: true,
                        minScore: 5,
                        requireSignals: [
                            "architecture",
                            "multi_step",
                            "large_context",
                            "cross_file_refactor",
                        ],
                        maxTokensInBypass: 300,
                        blockIntents: [
                            "git_ops",
                            "housekeeping",
                            "small_refactor",
                        ],
                    },
                },
                alphadeal: {
                    enabled: true,
                    simple: "gpt-5-nano",
                    moderate: "gpt-5.2",
                    complex: "gpt-5.2-pro",
                },
            },
        });

        const { complexity, routingMeta } = assessComplexityForRouting(
            [
                {
                    role: "user",
                    content:
                        "first analyze architecture tradeoffs, then refactor across files",
                },
            ],
            tools,
            "",
            config as never,
        );

        expect(complexity).toBe("complex");
        expect(routingMeta.opusGateDecision).toContain("allowed:");
    });

    it("maps routing metadata into telemetry run payload", () => {
        const run = toTelemetryRun({
            id: "req-1",
            originalModel: "relayplane:auto",
            targetModel: "claude-sonnet-4-6",
            provider: "anthropic",
            latencyMs: 1200,
            success: true,
            mode: "auto",
            escalated: false,
            timestamp: "2026-03-02T12:00:00.000Z",
            tokensIn: 10,
            tokensOut: 40,
            costUsd: 0.001,
            taskType: "code_generation",
            complexity: "moderate",
            routingReason: "score=4;signals=engineering_keyword|has_tools",
            opusGateDecision: "blocked:blocked_intent:git_ops",
            intentHints: ["git_ops"],
        });

        expect(run["routingReason"]).toBe(
            "score=4;signals=engineering_keyword|has_tools",
        );
        expect(run["opusGateDecision"]).toBe("blocked:blocked_intent:git_ops");
        expect(run["intentHints"]).toEqual(["git_ops"]);
    });

    it("summarizes routing insights from request history entries", () => {
        const summary = summarizeRoutingInsights([
            {
                id: "req-1",
                originalModel: "relayplane:auto",
                targetModel: "claude-sonnet-4-6",
                provider: "anthropic",
                latencyMs: 900,
                success: true,
                mode: "auto",
                escalated: false,
                timestamp: "2026-03-02T12:00:00.000Z",
                tokensIn: 10,
                tokensOut: 30,
                costUsd: 0.001,
                opusGateDecision: "blocked:blocked_intent:git_ops",
                intentHints: ["git_ops", "small_refactor"],
            },
            {
                id: "req-2",
                originalModel: "relayplane:auto",
                targetModel: "claude-opus-4-6",
                provider: "anthropic",
                latencyMs: 1900,
                success: true,
                mode: "auto",
                escalated: false,
                timestamp: "2026-03-02T12:01:00.000Z",
                tokensIn: 300,
                tokensOut: 100,
                costUsd: 0.01,
                opusGateDecision: "allowed:gate_passed",
                intentHints: ["architecture"],
            },
        ]);

        expect(summary.opusGateBlocked).toBe(1);
        expect(summary.intentHintCounts["git_ops"]).toBe(1);
        expect(summary.intentHintCounts["small_refactor"]).toBe(1);
        expect(summary.intentHintCounts["architecture"]).toBe(1);
    });

    it("strips effort for simple haiku requests", () => {
        const input = {
            model: "claude-haiku-4-5-20251001",
            effort: "low",
            messages: [{ role: "user", content: "hi" }],
        };
        const stripped = applySimpleEffortStrip(
            input,
            "claude-haiku-4-5-20251001",
            "simple",
        );
        expect(stripped.effort).toBeUndefined();
    });

    it("keeps effort for non-simple complexity", () => {
        const input = {
            model: "claude-haiku-4-5-20251001",
            effort: "low",
            messages: [{ role: "user", content: "hi" }],
        };
        const stripped = applySimpleEffortStrip(
            input,
            "claude-haiku-4-5-20251001",
            "moderate",
        );
        expect(stripped.effort).toBe("low");
    });

    it("keeps effort for simple non-haiku models", () => {
        const input = {
            model: "claude-sonnet-4-6",
            effort: "low",
            messages: [{ role: "user", content: "hi" }],
        };
        const stripped = applySimpleEffortStrip(
            input,
            "claude-sonnet-4-6",
            "simple",
        );
        expect(stripped.effort).toBe("low");
    });
});
