import { describe, expect, it } from "vitest"
import { CreateSessionInput, Session, SessionID, SessionStatus } from "./session.js"

describe("SessionStatus", () => {
	it("accepts valid statuses", () => {
		expect(SessionStatus.parse("idle")).toBe("idle")
		expect(SessionStatus.parse("running")).toBe("running")
		expect(SessionStatus.parse("error")).toBe("error")
		expect(SessionStatus.parse("archived")).toBe("archived")
	})

	it("rejects invalid statuses", () => {
		expect(() => SessionStatus.parse("invalid")).toThrow()
	})
})

describe("SessionID", () => {
	it("brands a string as SessionID", () => {
		const id = SessionID.parse("01JFG123ABC")
		expect(id).toBe("01JFG123ABC")
	})
})

describe("CreateSessionInput", () => {
	it("accepts empty input", () => {
		const input = CreateSessionInput.parse({})
		expect(input.model).toBeUndefined()
		expect(input.title).toBeUndefined()
	})

	it("accepts full input", () => {
		const input = CreateSessionInput.parse({
			model: "claude-sonnet-4-6",
			title: "My Session",
		})
		expect(input.model).toBe("claude-sonnet-4-6")
		expect(input.title).toBe("My Session")
	})
})

describe("Session", () => {
	it("parses a valid session", () => {
		const session = Session.parse({
			id: "01JFG123ABC",
			title: "Test Session",
			model: "claude-sonnet-4-6",
			status: "idle",
			resumeToken: null,
			tokenUsageInput: 0,
			tokenUsageOutput: 0,
			createdAt: "2026-04-14T00:00:00.000Z",
			updatedAt: "2026-04-14T00:00:00.000Z",
		})
		expect(session.id).toBe("01JFG123ABC")
		expect(session.status).toBe("idle")
	})

	it("rejects session with invalid status", () => {
		expect(() =>
			Session.parse({
				id: "01JFG123ABC",
				title: "Test",
				model: "claude-sonnet-4-6",
				status: "bogus",
				resumeToken: null,
				tokenUsageInput: 0,
				tokenUsageOutput: 0,
				createdAt: "2026-04-14T00:00:00.000Z",
				updatedAt: "2026-04-14T00:00:00.000Z",
			}),
		).toThrow()
	})
})
