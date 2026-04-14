import { describe, expect, it } from "bun:test"
import type { OperatorEvent } from "@operator/contracts"
import { Effect, Queue } from "effect"
import { EventBus, EventBusLive } from "./index.js"

const testEvent: OperatorEvent = {
	type: "session.created",
	sessionId: "test-session",
	timestamp: new Date().toISOString(),
}

describe("EventBus", () => {
	it("publishes and receives events", async () => {
		const program = Effect.gen(function* () {
			const bus = yield* EventBus

			const dequeue = yield* bus.subscribe()
			yield* bus.publish(testEvent)

			const received = yield* Queue.take(dequeue)
			return received
		})

		const result = await Effect.runPromise(
			program.pipe(Effect.provide(EventBusLive), Effect.scoped),
		)

		expect(result).toEqual(testEvent)
	})

	it("supports multiple subscribers", async () => {
		const program = Effect.gen(function* () {
			const bus = yield* EventBus

			const dequeue1 = yield* bus.subscribe()
			const dequeue2 = yield* bus.subscribe()

			yield* bus.publish(testEvent)

			const r1 = yield* Queue.take(dequeue1)
			const r2 = yield* Queue.take(dequeue2)
			return [r1, r2]
		})

		const results = await Effect.runPromise(
			program.pipe(Effect.provide(EventBusLive), Effect.scoped),
		)

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual(testEvent)
		expect(results[1]).toEqual(testEvent)
	})

	it("filters events by session via stream", async () => {
		const event1: OperatorEvent = {
			type: "session.created",
			sessionId: "session-a",
			timestamp: new Date().toISOString(),
		}
		const event2: OperatorEvent = {
			type: "session.created",
			sessionId: "session-b",
			timestamp: new Date().toISOString(),
		}

		const program = Effect.gen(function* () {
			const bus = yield* EventBus
			const dequeue = yield* bus.subscribe()

			yield* bus.publish(event1)
			yield* bus.publish(event2)

			const r1 = yield* Queue.take(dequeue)
			const r2 = yield* Queue.take(dequeue)

			return [r1, r2].filter((e) => e.sessionId === "session-a")
		})

		const results = await Effect.runPromise(
			program.pipe(Effect.provide(EventBusLive), Effect.scoped),
		)

		expect(results).toHaveLength(1)
		expect(results[0]?.sessionId).toBe("session-a")
	})
})
