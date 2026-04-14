import { HttpApiBuilder, HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect, Stream } from "effect"
import { EventBus } from "../bus/index.js"

const encoder = new TextEncoder()

/**
 * Raw SSE route for /api/sessions/:id/events.
 * Uses HttpApiBuilder.Router.use() to register alongside the HttpApi routes.
 */
export const SseRouteLive = HttpApiBuilder.Router.use((router) =>
	Effect.gen(function* () {
		const bus = yield* EventBus

		yield* router.get(
			"/api/sessions/:id/events",
			Effect.gen(function* () {
				const params = yield* HttpRouter.params
				const sessionId = params.id

				const eventStream = bus.stream().pipe(
					Stream.filter((event) => event.sessionId === sessionId),
					Stream.map((event) => {
						const sse = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
						return encoder.encode(sse)
					}),
				)

				return HttpServerResponse.stream(eventStream, {
					contentType: "text/event-stream",
					headers: {
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
						"Access-Control-Allow-Origin": "*",
					},
				})
			}),
		)
	}),
)
