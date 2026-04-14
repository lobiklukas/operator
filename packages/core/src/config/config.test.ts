import { describe, expect, it } from "bun:test"
import { DEFAULT_CONFIG, OperatorConfig } from "./schema.js"

describe("OperatorConfig", () => {
	it("provides sensible defaults", () => {
		const config = OperatorConfig.parse({})
		expect(config.model).toBe("claude-sonnet-4-6")
		expect(config.server.port).toBe(0)
		expect(config.cwd).toBeUndefined()
	})

	it("overrides defaults", () => {
		const config = OperatorConfig.parse({
			model: "claude-opus-4-6",
			server: { port: 8080 },
		})
		expect(config.model).toBe("claude-opus-4-6")
		expect(config.server.port).toBe(8080)
	})

	it("rejects invalid port", () => {
		expect(() =>
			OperatorConfig.parse({
				server: { port: -1 },
			}),
		).toThrow()

		expect(() =>
			OperatorConfig.parse({
				server: { port: 70000 },
			}),
		).toThrow()
	})

	it("DEFAULT_CONFIG has expected shape", () => {
		expect(DEFAULT_CONFIG.model).toBe("claude-sonnet-4-6")
		expect(DEFAULT_CONFIG.server.port).toBe(0)
	})
})
