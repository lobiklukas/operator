import { Context, Effect, type Fiber, Layer, Queue } from "effect"
import { EventBus } from "../bus/index.js"
import { ConfigService } from "../config/service.js"
import type { SDKSessionConfig } from "./types.js"

interface ActiveSession {
	readonly sessionId: string
	readonly sdkSessionId: string | undefined
	fiber: Fiber.RuntimeFiber<void, Error> | undefined
	abortController: AbortController
}

export class SDKAdapter extends Context.Tag("operator/SDKAdapter")<
	SDKAdapter,
	{
		readonly startSession: (config: SDKSessionConfig) => Effect.Effect<void, Error>
		readonly sendTurn: (
			sessionId: string,
			content: Array<{ type: "text"; text: string }>,
		) => Effect.Effect<void, Error>
		readonly interruptTurn: (sessionId: string) => Effect.Effect<void, Error>
		readonly stopSession: (sessionId: string) => Effect.Effect<void, Error>
		readonly stopAll: () => Effect.Effect<void, Error>
	}
>() {}

function now(): string {
	return new Date().toISOString()
}

export const SDKAdapterLive = Layer.effect(
	SDKAdapter,
	Effect.gen(function* () {
		const bus = yield* EventBus
		const config = yield* ConfigService

		const activeSessions = new Map<string, ActiveSession>()
		const promptQueues = new Map<string, Queue.Queue<{ type: "user"; content: unknown[] }>>()

		function makePromptIterable(
			queue: Queue.Queue<{ type: "user"; content: unknown[] }>,
		): AsyncIterable<unknown> {
			return {
				[Symbol.asyncIterator]() {
					return {
						async next() {
							const take = Queue.take(queue)
							const item = await Effect.runPromise(take)
							return {
								done: false,
								value: {
									type: "user" as const,
									session_id: "",
									message: { role: "user" as const, content: item.content },
									parent_tool_use_id: null,
								},
							}
						},
					}
				},
			}
		}

		async function processStream(
			sessionId: string,
			stream: AsyncIterable<unknown>,
			abortSignal: AbortSignal,
		): Promise<void> {
			let currentMessageId = `msg_${Date.now()}`
			let sdkSessionId: string | undefined

			try {
				for await (const rawMsg of stream) {
					if (abortSignal.aborted) break

					const msg = rawMsg as Record<string, unknown>
					const type = msg.type as string

					if (msg.session_id && typeof msg.session_id === "string") {
						sdkSessionId = msg.session_id
						const session = activeSessions.get(sessionId)
						if (session) {
							;(session as { sdkSessionId: string | undefined }).sdkSessionId = sdkSessionId
						}
					}

					switch (type) {
						case "system": {
							const subtype = msg.subtype as string
							if (subtype === "init") {
								const initMsg = msg as Record<string, unknown>
								await Effect.runPromise(
									bus.publish({
										type: "system.init",
										sessionId,
										timestamp: now(),
										model: (initMsg.model as string) ?? "",
										tools: (initMsg.tools as string[]) ?? [],
										cwd: (initMsg.cwd as string) ?? "",
									}),
								)
							}
							break
						}

						case "assistant": {
							currentMessageId = (msg.uuid as string) ?? `msg_${Date.now()}`
							const message = msg.message as Record<string, unknown> | undefined
							if (message) {
								const content = message.content as unknown[]
								if (Array.isArray(content)) {
									for (const block of content) {
										const b = block as Record<string, unknown>
										if (b.type === "text" && typeof b.text === "string") {
											await Effect.runPromise(
												bus.publish({
													type: "message.delta",
													sessionId,
													timestamp: now(),
													text: b.text,
													messageId: currentMessageId,
												}),
											)
										} else if (b.type === "tool_use") {
											await Effect.runPromise(
												bus.publish({
													type: "tool.start",
													sessionId,
													timestamp: now(),
													toolCallId: (b.id as string) ?? "",
													name: (b.name as string) ?? "",
													params: b.input ?? null,
													messageId: currentMessageId,
												}),
											)
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

							if (eventType === "content_block_delta") {
								const delta = event.delta as Record<string, unknown> | undefined
								if (delta) {
									const deltaType = delta.type as string
									if (deltaType === "text_delta") {
										await Effect.runPromise(
											bus.publish({
												type: "message.delta",
												sessionId,
												timestamp: now(),
												text: (delta.text as string) ?? "",
												messageId: currentMessageId,
											}),
										)
									} else if (deltaType === "thinking_delta") {
										await Effect.runPromise(
											bus.publish({
												type: "reasoning.delta",
												sessionId,
												timestamp: now(),
												text: (delta.thinking as string) ?? "",
												messageId: currentMessageId,
											}),
										)
									}
								}
							}
							break
						}

						case "result": {
							const usage = msg.usage as Record<string, number> | undefined
							if (usage) {
								await Effect.runPromise(
									bus.publish({
										type: "token.usage",
										sessionId,
										timestamp: now(),
										input:
											(usage.input_tokens ?? 0) +
											(usage.cache_creation_input_tokens ?? 0) +
											(usage.cache_read_input_tokens ?? 0),
										output: usage.output_tokens ?? 0,
									}),
								)
							}

							await Effect.runPromise(
								bus.publish({
									type: "turn.complete",
									sessionId,
									timestamp: now(),
									messageId: currentMessageId,
								}),
							)
							break
						}
					}
				}
			} catch (err) {
				if (!abortSignal.aborted) {
					await Effect.runPromise(
						bus.publish({
							type: "error",
							sessionId,
							timestamp: now(),
							error: err instanceof Error ? err.message : String(err),
						}),
					)
				}
			}
		}

		return {
			startSession: (sdkConfig: SDKSessionConfig) =>
				Effect.gen(function* () {
					const cwd = yield* config.cwd()
					const model = yield* config.model()

					const abortController = new AbortController()
					const queue = yield* Queue.unbounded<{ type: "user"; content: unknown[] }>()
					promptQueues.set(sdkConfig.sessionId, queue)

					const promptIterable = makePromptIterable(queue)

					let sdkQuery: AsyncIterable<unknown>
					try {
						const sdk = yield* Effect.tryPromise({
							try: () => import("@anthropic-ai/claude-agent-sdk"),
							catch: (err) => new Error(`Failed to import SDK: ${err}`),
						})
						sdkQuery = sdk.query({
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
					} catch (err) {
						yield* bus.publish({
							type: "error",
							sessionId: sdkConfig.sessionId,
							timestamp: now(),
							error: `Failed to start SDK session: ${err instanceof Error ? err.message : String(err)}`,
						})
						return
					}

					const session: ActiveSession = {
						sessionId: sdkConfig.sessionId,
						sdkSessionId: undefined,
						fiber: undefined,
						abortController,
					}
					activeSessions.set(sdkConfig.sessionId, session)

					const fiber = yield* Effect.fork(
						Effect.tryPromise({
							try: () => processStream(sdkConfig.sessionId, sdkQuery, abortController.signal),
							catch: (err) => new Error(String(err)),
						}),
					)
					session.fiber = fiber
				}),

			sendTurn: (sessionId: string, content: Array<{ type: "text"; text: string }>) =>
				Effect.gen(function* () {
					const queue = promptQueues.get(sessionId)
					if (!queue) {
						yield* Effect.fail(new Error(`No active session: ${sessionId}`))
						return
					}
					yield* Queue.offer(queue, { type: "user", content })
				}),

			interruptTurn: (sessionId: string) =>
				Effect.sync(() => {
					const session = activeSessions.get(sessionId)
					if (session) {
						session.abortController.abort()
					}
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
