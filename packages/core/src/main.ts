import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { Effect, ManagedRuntime } from "effect"
import type { ConfigOptions } from "./config/service.js"
import { createMainLayer } from "./effect/layers.js"
import { ServerService } from "./server/server.js"
import { StorageService, runMigrations } from "./storage/database.js"

export interface StartResult {
	readonly port: number
	readonly url: string
	readonly stop: () => Promise<void>
}

export async function startServer(options: ConfigOptions = {}): Promise<StartResult> {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
	const dbDir = join(home, ".operator")
	if (!existsSync(dbDir)) {
		mkdirSync(dbDir, { recursive: true })
	}
	const dbPath = join(dbDir, "database.sqlite")

	const mainLayer = createMainLayer({
		config: options,
		dbPath,
	})

	const runtime = ManagedRuntime.make(mainLayer)

	// Run migrations
	await runtime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService
			runMigrations(storage.db)
		}),
	)

	// Start server
	const { port, url } = await runtime.runPromise(
		Effect.gen(function* () {
			const server = yield* ServerService
			return yield* server.start()
		}),
	)

	return {
		port,
		url,
		stop: async () => {
			await runtime.runPromise(
				Effect.gen(function* () {
					const server = yield* ServerService
					yield* server.stop()
				}),
			)
			await runtime.dispose()
		},
	}
}
