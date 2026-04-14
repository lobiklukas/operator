import { describe, expect, it } from "vitest"
import { createClient } from "./client.js"

describe("createClient", () => {
	it("creates a client with all methods", () => {
		const client = createClient("http://localhost:3000")
		expect(typeof client.health).toBe("function")
		expect(typeof client.listSessions).toBe("function")
		expect(typeof client.getSession).toBe("function")
		expect(typeof client.createSession).toBe("function")
		expect(typeof client.sendPrompt).toBe("function")
		expect(typeof client.interruptTurn).toBe("function")
		expect(typeof client.archiveSession).toBe("function")
		expect(typeof client.subscribeEvents).toBe("function")
	})
})
