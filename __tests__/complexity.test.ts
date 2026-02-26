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

        it("classifies a single keyword without tools as simple", () => {
            const messages = [textMessage("analyze this codebase")];
            // "analyze": +1 = score 1 → simple (no tools)
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies an engineering keyword without tools as simple", () => {
            const messages = [textMessage("implement the new feature")];
            // "implement": +1 = score 1 → simple (no tools)
            expect(classifyComplexity(messages)).toBe("simple");
        });
    });

    describe("moderate tier", () => {
        it("classifies a request with body tools as moderate", () => {
            const messages = [textMessage("fix this bug")];
            const tools = [{ name: "bash", description: "run commands" }];
            // tools: +2 = score 2 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies a request with tool_use blocks as moderate", () => {
            const messages = [
                textMessage("fix this"),
                toolUseMessage("read_file"),
            ];
            // hasTools (tool_use in messages): +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies a session with one tool_result turn as moderate", () => {
            const messages = [
                textMessage("fix auth middleware"),
                toolUseMessage("read_file"),
                toolResultMessage("export function authMiddleware() {}"),
            ];
            const tools = [{ name: "bash" }];
            // tools: +2, toolResults(1) < 3 threshold = score 2 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies tool_result turns without body tools as moderate when under threshold", () => {
            const messages = [
                textMessage("check this"),
                toolUseMessage("read_file"),
                toolResultMessage("const x = 1"),
            ];
            // tool_use in messages: +2, toolResults(1) < 3 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies tools plus keyword as moderate (not complex)", () => {
            const messages = [textMessage("analyze this codebase")];
            // tools: +2 + "analyze": +1 = score 3 → moderate (< 5 for complex)
            expect(classifyComplexity(messages, [{}])).toBe("moderate");
        });

        it("classifies tools plus engineering keyword as moderate", () => {
            const messages = [textMessage("implement the new feature")];
            // tools: +2 + "implement": +1 = score 3 → moderate
            expect(classifyComplexity(messages, [{}])).toBe("moderate");
        });

        it("classifies computation keywords as moderate", () => {
            const messages = [textMessage("calculate the total cost")];
            // "calculate": +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies code patterns in text as moderate", () => {
            const messages = [
                textMessage("function hello() { return 'world'; }"),
            ];
            // code pattern: +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("detects code fences as moderate", () => {
            const messages = [textMessage("```\nconst x = 1;\n```")];
            // backtick fence: +2 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies 12+ plain messages as moderate", () => {
            const messages = Array.from({ length: 12 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            // messages >= 6: +1, messages >= 12: +2 = score 3 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies very large token content as moderate", () => {
            // ~5000 tokens ≈ 20000 chars
            const longText = "x".repeat(20100);
            const messages = [textMessage(longText)];
            // tokens > 2000: +1, tokens > 5000: +2 = score 3 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies first-turn Q&A with tools as moderate", () => {
            const messages = [textMessage("what does this method do?")];
            const tools = [{ name: "bash" }, { name: "read" }];
            // tools: +2 = score 2 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies a shallow file-reading session as moderate when short", () => {
            const messages = [
                textMessage("fix the auth bug"),
                toolUseMessage("Read"),
                toolResultMessage(
                    "export async function authenticate(req) { ... }",
                ),
                toolUseMessage("Edit"),
                toolResultMessage("File updated successfully"),
            ];
            const tools = [{ name: "bash" }, { name: "read" }, { name: "edit" }];
            // tools: +2, messages(5) < 6 = score 2 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("escalates to complex when file-reading session grows to 6+ messages", () => {
            const messages = [
                textMessage("fix the auth bug"),
                toolUseMessage("Read"),
                toolResultMessage(
                    "export async function authenticate(req) { ... }",
                ),
                textBlockMessage("I see the issue. I will fix it."),
                toolUseMessage("Edit"),
                toolResultMessage("File updated successfully"),
            ];
            const tools = [{ name: "bash" }, { name: "read" }, { name: "edit" }];
            // tools: +2, messages(6) >= 6: +1, "will fix" no code triggers = score 3 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies text block content with tools plus keyword as moderate", () => {
            const messages = [
                textBlockMessage("implement the authentication flow"),
            ];
            // "implement": +1 = score 1 → simple without tools
            expect(classifyComplexity(messages)).toBe("simple");
            // With tools: +2 + "implement": +1 = score 3 → moderate
            expect(classifyComplexity(messages, [{}])).toBe("moderate");
        });

        it("classifies tool_result presence with hasTools as moderate when few results", () => {
            // tool_result has code keywords, but extractMessageText skips them
            const messages = [
                textMessage("help me"),
                toolResultMessage("export function analyze() { const x = 1 }"),
            ];
            // hasTools (tool_result in messages): +2, toolResults(1) < 3 = score 2 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });
    });

    describe("complex tier", () => {
        it("classifies a deep multi-file session with keyword as complex", () => {
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
            // tools: +2, "refactor": +1, toolResults(4) >= 3: +1, messages(9) >= 6: +1 = score 5 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("classifies architecture discussion with many file reads as complex", () => {
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
            // tools: +2, "review": +1, toolResults(5) >= 3: +1, "architecture": +1 = score 5 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("classifies a deep agentic session with 6+ tool_results as complex", () => {
            const messages = [
                textMessage("fix the authentication system"),
                toolUseMessage("Read"),
                toolResultMessage("export class AuthService {}"),
                toolUseMessage("Read"),
                toolResultMessage("export interface AuthConfig {}"),
                toolUseMessage("Read"),
                toolResultMessage("import { AuthService } from './service'"),
                toolUseMessage("Grep"),
                toolResultMessage("Found 12 references"),
                toolUseMessage("Read"),
                toolResultMessage("export const middleware = () => {}"),
                toolUseMessage("Read"),
                toolResultMessage("export const authRouter = Router()"),
                toolUseMessage("Edit"),
                toolResultMessage("File updated successfully"),
            ];
            const tools = [{ name: "bash" }, { name: "read" }, { name: "edit" }];
            // tools: +2, toolResults(7) >= 3: +1, toolResults(7) >= 6: +2 = score 5 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("classifies code patterns plus tools plus long conversation as complex", () => {
            const messages = Array.from({ length: 7 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            messages.push(textMessage("function foo() { return bar(); }"));
            const tools = [{ name: "bash" }];
            // tools: +2, codePattern: +2, messages >= 6: +1 = score 5 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });

        it("classifies very large tokens plus tools plus keywords as complex", () => {
            const longText = "x".repeat(20100);
            const messages = [
                textMessage(longText),
                textMessage("analyze and refactor this code"),
            ];
            const tools = [{ name: "bash" }];
            // tools: +2, tokens>2000: +1, tokens>5000: +2, "analyze": +1 = score 6 → complex
            expect(classifyComplexity(messages, tools)).toBe("complex");
        });
    });

    describe("message count scoring", () => {
        it("classifies 6+ messages as simple (score 1)", () => {
            const messages = Array.from({ length: 6 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            // messages >= 6: +1 = score 1 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies large text content over 2000 tokens as simple (score 1)", () => {
            // ~2000 tokens ≈ 8000 chars
            const longText = "x".repeat(8100);
            const messages = [textMessage(longText)];
            // tokens > 2000: +1 = score 1 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });
    });
});
