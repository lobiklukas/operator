import type { OperatorEvent } from "@operator/contracts"
import { Context, Effect, Layer, PubSub, type Queue, type Scope, Stream } from "effect"

export class EventBus extends Context.Tag("operator/EventBus")<
	EventBus,
	{
		readonly publish: (event: OperatorEvent) => Effect.Effect<void>
		readonly subscribe: () => Effect.Effect<Queue.Dequeue<OperatorEvent>, never, Scope.Scope>
		readonly stream: () => Stream.Stream<OperatorEvent>
	}
>() {}

export const EventBusLive = Layer.scoped(
	EventBus,
	Effect.gen(function* () {
		const pubsub = yield* PubSub.unbounded<OperatorEvent>()

		return {
			publish: (event: OperatorEvent) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
			subscribe: () => PubSub.subscribe(pubsub),
			stream: () => Stream.fromPubSub(pubsub),
		}
	}),
)
