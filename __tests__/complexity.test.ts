import { describe, it, expect } from "vitest";
import { classifyComplexity } from "../src/standalone-proxy.js";

type Message = { content?: unknown };

function textMessage(text: string): Message {
    return { content: text };
}

function textBlockMessage(text: string): Message {
    return { content: [{ type: "text", text }] };
}

function toolResultMessage(output: string): Message {
    return {
        content: [
            {
                type: "tool_result",
                tool_use_id: "toolu_test",
                content: output,
            },
        ],
    };
}

function toolUseMessage(name: string): Message {
    return {
        content: [
            {
                type: "tool_use",
                id: "toolu_test",
                name,
                input: {},
            },
        ],
    };
}

describe("classifyComplexity", () => {
    describe("simple tier", () => {
        it("classifies empty messages as simple", () => {
            expect(classifyComplexity([])).toBe("simple");
        });

        it("classifies a single short text message as simple", () => {
            const messages = [textMessage("hello")];
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies a brief question without tools as simple", () => {
            const messages = [textMessage("what time is it?")];
            expect(classifyComplexity(messages)).toBe("simple");
        });
    });

    describe("moderate tier", () => {
        it("classifies a request with body tools as moderate", () => {
            const messages = [textMessage("fix this bug")];
            const tools = [{ name: "bash", description: "run commands" }];
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies a request with tool_use blocks as moderate", () => {
            const messages = [
                textMessage("fix this"),
                toolUseMessage("read_file"),
            ];
            expect(classifyComplexity(messages)).toBe("moderate");
        });
    });

    describe("complex tier — tool_result scoring", () => {
        it("classifies a session with one tool_result turn as complex when tools are present", () => {
            const messages = [
                textMessage("fix auth middleware"),
                toolUseMessage("read_file"),
                toolResultMessage("export function authMiddleware() {}"),
            ];
            const tools = [{ name: "bash" }];
            // tools: +2, tool_result >= 1: +1 = score 3 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("classifies a deep multi-file session as complex", () => {
            const messages = [
                textMessage("refactor the auth module"),
                toolUseMessage("read_file"),
                toolResultMessage("const auth = {}"),
                toolUseMessage("read_file"),
                toolResultMessage("import { auth } from './auth'"),
                toolUseMessage("read_file"),
                toolResultMessage("class AuthService {}"),
                toolUseMessage("read_file"),
                toolResultMessage("export const middleware = () => {}"),
            ];
            const tools = [{ name: "bash" }];
            // tools: +2, tool_result >= 1: +1, tool_result >= 4: +2, "refactor": +1 = score 6
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("scores tool_result turns without body tools", () => {
            const messages = [
                textMessage("check this"),
                toolUseMessage("read_file"),
                toolResultMessage("const x = 1"),
            ];
            // tool_use in messages: +2, tool_result >= 1: +1 = score 3 → complex
            expect(classifyComplexity(messages)).toBe("complex");
        });
    });

    describe("keyword scoring", () => {
        it("boosts score for analysis keywords", () => {
            const messages = [textMessage("analyze this codebase")];
            // "analyze": +1 = score 1 → simple (no tools)
            expect(classifyComplexity(messages)).toBe("simple");
            // With tools: +2 + "analyze": +1 = score 3 → complex
            expect(classifyComplexity(messages, [{}])).toBe("complex");
        });

        it("boosts score for engineering keywords", () => {
            const messages = [textMessage("implement the new feature")];
            // "implement": +1 = score 1 → simple (no tools)
            expect(classifyComplexity(messages)).toBe("simple");
            // With tools: +2 + "implement": +1 = score 3 → complex
            expect(classifyComplexity(messages, [{}])).toBe("complex");
        });

        it("boosts score for computation keywords", () => {
            const messages = [textMessage("calculate the total cost")];
            // "calculate": +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("boosts score for code patterns in text", () => {
            const messages = [
                textMessage("function hello() { return 'world'; }"),
            ];
            // code pattern: +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("detects code fences as code patterns", () => {
            const messages = [textMessage("```\nconst x = 1;\n```")];
            // backtick fence: +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });
    });

    describe("message count scoring", () => {
        it("boosts score for 6+ messages", () => {
            const messages = Array.from({ length: 6 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            // messages >= 6: +1 = score 1 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("boosts score for 12+ messages", () => {
            const messages = Array.from({ length: 12 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            // messages >= 6: +1, messages >= 12: +2 = score 3 → complex
            expect(classifyComplexity(messages)).toBe("complex");
        });
    });

    describe("token count scoring", () => {
        it("boosts for large text content over 2000 tokens", () => {
            // ~2000 tokens ≈ 8000 chars
            const longText = "x".repeat(8100);
            const messages = [textMessage(longText)];
            // tokens > 2000: +1 = score 1 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("boosts for very large content over 5000 tokens", () => {
            // ~5000 tokens ≈ 20000 chars
            const longText = "x".repeat(20100);
            const messages = [textMessage(longText)];
            // tokens > 2000: +1, tokens > 5000: +2 = score 3 → complex
            expect(classifyComplexity(messages)).toBe("complex");
        });
    });

    describe("content block handling", () => {
        it("extracts text from array content blocks", () => {
            const messages = [
                textBlockMessage("implement the authentication flow"),
            ];
            // "implement": +1 = score 1
            expect(classifyComplexity(messages)).toBe("simple");
            // With tools: +2 + "implement": +1 = score 3 → complex
            expect(classifyComplexity(messages, [{}])).toBe("complex");
        });

        it("ignores tool_result content for keyword scoring", () => {
            // tool_result has code keywords, but extractMessageText skips them
            const messages = [
                textMessage("help me"),
                toolResultMessage("export function analyze() { const x = 1 }"),
            ];
            // tool_result turns: +1, tool_use/tool_result detected in messages: +2
            // Text extraction only sees "help me" — no code/keyword patterns
            expect(classifyComplexity(messages)).toBe("complex");
        });
    });

    describe("realistic Claude Code scenarios", () => {
        it("classifies first-turn Q&A as moderate with tools", () => {
            const messages = [textMessage("what does this method do?")];
            const tools = [{ name: "bash" }, { name: "read" }];
            // tools: +2 = score 2 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies a file-reading session as complex", () => {
            const messages = [
                textMessage("fix the auth bug"),
                toolUseMessage("Read"),
                toolResultMessage(
                    "export async function authenticate(req) { ... }",
                ),
                textBlockMessage("I see the issue. Let me fix it."),
                toolUseMessage("Edit"),
                toolResultMessage("File updated successfully"),
            ];
            const tools = [{ name: "bash" }, { name: "read" }, { name: "edit" }];
            // tools: +2, tool_result >= 1: +1 = score 3 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("classifies architecture discussion with file reads as complex", () => {
            const messages = [
                textMessage("review the architecture of the auth module"),
                toolUseMessage("Glob"),
                toolResultMessage("src/auth/index.ts\nsrc/auth/service.ts"),
                toolUseMessage("Read"),
                toolResultMessage("export class AuthService { ... }"),
                toolUseMessage("Read"),
                toolResultMessage("export interface AuthConfig { ... }"),
                toolUseMessage("Read"),
                toolResultMessage("import { AuthService } from './service'"),
                toolUseMessage("Read"),
                toolResultMessage("export const authRouter = Router()"),
            ];
            const tools = [{ name: "glob" }, { name: "read" }];
            // tools: +2, "review": +1, tool_result >= 1: +1, tool_result >= 4: +2 = score 6
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });
    });
});
