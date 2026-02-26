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
    describe("simple tier — score < 3", () => {
        it("classifies empty messages as simple", () => {
            expect(classifyComplexity([])).toBe("simple");
        });

        it("classifies a single short text message as simple", () => {
            expect(classifyComplexity([textMessage("hello")])).toBe("simple");
        });

        it("classifies a brief question without tools as simple", () => {
            expect(classifyComplexity([textMessage("what time is it?")])).toBe(
                "simple",
            );
        });

        it("classifies a single keyword without tools as simple", () => {
            // "analyze": +1 = score 1 → simple
            expect(
                classifyComplexity([textMessage("analyze this codebase")]),
            ).toBe("simple");
        });

        it("classifies an engineering keyword without tools as simple", () => {
            // "implement": +1 = score 1 → simple
            expect(
                classifyComplexity([textMessage("implement the new feature")]),
            ).toBe("simple");
        });

        it("classifies tools-only request as simple (score 2)", () => {
            const messages = [textMessage("fix this bug")];
            const tools = [{ name: "bash", description: "run commands" }];
            // tools: +2 = score 2 → simple (< 3 for moderate)
            expect(classifyComplexity(messages, tools)).toBe("simple");
        });

        it("classifies first-turn Q&A with tools as simple", () => {
            const messages = [textMessage("what does this method do?")];
            const tools = [{ name: "bash" }, { name: "read" }];
            // tools: +2 = score 2 → simple
            expect(classifyComplexity(messages, tools)).toBe("simple");
        });

        it("classifies tool_use in messages as simple (no other signals)", () => {
            const messages = [
                textMessage("fix this"),
                toolUseMessage("read_file"),
            ];
            // hasTools: +2 = score 2 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies one tool_result turn as simple when no other signals", () => {
            const messages = [
                textMessage("fix auth middleware"),
                toolUseMessage("read_file"),
                toolResultMessage("export function authMiddleware() {}"),
            ];
            const tools = [{ name: "bash" }];
            // tools: +2, toolResults(1) < 3 = score 2 → simple
            expect(classifyComplexity(messages, tools)).toBe("simple");
        });

        it("classifies tool_result without body tools as simple when under threshold", () => {
            const messages = [
                textMessage("check this"),
                toolUseMessage("read_file"),
                toolResultMessage("const x = 1"),
            ];
            // hasTools: +2, toolResults(1) < 3 = score 2 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies computation keywords as simple (score 2)", () => {
            // "calculate": +2 = score 2 → simple
            expect(
                classifyComplexity([textMessage("calculate the total cost")]),
            ).toBe("simple");
        });

        it("classifies code patterns in text as simple (score 2)", () => {
            // code pattern: +2 = score 2 → simple
            expect(
                classifyComplexity([
                    textMessage("function hello() { return 'world'; }"),
                ]),
            ).toBe("simple");
        });

        it("classifies code fences as simple (score 2)", () => {
            // backtick fence: +2 = score 2 → simple
            expect(
                classifyComplexity([textMessage("```\nconst x = 1;\n```")]),
            ).toBe("simple");
        });

        it("classifies a short file-editing session as simple", () => {
            const messages = [
                textMessage("fix the auth bug"),
                toolUseMessage("Read"),
                toolResultMessage(
                    "export async function authenticate(req) { ... }",
                ),
                toolUseMessage("Edit"),
                toolResultMessage("File updated successfully"),
            ];
            const tools = [
                { name: "bash" },
                { name: "read" },
                { name: "edit" },
            ];
            // tools: +2, messages(5) < 6 = score 2 → simple
            expect(classifyComplexity(messages, tools)).toBe("simple");
        });

        it("classifies tool_result with hasTools as simple when few results", () => {
            const messages = [
                textMessage("help me"),
                toolResultMessage(
                    "export function analyze() { const x = 1 }",
                ),
            ];
            // hasTools: +2, toolResults(1) < 3 = score 2 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies 6+ plain messages as simple (score 1)", () => {
            const messages = Array.from({ length: 6 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            // messages >= 6: +1 = score 1 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });

        it("classifies large text content over 2000 tokens as simple (score 1)", () => {
            const longText = "x".repeat(8100);
            const messages = [textMessage(longText)];
            // tokens > 2000: +1 = score 1 → simple
            expect(classifyComplexity(messages)).toBe("simple");
        });
    });

    describe("moderate tier — score 3-4", () => {
        it("classifies tools plus keyword as moderate (score 3)", () => {
            const messages = [textMessage("analyze this codebase")];
            // tools: +2 + "analyze": +1 = score 3 → moderate
            expect(classifyComplexity(messages, [{}])).toBe("moderate");
        });

        it("classifies tools plus engineering keyword as moderate", () => {
            const messages = [textMessage("implement the new feature")];
            // tools: +2 + "implement": +1 = score 3 → moderate
            expect(classifyComplexity(messages, [{}])).toBe("moderate");
        });

        it("classifies 12+ plain messages as moderate (score 3)", () => {
            const messages = Array.from({ length: 12 }, (_, i) =>
                textMessage(`message ${i}`),
            );
            // messages >= 6: +1, messages >= 12: +2 = score 3 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies very large token content as moderate (score 3)", () => {
            const longText = "x".repeat(20100);
            const messages = [textMessage(longText)];
            // tokens > 2000: +1, tokens > 5000: +2 = score 3 → moderate
            expect(classifyComplexity(messages)).toBe("moderate");
        });

        it("classifies tools plus 6+ messages as moderate (score 3)", () => {
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
            const tools = [
                { name: "bash" },
                { name: "read" },
                { name: "edit" },
            ];
            // tools: +2, messages(6) >= 6: +1 = score 3 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });

        it("classifies text block with tools plus keyword as moderate", () => {
            const messages = [
                textBlockMessage("implement the authentication flow"),
            ];
            // "implement": +1 = score 1 → simple without tools
            expect(classifyComplexity(messages)).toBe("simple");
            // With tools: +2 + "implement": +1 = score 3 → moderate
            expect(classifyComplexity(messages, [{}])).toBe("moderate");
        });

        it("classifies tools plus 3 tool_result turns as moderate (score 3)", () => {
            const messages = [
                textMessage("check these files"),
                toolUseMessage("Read"),
                toolResultMessage("const a = 1"),
                toolUseMessage("Read"),
                toolResultMessage("const b = 2"),
                toolUseMessage("Read"),
                toolResultMessage("const c = 3"),
            ];
            const tools = [{ name: "read" }];
            // tools: +2, toolResults(3) >= 3: +1, messages(7) >= 6: +1 = score 4 → moderate
            expect(classifyComplexity(messages, tools)).toBe("moderate");
        });
    });

    describe("complex tier — score >= 5", () => {
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
            // tools: +2, "review": +1, "architecture": +1, toolResults(5) >= 3: +1 = score 5 → complex
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
            const tools = [
                { name: "bash" },
                { name: "read" },
                { name: "edit" },
            ];
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
});
