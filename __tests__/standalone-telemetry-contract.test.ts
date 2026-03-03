import { describe, it, expect } from "vitest";
import {
    buildTelemetryStatsPayload,
    summarizeRoutingInsights,
    toTelemetryRun,
} from "../src/standalone-proxy.js";

describe("standalone telemetry payload contracts", () => {
    it("keeps telemetry run payload contract stable", () => {
        const run = toTelemetryRun({
            id: "req-42",
            originalModel: "relayplane:auto",
            targetModel: "claude-sonnet-4-6",
            provider: "anthropic",
            latencyMs: 1111,
            success: true,
            mode: "auto",
            escalated: false,
            timestamp: "2026-03-02T12:34:56.000Z",
            tokensIn: 12,
            tokensOut: 34,
            costUsd: 0.0012,
            taskType: "code_generation",
            complexity: "moderate",
            routingReason: "score=4;signals=engineering_keyword|has_tools",
            opusGateDecision: "blocked:blocked_intent:git_ops",
            intentHints: ["git_ops", "small_refactor"],
        });

        expect(Object.keys(run).sort()).toMatchInlineSnapshot(`
          [
            "complexity",
            "costUsd",
            "escalated",
            "id",
            "intentHints",
            "latencyMs",
            "mode",
            "model",
            "opusGateDecision",
            "original_model",
            "provider",
            "routed_to",
            "routingReason",
            "routingSource",
            "savings",
            "started_at",
            "status",
            "success",
            "taskType",
            "timestamp",
            "tokensIn",
            "tokensOut",
            "workflow_name",
          ]
        `);

        expect(run).toMatchObject({
            id: "req-42",
            mode: "auto",
            status: "success",
            routingSource: "auto",
            routingReason: "score=4;signals=engineering_keyword|has_tools",
            opusGateDecision: "blocked:blocked_intent:git_ops",
            intentHints: ["git_ops", "small_refactor"],
            original_model: "relayplane:auto",
            routed_to: "anthropic/claude-sonnet-4-6",
            taskType: "code_generation",
            complexity: "moderate",
        });
    });

    it("keeps routingInsights payload contract stable", () => {
        const routingInsights = summarizeRoutingInsights([
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

        expect(Object.keys(routingInsights).sort()).toMatchInlineSnapshot(`
          [
            "intentHintCounts",
            "opusGateBlocked",
          ]
        `);

        expect(Object.keys(routingInsights.intentHintCounts).sort())
            .toMatchInlineSnapshot(`
          [
            "architecture",
            "git_ops",
            "small_refactor",
          ]
        `);

        expect(routingInsights).toEqual({
            opusGateBlocked: 1,
            intentHintCounts: {
                git_ops: 1,
                small_refactor: 1,
                architecture: 1,
            },
        });
    });

    it("keeps full telemetry stats payload contract stable", () => {
        const payload = buildTelemetryStatsPayload([
            {
                id: "req-1",
                originalModel: "relayplane:auto",
                targetModel: "claude-sonnet-4-6",
                provider: "anthropic",
                latencyMs: 1000,
                success: true,
                mode: "auto",
                escalated: false,
                timestamp: "2026-03-02T10:00:00.000Z",
                tokensIn: 12,
                tokensOut: 40,
                costUsd: 0.0012,
                taskType: "code_generation",
                complexity: "moderate",
                opusGateDecision: "blocked:blocked_intent:git_ops",
                intentHints: ["git_ops", "small_refactor"],
            },
            {
                id: "req-2",
                originalModel: "claude-sonnet-4-6",
                targetModel: "claude-sonnet-4-6",
                provider: "anthropic",
                latencyMs: 2000,
                success: false,
                mode: "passthrough",
                escalated: false,
                timestamp: "2026-03-02T11:00:00.000Z",
                tokensIn: 20,
                tokensOut: 10,
                costUsd: 0.0008,
                taskType: "general",
                complexity: "simple",
                opusGateDecision: "not_applicable:complexity_not_complex",
                intentHints: ["housekeeping"],
            },
            {
                id: "req-3",
                originalModel: "relayplane:auto",
                targetModel: "claude-opus-4-6",
                provider: "anthropic",
                latencyMs: 3000,
                success: true,
                mode: "auto",
                escalated: false,
                timestamp: "2026-03-01T11:00:00.000Z",
                tokensIn: 50,
                tokensOut: 120,
                costUsd: 0.01,
                taskType: "analysis",
                complexity: "complex",
                opusGateDecision: "allowed:gate_passed",
                intentHints: ["architecture"],
            },
        ]);

        expect(Object.keys(payload).sort()).toMatchInlineSnapshot(`
          [
            "byModel",
            "dailyCosts",
            "routingInsights",
            "summary",
          ]
        `);

        const summary = payload["summary"] as Record<string, unknown>;
        expect(Object.keys(summary).sort()).toMatchInlineSnapshot(`
          [
            "avgLatencyMs",
            "successRate",
            "totalCostUsd",
            "totalEvents",
          ]
        `);

        const routingInsights = payload["routingInsights"] as Record<
            string,
            unknown
        >;
        expect(Object.keys(routingInsights).sort()).toMatchInlineSnapshot(`
          [
            "intentHintCounts",
            "opusGateBlocked",
          ]
        `);

        const byModel = payload["byModel"] as Array<Record<string, unknown>>;
        expect(Object.keys(byModel[0] ?? {}).sort()).toMatchInlineSnapshot(`
          [
            "autoCount",
            "costUsd",
            "count",
            "directCount",
            "model",
            "savings",
          ]
        `);

        const dailyCosts = payload["dailyCosts"] as Array<
            Record<string, unknown>
        >;
        expect(Object.keys(dailyCosts[0] ?? {}).sort()).toMatchInlineSnapshot(`
          [
            "costUsd",
            "date",
            "requests",
          ]
        `);
    });
});
