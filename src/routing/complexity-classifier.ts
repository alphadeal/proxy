/**
 * Complexity Classifier
 *
 * Scores the current conversation turn to determine routing complexity:
 * - simple   → Haiku  (score < 3)
 * - moderate → Sonnet (score 3-4)
 * - complex  → Opus   (score >= 5)
 *
 * Scores only the CURRENT turn (last user message) to prevent long sessions
 * from always routing to Opus due to accumulated history signals.
 *
 * @packageDocumentation
 */

export type Complexity = "simple" | "moderate" | "complex";
export type IntentHint =
    | "git_ops"
    | "housekeeping"
    | "small_refactor"
    | "architecture"
    | "multi_step"
    | "large_context"
    | "cross_file_refactor";

export interface ComplexityAssessment {
    complexity: Complexity;
    score: number;
    currentTokens: number;
    signals: string[];
    intentHints: IntentHint[];
}

export function isContentBlockArray(
    v: unknown,
): v is Array<{ type?: string; text?: string }> {
    return Array.isArray(v);
}

function extractSingleMessageText(msg: { content?: unknown }): string {
    const content = msg.content;
    if (typeof content === "string") return content;
    if (isContentBlockArray(content)) {
        return content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join(" ");
    }
    return "";
}

export function extractMessageText(
    messages: Array<{ content?: unknown }>,
): string {
    return messages.map(extractSingleMessageText).join(" ");
}

/**
 * Find the last user message in the conversation.
 * Claude Code alternates user/assistant messages; the last user message
 * is the one that determines what we're actually being asked to do NOW.
 * We look for the last message that has text content (not just tool_result).
 */
function findLastUserText(
    messages: Array<{ content?: unknown; role?: string }>,
): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        // Skip pure tool_result messages (assistant continuations)
        const content = msg.content;
        if (isContentBlockArray(content)) {
            const hasText = content.some((p) => p.type === "text");
            const isOnlyToolResult =
                !hasText &&
                content.every(
                    (p) => p.type === "tool_result" || p.type === "tool_use",
                );
            if (isOnlyToolResult) continue;
        }
        const text = extractSingleMessageText(msg);
        if (text.trim().length > 0) return text;
    }
    return "";
}

/**
 * Classify the complexity of the current request.
 *
 * @param messages  - Full conversation history (only the last user turn is scored)
 * @param bodyTools - Tools array from the request body (used for tool count signal)
 * @param system    - System prompt string (used for context size signal)
 */
export function classifyComplexity(
    messages: Array<{ content?: unknown; role?: string }>,
    bodyTools?: unknown,
    system?: string,
): Complexity {
    return classifyComplexityWithDetails(messages, bodyTools, system).complexity;
}

export function classifyComplexityWithDetails(
    messages: Array<{ content?: unknown; role?: string }>,
    bodyTools?: unknown,
    system?: string,
): ComplexityAssessment {
    // Score the CURRENT turn, not the accumulated history.
    // This prevents long sessions from always routing to Opus.
    const currentText = findLastUserText(messages).toLowerCase();
    const currentTokens = Math.ceil(currentText.length / 4);

    let score = 0;
    const signals: string[] = [];
    const intentHints = new Set<IntentHint>();

    // --- Current-turn signals (what is the user asking NOW?) ---

    // Code patterns in the current message.
    // Note: 'let ' is intentionally excluded — it triggers false positives in
    // natural language (e.g. "let me fix it") when scoring the current user
    // message. 'const' and 'import' reliably signal code without the ambiguity.
    if (
        /```/.test(currentText) ||
        /function |class |const |import /.test(currentText)
    ) {
        score += 2;
        signals.push("code_pattern");
    }

    // Analytical keywords
    if (/analyze|compare|evaluate|assess|review|audit/.test(currentText)) {
        score += 1;
        signals.push("analysis_keyword");
    }

    // Computation keywords
    if (/calculate|compute|solve|equation|prove|derive/.test(currentText)) {
        score += 2;
        signals.push("computation_keyword");
    }

    // Multi-step instructions
    if (/first.*then|step \d|1\).*2\)|phase \d/.test(currentText)) {
        score += 2;
        signals.push("multi_step");
        intentHints.add("multi_step");
    }

    // Current message token size
    if (currentTokens > 2000) {
        score += 1;
        signals.push("large_current_turn");
        intentHints.add("large_context");
    }
    if (currentTokens > 5000) {
        score += 1;
        signals.push("very_large_current_turn");
        intentHints.add("large_context");
    }

    // Creative/engineering keywords
    if (
        /write a (story|essay|article|report)|create a|design a|build a/.test(
            currentText,
        )
    ) {
        score += 1;
        signals.push("creative_or_build_keyword");
    }
    if (/refactor|migrate|architect|implement|integrate/.test(currentText)) {
        score += 1;
        signals.push("engineering_keyword");
    }

    // Intent hints used by routing gates.
    if (
        /\b(commit|push|amend|rebase|cherry-pick|tag|release)\b/.test(
            currentText,
        )
    ) {
        intentHints.add("git_ops");
    }
    if (
        /\b(typo|whitespace|format|formatting|lint|docs?|documentation|comment-only|rename variable|rename var)\b/.test(
            currentText,
        )
    ) {
        intentHints.add("housekeeping");
    }
    if (
        /\b(simple|basic|small|minimal)\b.*\brefactor\b|\brefactor\b.*\b(simple|basic|small|minimal)\b|\b(extract helper|rename)\b/.test(
            currentText,
        )
    ) {
        intentHints.add("small_refactor");
    }
    if (
        /\b(architecture|architect|system design|distributed|scalab|trade-?off)\b/.test(
            currentText,
        )
    ) {
        intentHints.add("architecture");
    }
    if (
        /\b(across files|across modules|multiple files|codebase-wide|entire codebase|whole codebase)\b/.test(
            currentText,
        )
    ) {
        intentHints.add("cross_file_refactor");
    }

    // --- Session-level signals (lightweight context from history) ---

    // Tool count: more tools = richer capability space = more complex task
    const toolCount = Array.isArray(bodyTools) ? bodyTools.length : 0;
    // Tool presence: does this session involve tool use?
    const hasTools =
        toolCount > 0 ||
        messages.some((m) => {
            const c = m.content;
            return (
                isContentBlockArray(c) &&
                c.some(
                    (p) => p.type === "tool_result" || p.type === "tool_use",
                )
            );
        });
    if (hasTools) {
        score += 1;
        signals.push("has_tools");
    }
    if (toolCount >= 10) {
        score += 1; // large tool surface area
        signals.push("many_tools");
    }

    // Recent tool activity: only count tool_results in the LAST 6 messages
    // (the current agentic turn), not the entire conversation history.
    const recentMessages = messages.slice(-6);
    const recentToolResults = recentMessages.filter((m) => {
        const c = m.content;
        return (
            isContentBlockArray(c) && c.some((p) => p.type === "tool_result")
        );
    }).length;
    if (recentToolResults >= 4) {
        score += 1;
        signals.push("recent_tool_activity");
    }

    // System prompt length: a large system prompt signals rich project context
    // (CLAUDE.md content, file summaries, tool descriptions). This is an
    // useful proxy, but only when the current ask is not tiny.
    if (system) {
        const systemTokens = Math.ceil(system.length / 4);
        if (systemTokens > 3000 && currentTokens > 120) {
            score += 1; // substantial context loaded
            signals.push("large_system_prompt");
        }
        if (systemTokens > 8000 && currentTokens > 240) {
            score += 1; // very large context loaded
            signals.push("very_large_system_prompt");
        }
    }

    const complexity: Complexity =
        score >= 5 ? "complex" : score >= 3 ? "moderate" : "simple";

    return {
        complexity,
        score,
        currentTokens,
        signals,
        intentHints: Array.from(intentHints),
    };
}
