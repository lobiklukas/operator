import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionID } from "@operator/contracts"
import { Effect, Layer } from "effect"
import { EventBusLive } from "../bus/index.js"
import { ConfigServiceLive } from "../config/service.js"
import { SDKAdapter } from "../sdk/adapter.js"
import { StorageService, StorageServiceLive, runMigrations } from "../storage/database.js"
import { SessionService, SessionServiceLive } from "./service.js"

const testDbPath = join(tmpdir(), `operator-test-${Date.now()}.sqlite`)

// Mock SDK adapter that does nothing
const MockSDKAdapter = Layer.succeed(SDKAdapter, {
	startSession: () => Effect.void,
	sendTurn: () => Effect.void,
	interruptTurn: () => Effect.void,
	stopSession: () => Effect.void,
	stopAll: () => Effect.void,
})

function createTestLayer() {
	const StorageLayer = StorageServiceLive(testDbPath)
	const BusLayer = EventBusLive
	const ConfigLayer = ConfigServiceLive({ model: "test-model" })

	return SessionServiceLive.pipe(
		Layer.provide(StorageLayer),
		Layer.provide(BusLayer),
		Layer.provide(ConfigLayer),
		Layer.provide(MockSDKAdapter),
	)
}

describe("SessionService", () => {
	beforeEach(async () => {
		// Run migrations
		const setupProgram = Effect.gen(function* () {
			const storage = yield* StorageService
			runMigrations(storage.db)
		})
		await Effect.runPromise(
			setupProgram.pipe(Effect.provide(StorageServiceLive(testDbPath)), Effect.scoped),
		)
	})

	afterEach(() => {
		if (existsSync(testDbPath)) {
			try {
				unlinkSync(testDbPath)
			} catch {
				// ignore
			}
		}
		const walPath = `${testDbPath}-wal`
		if (existsSync(walPath)) {
			try {
				unlinkSync(walPath)
			} catch {
				// ignore
			}
		}
		const shmPath = `${testDbPath}-shm`
		if (existsSync(shmPath)) {
			try {
				unlinkSync(shmPath)
			} catch {
				// ignore
			}
		}
	})

	it("creates a session", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const session = yield* service.create({ title: "Test" })
			expect(session.title).toBe("Test")
			expect(session.model).toBe("test-model")
			expect(session.status).toBe("idle")
			return session
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("gets a session by id", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const created = yield* service.create({ title: "Find Me" })
			const found = yield* service.get(created.id)
			expect(found.id).toBe(created.id)
			expect(found.title).toBe("Find Me")
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("lists sessions", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			yield* service.create({ title: "Session 1" })
			yield* service.create({ title: "Session 2" })
			const sessions = yield* service.list()
			expect(sessions.length).toBe(2)
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("appends and retrieves messages", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const session = yield* service.create({})

			yield* service.appendMessage(session.id, "user", [{ type: "text", content: "Hello" }])
			yield* service.appendMessage(session.id, "assistant", [
				{ type: "text", content: "Hi there!" },
			])

			const messages = yield* service.getMessages(session.id)
			expect(messages.length).toBe(2)
			expect(messages[0]?.role).toBe("user")
			expect(messages[1]?.role).toBe("assistant")
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("archives a session", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const session = yield* service.create({})
			yield* service.archive(session.id)
			const archived = yield* service.get(session.id)
			expect(archived.status).toBe("archived")
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("gets most recent session", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			yield* service.create({ title: "Older" })
			yield* service.create({ title: "Newer" })
			const recent = yield* service.getMostRecent()
			expect(recent?.title).toBe("Newer")
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("updates resume token", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const session = yield* service.create({})
			yield* service.updateResumeToken(session.id, "resume-abc-123")
			const updated = yield* service.get(session.id)
			expect(updated.resumeToken).toBe("resume-abc-123")
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("updates token usage", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const session = yield* service.create({})
			yield* service.updateTokenUsage(session.id, 1500, 300)
			const updated = yield* service.get(session.id)
			expect(updated.tokenUsageInput).toBe(1500)
			expect(updated.tokenUsageOutput).toBe(300)
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})

	it("returns error for non-existent session", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SessionService
			const result = yield* Effect.either(service.get("nonexistent" as SessionID))
			expect(result._tag).toBe("Left")
		})

		await Effect.runPromise(program.pipe(Effect.provide(createTestLayer()), Effect.scoped))
	})
})
