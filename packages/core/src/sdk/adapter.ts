import { Context, Effect, type Fiber, Layer, Queue, Ref, Stream } from "effect"
import { EventBus } from "../bus/index.js"
import { ConfigService } from "../config/service.js"
import { NoActiveSessionError, SDKImportError, SDKStreamError } from "../errors.js"
import type { SDKSessionConfig } from "./types.js"

interface ActiveSession {
	readonly sessionId: string
	sdkSessionId: string | undefined
	fiber: Fiber.RuntimeFiber<void, SDKStreamError> | undefined
	readonly abortController: AbortController
}

export class SDKAdapter extends Context.Tag("operator/SDKAdapter")<
	SDKAdapter,
	{
		readonly startSession: (config: SDKSessionConfig) => Effect.Effect<void, SDKImportError>
		readonly sendTurn: (
			sessionId: string,
			content: Array<{ type: "text"; text: string }>,
		) => Effect.Effect<void, NoActiveSessionError>
		readonly isSessionActive: (sessionId: string) => Effect.Effect<boolean>
		readonly interruptTurn: (sessionId: string) => Effect.Effect<void>
		readonly stopSession: (sessionId: string) => Effect.Effect<void>
		readonly stopAll: () => Effect.Effect<void>
	}
>() {}

function now(): string {
	return new Date().toISOString()
}

export const SDKAdapterLive: Layer.Layer<SDKAdapter, never, EventBus | ConfigService> =
	Layer.effect(
		SDKAdapter,
		Effect.gen(function* () {
			const bus = yield* EventBus
			const config = yield* ConfigService

			const activeSessions = new Map<string, ActiveSession>()
			const promptQueues = new Map<string, Queue.Queue<{ type: "user"; content: unknown[] }>>()

			// Bridges an Effect Queue to the AsyncIterable interface the SDK requires.
			// Queue.take is Effect<A, never, never> so calling runPromise here is a
			// legitimate world boundary, not an anti-pattern.
			function makePromptIterable(
				sessionId: string,
				queue: Queue.Queue<{ type: "user"; content: unknown[] }>,
			): AsyncIterable<unknown> {
				return {
					[Symbol.asyncIterator]() {
						return {
							async next() {
								const item = await Effect.runPromise(Queue.take(queue))
								return {
									done: false,
									value: {
										type: "user" as const,
										session_id: sessionId,
										message: { role: "user" as const, content: item.content },
										parent_tool_use_id: null,
									},
								}
							},
						}
					},
				}
			}

			// Handles a single SDK event as a pure Effect, closing over `bus` and `currentMessageIdRef`.
			const handleEvent =
				(sessionId: string, currentMessageIdRef: Ref.Ref<string>) =>
				(rawMsg: unknown): Effect.Effect<void> =>
					Effect.gen(function* () {
						const msg = rawMsg as Record<string, unknown>
						const type = msg.type as string

						if (msg.session_id && typeof msg.session_id === "string") {
							const session = activeSessions.get(sessionId)
							if (session) {
								;(session as { sdkSessionId: string | undefined }).sdkSessionId = msg.session_id
							}
						}

						switch (type) {
							case "system": {
								if ((msg.subtype as string) === "init") {
									yield* bus.publish({
										type: "system.init",
										sessionId,
										timestamp: now(),
										model: (msg.model as string) ?? "",
										tools: (msg.tools as string[]) ?? [],
										cwd: (msg.cwd as string) ?? "",
									})
								}
								break
							}

							case "assistant": {
								const msgId = (msg.uuid as string) ?? `msg_${Date.now()}`
								yield* Ref.set(currentMessageIdRef, msgId)
								const message = msg.message as Record<string, unknown> | undefined
								if (message) {
									const content = message.content as unknown[]
									if (Array.isArray(content)) {
										for (const block of content) {
											const b = block as Record<string, unknown>
											if (b.type === "text" && typeof b.text === "string") {
												yield* bus.publish({
													type: "message.delta",
													sessionId,
													timestamp: now(),
													text: b.text,
													messageId: msgId,
												})
											} else if (b.type === "tool_use") {
												yield* bus.publish({
													type: "tool.start",
													sessionId,
													timestamp: now(),
													toolCallId: (b.id as string) ?? "",
													name: (b.name as string) ?? "",
													params: b.input ?? null,
													messageId: msgId,
												})
											}
										}
									}
								}
								break
							}

							case "stream_event": {
								const event = msg.event as Record<string, unknown> | undefined
								if (!event) break
								const eventType = event.type as string
								const currentMessageId = yield* Ref.get(currentMessageIdRef)

								if (eventType === "content_block_delta") {
									const delta = event.delta as Record<string, unknown> | undefined
									if (delta) {
										const deltaType = delta.type as string
										if (deltaType === "text_delta") {
											yield* bus.publish({
												type: "message.delta",
												sessionId,
												timestamp: now(),
												text: (delta.text as string) ?? "",
												messageId: currentMessageId,
											})
										} else if (deltaType === "thinking_delta") {
											yield* bus.publish({
												type: "reasoning.delta",
												sessionId,
												timestamp: now(),
												text: (delta.thinking as string) ?? "",
												messageId: currentMessageId,
											})
										}
									}
								}
								break
							}

							case "result": {
								const currentMessageId = yield* Ref.get(currentMessageIdRef)
								const usage = msg.usage as Record<string, number> | undefined
								if (usage) {
									yield* bus.publish({
										type: "token.usage",
										sessionId,
										timestamp: now(),
										input:
											(usage.input_tokens ?? 0) +
											(usage.cache_creation_input_tokens ?? 0) +
											(usage.cache_read_input_tokens ?? 0),
										output: usage.output_tokens ?? 0,
									})
								}
								yield* bus.publish({
									type: "turn.complete",
									sessionId,
									timestamp: now(),
									messageId: currentMessageId,
								})
								break
							}
						}
					})

			// Processes the SDK output stream as a pure Effect pipeline.
			const runStream = (
				sessionId: string,
				sdkStream: AsyncIterable<unknown>,
				abortSignal: AbortSignal,
			): Effect.Effect<void, SDKStreamError> =>
				Effect.gen(function* () {
					const currentMessageIdRef = yield* Ref.make(`msg_${Date.now()}`)
					yield* Stream.fromAsyncIterable(
						sdkStream,
						(e) => new SDKStreamError({ sessionId, cause: String(e) }),
					).pipe(
						Stream.mapEffect(handleEvent(sessionId, currentMessageIdRef)),
						Stream.runDrain,
					)
				}).pipe(
					Effect.catchAll((err) =>
						abortSignal.aborted
							? Effect.void
							: bus.publish({
									type: "error",
									sessionId,
									timestamp: now(),
									error: err instanceof SDKStreamError ? err.cause : String(err),
								}),
					),
				)

			return {
				startSession: (sdkConfig: SDKSessionConfig) =>
					Effect.gen(function* () {
						yield* Effect.annotateCurrentSpan({
							sessionId: sdkConfig.sessionId,
							model: sdkConfig.model ?? "default",
							resume: sdkConfig.resumeToken !== undefined,
						})
						const cwd = yield* config.cwd()
						const model = yield* config.model()

						const abortController = new AbortController()
						const queue = yield* Queue.unbounded<{ type: "user"; content: unknown[] }>()
						promptQueues.set(sdkConfig.sessionId, queue)

						const promptIterable = makePromptIterable(sdkConfig.sessionId, queue)

						const sdk = yield* Effect.tryPromise({
							try: () => import("@anthropic-ai/claude-agent-sdk"),
							catch: (err) => new SDKImportError({ cause: String(err) }),
						})

						const sdkQuery = sdk.query({
							prompt: promptIterable as Parameters<typeof sdk.query>[0]["prompt"],
							options: {
								cwd: sdkConfig.cwd || cwd,
								model: sdkConfig.model || model,
								settingSources: ["user", "project", "local"] as unknown[],
								permissionMode: "bypassPermissions",
								allowDangerouslySkipPermissions: true,
								sessionId: sdkConfig.resumeToken ? undefined : sdkConfig.sessionId,
								resume: sdkConfig.resumeToken,
								includePartialMessages: true,
								env: process.env as Record<string, string>,
								abortController,
							} as Record<string, unknown>,
						}) as AsyncIterable<unknown>

						const session: ActiveSession = {
							sessionId: sdkConfig.sessionId,
							sdkSessionId: undefined,
							fiber: undefined,
							abortController,
						}
						activeSessions.set(sdkConfig.sessionId, session)

						const fiber = yield* Effect.fork(
							runStream(sdkConfig.sessionId, sdkQuery, abortController.signal).pipe(
								Effect.withSpan("sdk.stream", { attributes: { sessionId: sdkConfig.sessionId } }),
							),
						)
						session.fiber = fiber
					}).pipe(Effect.withSpan("sdk.startSession")),

				sendTurn: (sessionId: string, content: Array<{ type: "text"; text: string }>) =>
					Effect.gen(function* () {
						yield* Effect.annotateCurrentSpan({ sessionId })
						const queue = promptQueues.get(sessionId)
						if (!queue) {
							return yield* Effect.fail(new NoActiveSessionError({ sessionId }))
						}
						yield* Queue.offer(queue, { type: "user", content })
					}).pipe(Effect.withSpan("sdk.sendTurn")),

				isSessionActive: (sessionId: string) =>
					Effect.sync(() => activeSessions.has(sessionId)),

				interruptTurn: (sessionId: string) =>
					Effect.sync(() => {
						activeSessions.get(sessionId)?.abortController.abort()
					}),

				stopSession: (sessionId: string) =>
					Effect.sync(() => {
						const session = activeSessions.get(sessionId)
						if (session) {
							session.abortController.abort()
							activeSessions.delete(sessionId)
							promptQueues.delete(sessionId)
						}
					}),

				stopAll: () =>
					Effect.sync(() => {
						for (const [_id, session] of activeSessions) {
							session.abortController.abort()
						}
						activeSessions.clear()
						promptQueues.clear()
					}),
			}
		}),
	)
