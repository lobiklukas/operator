import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { Effect, Layer } from "effect"
import { OperatorApi } from "./api.js"
import { HealthGroupLive, SessionsGroupLive } from "./handlers.js"
import { SseRouteLive } from "./sse.js"

// ---------------------------------------------------------------------------
// Runtime-detected HTTP server layer (Bun or Node)
// ---------------------------------------------------------------------------

export const HttpServerLive = (port: number) =>
	Layer.unwrapEffect(
		Effect.gen(function* () {
			if (typeof globalThis.Bun !== "undefined") {
				const BunHttpServer = yield* Effect.promise(
					() => import("@effect/platform-bun/BunHttpServer"),
				)
				return BunHttpServer.layer({ port })
			}
			const [NodeHttpServer, NodeHttp] = yield* Effect.all([
				Effect.promise(() => import("@effect/platform-node/NodeHttpServer")),
				Effect.promise(() => import("node:http")),
			])
			return NodeHttpServer.layer(NodeHttp.createServer, { port })
		}),
	)

// ---------------------------------------------------------------------------
// Application layer (API routes + middleware)
// Requires: SessionService, EventBus, ConfigService + HttpServer.HttpServer
// ---------------------------------------------------------------------------

export const makeAppLayer = (deps: Layer.Layer<any, any, never>, port: number) => {
	const apiLayer = Layer.mergeAll(
		HttpApiBuilder.api(OperatorApi),
		HealthGroupLive,
		SessionsGroupLive,
		SseRouteLive,
		HttpApiBuilder.middlewareCors(),
	).pipe(Layer.provide(deps))

	return HttpApiBuilder.serve().pipe(
		HttpServer.withLogAddress,
		Layer.provide(apiLayer),
	)
}
