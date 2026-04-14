import { HttpApiBuilder, HttpRouter, HttpServerResponse } from "@effect/platform"
import { Duration, Effect, Schedule, Stream } from "effect"
import { EventBus } from "../bus/index.js"

const encoder = new TextEncoder()
const HEARTBEAT = encoder.encode(": heartbeat\n\n")
const HEARTBEAT_INTERVAL = Duration.seconds(30)

/**
 * Raw SSE route for /api/sessions/:id/events.
 * Uses HttpApiBuilder.Router.use() to register alongside the HttpApi routes.
 *
 * A 30-second heartbeat comment ping prevents proxies and idle connections from
 * being dropped during long agent turns.
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

				const heartbeatStream = Stream.repeatEffect(
					Effect.as(Effect.sleep(HEARTBEAT_INTERVAL), HEARTBEAT),
				)

				return HttpServerResponse.stream(Stream.merge(eventStream, heartbeatStream), {
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
