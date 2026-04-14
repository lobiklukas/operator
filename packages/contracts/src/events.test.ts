import { describe, expect, it } from "vitest"
import { OperatorEvent } from "./events.js"

const now = "2026-04-14T00:00:00.000Z"

describe("OperatorEvent", () => {
	it("parses message.delta event", () => {
		const event = OperatorEvent.parse({
			type: "message.delta",
			sessionId: "sess_01",
			timestamp: now,
			text: "Hello ",
			messageId: "msg_01",
		})
		expect(event.type).toBe("message.delta")
		if (event.type === "message.delta") {
			expect(event.text).toBe("Hello ")
		}
	})

	it("parses tool.start event", () => {
		const event = OperatorEvent.parse({
			type: "tool.start",
			sessionId: "sess_01",
			timestamp: now,
			toolCallId: "tc_1",
			name: "Bash",
			params: { command: "ls" },
			messageId: "msg_01",
		})
		expect(event.type).toBe("tool.start")
	})

	it("parses tool.complete event", () => {
		const event = OperatorEvent.parse({
			type: "tool.complete",
			sessionId: "sess_01",
			timestamp: now,
			toolCallId: "tc_1",
			result: "file1.ts\nfile2.ts",
			messageId: "msg_01",
		})
		expect(event.type).toBe("tool.complete")
	})

	it("parses turn.complete event", () => {
		const event = OperatorEvent.parse({
			type: "turn.complete",
			sessionId: "sess_01",
			timestamp: now,
			messageId: "msg_01",
		})
		expect(event.type).toBe("turn.complete")
	})

	it("parses token.usage event", () => {
		const event = OperatorEvent.parse({
			type: "token.usage",
			sessionId: "sess_01",
			timestamp: now,
			input: 1500,
			output: 300,
		})
		expect(event.type).toBe("token.usage")
	})

	it("parses error event", () => {
		const event = OperatorEvent.parse({
			type: "error",
			sessionId: "sess_01",
			timestamp: now,
			error: "SDK connection failed",
		})
		expect(event.type).toBe("error")
	})

	it("parses system.init event", () => {
		const event = OperatorEvent.parse({
			type: "system.init",
			sessionId: "sess_01",
			timestamp: now,
			model: "claude-sonnet-4-6",
			tools: ["Bash", "Read", "Edit"],
			cwd: "/opt/dev/project",
		})
		expect(event.type).toBe("system.init")
	})

	it("rejects unknown event type", () => {
		expect(() =>
			OperatorEvent.parse({
				type: "unknown.event",
				sessionId: "sess_01",
				timestamp: now,
			}),
		).toThrow()
	})
})
