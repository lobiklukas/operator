import { Effect, Queue } from "effect"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { EventBus } from "../../bus/index.js"

export function createEventRoutes(
	eventBus: EventBus["Type"],
	_runEffect: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
) {
	const app = new Hono()

	app.get("/:id/events", (c) => {
		const sessionId = c.req.param("id")

		return streamSSE(c, async (stream) => {
			const dequeue = await Effect.runPromise(eventBus.subscribe().pipe(Effect.scoped))

			try {
				while (!c.req.raw.signal.aborted) {
					const event = await Effect.runPromise(Queue.take(dequeue))
					if (event.sessionId === sessionId) {
						await stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
						})
					}
				}
			} catch {
				// Stream closed
			}
		})
	})

	return app
}
