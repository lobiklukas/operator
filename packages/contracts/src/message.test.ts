import { describe, expect, it } from "vitest"
import { Message, MessagePart, MessageRole, ToolCallStatus } from "./message.js"

describe("MessageRole", () => {
	it("accepts valid roles", () => {
		expect(MessageRole.parse("user")).toBe("user")
		expect(MessageRole.parse("assistant")).toBe("assistant")
		expect(MessageRole.parse("system")).toBe("system")
	})

	it("rejects invalid roles", () => {
		expect(() => MessageRole.parse("bot")).toThrow()
	})
})

describe("ToolCallStatus", () => {
	it("accepts all valid statuses", () => {
		for (const status of ["pending", "running", "completed", "error"]) {
			expect(ToolCallStatus.parse(status)).toBe(status)
		}
	})
})

describe("MessagePart", () => {
	it("parses a text part", () => {
		const part = MessagePart.parse({ type: "text", content: "Hello" })
		expect(part.type).toBe("text")
		if (part.type === "text") {
			expect(part.content).toBe("Hello")
		}
	})

	it("parses a reasoning part", () => {
		const part = MessagePart.parse({ type: "reasoning", content: "Thinking..." })
		expect(part.type).toBe("reasoning")
	})

	it("parses a tool call part", () => {
		const part = MessagePart.parse({
			type: "tool_call",
			id: "tc_1",
			name: "Read",
			params: { file_path: "/foo/bar.ts" },
			status: "completed",
			result: "file contents here",
		})
		expect(part.type).toBe("tool_call")
		if (part.type === "tool_call") {
			expect(part.name).toBe("Read")
			expect(part.status).toBe("completed")
		}
	})

	it("rejects an unknown part type", () => {
		expect(() => MessagePart.parse({ type: "unknown", data: 123 })).toThrow()
	})
})

describe("Message", () => {
	it("parses a valid message with parts", () => {
		const msg = Message.parse({
			id: "msg_01",
			sessionId: "sess_01",
			role: "assistant",
			parts: [
				{ type: "text", content: "I'll read that file." },
				{
					type: "tool_call",
					id: "tc_1",
					name: "Read",
					params: { file_path: "/tmp/test.ts" },
					status: "completed",
					result: "export default {}",
				},
			],
			tokenUsage: { input: 100, output: 50 },
			createdAt: "2026-04-14T00:00:00.000Z",
		})
		expect(msg.parts).toHaveLength(2)
		expect(msg.tokenUsage?.input).toBe(100)
	})

	it("accepts null token usage", () => {
		const msg = Message.parse({
			id: "msg_02",
			sessionId: "sess_01",
			role: "user",
			parts: [{ type: "text", content: "Fix the bug" }],
			tokenUsage: null,
			createdAt: "2026-04-14T00:00:00.000Z",
		})
		expect(msg.tokenUsage).toBeNull()
	})
})
