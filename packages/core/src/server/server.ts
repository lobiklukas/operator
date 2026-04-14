import { Context, Effect, Layer } from "effect"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { EventBus } from "../bus/index.js"
import { ConfigService } from "../config/service.js"
import { SessionService } from "../session/service.js"
import { createEventRoutes } from "./routes/events.js"
import { createSessionRoutes } from "./routes/sessions.js"

export class ServerService extends Context.Tag("operator/ServerService")<
	ServerService,
	{
		readonly start: () => Effect.Effect<{ port: number; url: string }, Error>
		readonly stop: () => Effect.Effect<void>
	}
>() {}

export const ServerServiceLive = Layer.effect(
	ServerService,
	Effect.gen(function* () {
		const sessionService = yield* SessionService
		const eventBus = yield* EventBus
		const config = yield* ConfigService

		let server: ReturnType<typeof Bun.serve> | null = null

		const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
			Effect.runPromise(effect as Effect.Effect<A, never>)

		return {
			start: () =>
				Effect.gen(function* () {
					const cfg = yield* config.get()

					const app = new Hono()
					app.use("/*", cors())

					app.get("/api/health", (c) => c.json({ status: "ok" as const, version: "0.1.0" }))

					const sessionRoutes = createSessionRoutes(sessionService, runEffect)
					app.route("/api/sessions", sessionRoutes)

					const eventRoutes = createEventRoutes(eventBus, runEffect)
					app.route("/api/sessions", eventRoutes)

					const port = cfg.server.port || 0

					server = Bun.serve({
						port,
						fetch: app.fetch,
					})

					const actualPort = server.port ?? 0
					const url = `http://localhost:${String(actualPort)}`

					return { port: actualPort, url }
				}),

			stop: () =>
				Effect.sync(() => {
					if (server) {
						server.stop()
						server = null
					}
				}),
		}
	}),
)
