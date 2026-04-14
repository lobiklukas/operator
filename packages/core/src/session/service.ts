import type {
	CreateSessionInput,
	Message,
	MessagePart,
	Session,
	SessionID,
} from "@operator/contracts"
import { desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { ulid } from "ulid"
import { EventBus } from "../bus/index.js"
import { ConfigService } from "../config/service.js"
import { NoActiveSessionError, SDKImportError, SessionNotFoundError } from "../errors.js"
import { SDKAdapter } from "../sdk/adapter.js"
import { StorageService } from "../storage/database.js"
import * as dbSchema from "../storage/schema.js"

function now(): string {
	return new Date().toISOString()
}

export class SessionService extends Context.Tag("operator/SessionService")<
	SessionService,
	{
		readonly create: (input: CreateSessionInput) => Effect.Effect<Session>
		readonly get: (id: SessionID) => Effect.Effect<Session, SessionNotFoundError>
		readonly list: () => Effect.Effect<ReadonlyArray<Session>>
		readonly getMessages: (sessionId: SessionID) => Effect.Effect<ReadonlyArray<Message>>
		readonly prompt: (
			sessionId: SessionID,
			text: string,
		) => Effect.Effect<void, SessionNotFoundError | SDKImportError | NoActiveSessionError>
		readonly interrupt: (sessionId: SessionID) => Effect.Effect<void>
		readonly archive: (id: SessionID) => Effect.Effect<void>
		readonly getMostRecent: () => Effect.Effect<Session | null>
		readonly updateResumeToken: (sessionId: SessionID, token: string) => Effect.Effect<void>
		readonly updateTokenUsage: (
			sessionId: SessionID,
			input: number,
			output: number,
		) => Effect.Effect<void>
		readonly appendMessage: (
			sessionId: SessionID,
			role: "user" | "assistant" | "system",
			parts: MessagePart[],
		) => Effect.Effect<Message>
		readonly updateMessageParts: (messageId: string, parts: MessagePart[]) => Effect.Effect<void>
	}
>() {}

export const SessionServiceLive: Layer.Layer<
	SessionService,
	never,
	StorageService | EventBus | ConfigService | SDKAdapter
> = Layer.effect(
	SessionService,
	Effect.gen(function* () {
		const storage = yield* StorageService
		const bus = yield* EventBus
		const config = yield* ConfigService
		const sdk = yield* SDKAdapter

		const { db } = storage

		return {
			create: (input: CreateSessionInput) =>
				Effect.gen(function* () {
					const id = ulid() as SessionID
					const model = input.model ?? (yield* config.model())
					const title = input.title ?? "New Session"
					const timestamp = now()

					const session: Session = {
						id,
						title,
						model,
						status: "idle",
						resumeToken: null,
						tokenUsageInput: 0,
						tokenUsageOutput: 0,
						createdAt: timestamp,
						updatedAt: timestamp,
					}

					db.insert(dbSchema.sessions)
						.values({
							id: session.id,
							title: session.title,
							model: session.model,
							status: session.status,
							resumeToken: session.resumeToken,
							tokenUsageInput: session.tokenUsageInput,
							tokenUsageOutput: session.tokenUsageOutput,
							createdAt: session.createdAt,
							updatedAt: session.updatedAt,
						})
						.run()

					yield* bus.publish({
						type: "session.created",
						sessionId: id,
						timestamp,
					})

					return session
				}).pipe(Effect.withSpan("session.create")),

			get: (id: SessionID) =>
				Effect.gen(function* () {
					const rows = db.select().from(dbSchema.sessions).where(eq(dbSchema.sessions.id, id)).all()

					const row = rows[0]
					if (!row) {
						return yield* Effect.fail(new SessionNotFoundError({ id }))
					}

					return rowToSession(row)
				}),

			list: () =>
				Effect.sync(() => {
					const rows = db
						.select()
						.from(dbSchema.sessions)
						.orderBy(desc(dbSchema.sessions.updatedAt))
						.all()
					return rows.map(rowToSession)
				}),

			getMessages: (sessionId: SessionID) =>
				Effect.sync(() => {
					const rows = db
						.select()
						.from(dbSchema.messages)
						.where(eq(dbSchema.messages.sessionId, sessionId))
						.all()
					return rows.map(rowToMessage)
				}),

			prompt: (sessionId: SessionID, text: string) =>
				Effect.gen(function* () {
					yield* Effect.annotateCurrentSpan({ sessionId, textLength: text.length })

					// Persist user message before sending to SDK
					db.insert(dbSchema.messages)
						.values({
							id: ulid(),
							sessionId,
							role: "user",
							parts: [{ type: "text", content: text }] as unknown[],
							tokenUsage: null,
							createdAt: now(),
						})
						.run()

					db.update(dbSchema.sessions)
						.set({ status: "running", updatedAt: now() })
						.where(eq(dbSchema.sessions.id, sessionId))
						.run()

					yield* bus.publish({
						type: "session.updated",
						sessionId,
						timestamp: now(),
					})

					const rows = db
						.select()
						.from(dbSchema.sessions)
						.where(eq(dbSchema.sessions.id, sessionId))
						.all()
					const session = rows[0]
					if (!session) {
						return yield* Effect.fail(new SessionNotFoundError({ id: sessionId }))
					}

					const isActive = yield* sdk.isSessionActive(sessionId)
					if (!isActive) {
						const cwd = yield* config.cwd()

						yield* sdk.startSession({
							sessionId,
							cwd,
							model: session.model,
							resumeToken: session.resumeToken ?? undefined,
						})
					}

					yield* sdk.sendTurn(sessionId, [{ type: "text", text }])
				}).pipe(Effect.withSpan("session.prompt")),

			interrupt: (sessionId: SessionID) =>
				Effect.gen(function* () {
					yield* Effect.annotateCurrentSpan({ sessionId })
					yield* sdk.interruptTurn(sessionId)

					db.update(dbSchema.sessions)
						.set({ status: "idle", updatedAt: now() })
						.where(eq(dbSchema.sessions.id, sessionId))
						.run()

					yield* bus.publish({
						type: "session.updated",
						sessionId,
						timestamp: now(),
					})
				}).pipe(Effect.withSpan("session.interrupt")),

			archive: (id: SessionID) =>
				Effect.gen(function* () {
					db.update(dbSchema.sessions)
						.set({ status: "archived", updatedAt: now() })
						.where(eq(dbSchema.sessions.id, id))
						.run()

					yield* bus.publish({
						type: "session.updated",
						sessionId: id,
						timestamp: now(),
					})
				}),

			getMostRecent: () =>
				Effect.sync(() => {
					const rows = db
						.select()
						.from(dbSchema.sessions)
						.orderBy(desc(dbSchema.sessions.updatedAt), desc(dbSchema.sessions.id))
						.limit(1)
						.all()

					const row = rows[0]
					return row ? rowToSession(row) : null
				}),

			updateResumeToken: (sessionId: SessionID, token: string) =>
				Effect.sync(() => {
					db.update(dbSchema.sessions)
						.set({ resumeToken: token, updatedAt: now() })
						.where(eq(dbSchema.sessions.id, sessionId))
						.run()
				}),

			updateTokenUsage: (sessionId: SessionID, input: number, output: number) =>
				Effect.sync(() => {
					db.update(dbSchema.sessions)
						.set({
							tokenUsageInput: input,
							tokenUsageOutput: output,
							updatedAt: now(),
						})
						.where(eq(dbSchema.sessions.id, sessionId))
						.run()
				}),

			appendMessage: (
				sessionId: SessionID,
				role: "user" | "assistant" | "system",
				parts: MessagePart[],
			) =>
				Effect.sync(() => {
					const id = ulid()
					const timestamp = now()

					db.insert(dbSchema.messages)
						.values({
							id,
							sessionId,
							role,
							parts: parts as unknown[],
							tokenUsage: null,
							createdAt: timestamp,
						})
						.run()

					return {
						id: id as Message["id"],
						sessionId,
						role,
						parts,
						tokenUsage: null,
						createdAt: timestamp,
					} as Message
				}),

			updateMessageParts: (messageId: string, parts: MessagePart[]) =>
				Effect.sync(() => {
					db.update(dbSchema.messages)
						.set({ parts: parts as unknown[] })
						.where(eq(dbSchema.messages.id, messageId))
						.run()
				}),
		}
	}),
)

type SessionRow = typeof dbSchema.sessions.$inferSelect
type MessageRow = typeof dbSchema.messages.$inferSelect

function rowToSession(row: SessionRow): Session {
	return {
		id: row.id as SessionID,
		title: row.title,
		model: row.model,
		status: row.status as Session["status"],
		resumeToken: row.resumeToken,
		tokenUsageInput: row.tokenUsageInput,
		tokenUsageOutput: row.tokenUsageOutput,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

function rowToMessage(row: MessageRow): Message {
	return {
		id: row.id as Message["id"],
		sessionId: row.sessionId as SessionID,
		role: row.role as Message["role"],
		parts: (row.parts ?? []) as MessagePart[],
		tokenUsage: row.tokenUsage as Message["tokenUsage"],
		createdAt: row.createdAt,
	}
}
