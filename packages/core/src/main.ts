import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { HttpServer } from "@effect/platform"
import { Effect, Layer, ManagedRuntime } from "effect"
import type { ConfigOptions } from "./config/service.js"
import { createMainLayer } from "./effect/layers.js"
import { HttpServerLive, makeAppLayer } from "./server/server.js"
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

	const serviceLayer = createMainLayer({
		config: options,
		dbPath,
	})

	const httpLayer = HttpServerLive(0)

	// App layer: serves the HttpApi on the HttpServer
	const appLayer = makeAppLayer(serviceLayer, 0).pipe(
		Layer.provide(httpLayer),
	)

	// Full layer: app + services + http server (for address reading)
	const fullLayer = Layer.mergeAll(appLayer, serviceLayer, httpLayer)

	const runtime = ManagedRuntime.make(fullLayer)

	// Run migrations
	await runtime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService
			runMigrations(storage.db)
		}),
	)

	// Read the actual server address
	const address = await runtime.runPromise(
		Effect.gen(function* () {
			const server = yield* HttpServer.HttpServer
			const addr = server.address
			if (addr._tag === "TcpAddress") {
				return { port: addr.port, url: `http://localhost:${String(addr.port)}` }
			}
			return { port: 0, url: "unknown" }
		}),
	)

	return {
		port: address.port,
		url: address.url,
		stop: () => runtime.dispose(),
	}
}

// Start when run directly
if (import.meta.main) {
	await startServer()
}
