import type { MessagePart, OperatorEvent } from "@operator/contracts"
import { eq } from "drizzle-orm"
import { Effect, Layer, Stream } from "effect"
import { EventBus } from "../bus/index.js"
import { StorageService } from "../storage/database.js"
import * as dbSchema from "../storage/schema.js"

interface MessageBuffer {
	sessionId: string
	parts: MessagePart[]
}

function now(): string {
	return new Date().toISOString()
}

/**
 * Background service that subscribes to the event bus and persists assistant
 * messages + session state to SQLite. Runs as a scoped fiber — no public API.
 *
 * Responsibilities:
 * - Buffer message.delta / reasoning.delta / tool.* per messageId
 * - Flush the complete message to DB on turn.complete
 * - Reset session status to "idle" on turn.complete
 * - Update session token counts on token.usage
 */
export const EventPersisterLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const bus = yield* EventBus
		const storage = yield* StorageService
		const { db } = storage

		// In-memory buffer: messageId → accumulated content for the current turn
		const buffer = new Map<string, MessageBuffer>()

		function getOrCreate(messageId: string, sessionId: string): MessageBuffer {
			let entry = buffer.get(messageId)
			if (!entry) {
				entry = { sessionId, parts: [] }
				buffer.set(messageId, entry)
			}
			return entry
		}

		const handleEvent = (event: OperatorEvent): Effect.Effect<void> =>
			Effect.sync(() => {
				switch (event.type) {
					case "message.delta": {
						const entry = getOrCreate(event.messageId, event.sessionId)
						const last = entry.parts[entry.parts.length - 1]
						if (last?.type === "text") {
							entry.parts[entry.parts.length - 1] = {
								type: "text",
								content: last.content + event.text,
							}
						} else {
							entry.parts.push({ type: "text", content: event.text })
						}
						break
					}

					case "reasoning.delta": {
						const entry = getOrCreate(event.messageId, event.sessionId)
						const last = entry.parts[entry.parts.length - 1]
						if (last?.type === "reasoning") {
							entry.parts[entry.parts.length - 1] = {
								type: "reasoning",
								content: last.content + event.text,
							}
						} else {
							entry.parts.push({ type: "reasoning", content: event.text })
						}
						break
					}

					case "tool.start": {
						const entry = getOrCreate(event.messageId, event.sessionId)
						entry.parts.push({
							type: "tool_call",
							id: event.toolCallId,
							name: event.name,
							params: event.params,
							status: "running",
						})
						break
					}

					case "tool.complete": {
						const entry = buffer.get(event.messageId)
						if (entry) {
							entry.parts = entry.parts.map((p) =>
								p.type === "tool_call" && p.id === event.toolCallId
									? { ...p, status: "completed" as const, result: event.result }
									: p,
							)
						}
						break
					}

					case "tool.error": {
						const entry = buffer.get(event.messageId)
						if (entry) {
							entry.parts = entry.parts.map((p) =>
								p.type === "tool_call" && p.id === event.toolCallId
									? { ...p, status: "error" as const, result: event.error }
									: p,
							)
						}
						break
					}

					case "turn.complete": {
						const entry = buffer.get(event.messageId)
						if (entry && entry.parts.length > 0) {
							db.insert(dbSchema.messages)
								.values({
									id: event.messageId,
									sessionId: entry.sessionId,
									role: "assistant",
									parts: entry.parts as unknown[],
									tokenUsage: null,
									createdAt: now(),
								})
								.run()
							buffer.delete(event.messageId)
						}
						db.update(dbSchema.sessions)
							.set({ status: "idle", updatedAt: now() })
							.where(eq(dbSchema.sessions.id, event.sessionId))
							.run()
						break
					}

					case "token.usage": {
						db.update(dbSchema.sessions)
							.set({
								tokenUsageInput: event.input,
								tokenUsageOutput: event.output,
								updatedAt: now(),
							})
							.where(eq(dbSchema.sessions.id, event.sessionId))
							.run()
						break
					}
				}
			})

		yield* bus.stream().pipe(Stream.runForEach(handleEvent), Effect.forkScoped)
	}),
)
