import { HttpApiBuilder } from "@effect/platform"
import type { SessionID } from "@operator/contracts"
import { Effect } from "effect"
import { SessionService } from "../session/service.js"
import { OperatorApi } from "./api.js"

// ---------------------------------------------------------------------------
// Health group
// ---------------------------------------------------------------------------

export const HealthGroupLive = HttpApiBuilder.group(
	OperatorApi,
	"health",
	(handlers) =>
		handlers.handle("health", () =>
			Effect.succeed({ status: "ok" as const, version: "0.1.0" }).pipe(
				Effect.withSpan("http.health"),
			),
		),
)

// ---------------------------------------------------------------------------
// Sessions group
// ---------------------------------------------------------------------------

export const SessionsGroupLive = HttpApiBuilder.group(
	OperatorApi,
	"sessions",
	(handlers) =>
		handlers
			.handle("listSessions", () =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					return (yield* sessions.list()) as any
				}).pipe(Effect.withSpan("http.sessions.list")),
			)
			.handle("getSession", ({ path }) =>
				Effect.gen(function* () {
					yield* Effect.annotateCurrentSpan({ sessionId: path.id })
					const sessions = yield* SessionService
					const session = yield* sessions.get(path.id as SessionID)
					const messages = yield* sessions.getMessages(path.id as SessionID)
					return { ...session, messages } as any
				}).pipe(
					Effect.withSpan("http.sessions.get"),
					Effect.catchTag("SessionNotFoundError", (e) => Effect.fail({ error: e.message })),
				),
			)
			.handle("createSession", ({ payload }) =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					return (yield* sessions.create(payload)) as any
				}).pipe(Effect.withSpan("http.sessions.create")),
			)
			.handle("sendPrompt", ({ path, payload }) =>
				Effect.gen(function* () {
					yield* Effect.annotateCurrentSpan({ sessionId: path.id })
					const sessions = yield* SessionService
					yield* sessions.prompt(path.id as SessionID, payload.text)
					return { ok: true as const }
				}).pipe(
					Effect.withSpan("http.sessions.sendPrompt"),
					Effect.catchAll((err) => Effect.fail({ error: err.message })),
				),
			)
			.handle("interrupt", ({ path }) =>
				Effect.gen(function* () {
					yield* Effect.annotateCurrentSpan({ sessionId: path.id })
					const sessions = yield* SessionService
					yield* sessions.interrupt(path.id as SessionID)
					return { ok: true as const }
				}).pipe(Effect.withSpan("http.sessions.interrupt")),
			)
			.handle("archive", ({ path }) =>
				Effect.gen(function* () {
					yield* Effect.annotateCurrentSpan({ sessionId: path.id })
					const sessions = yield* SessionService
					yield* sessions.archive(path.id as SessionID)
					return { ok: true as const }
				}).pipe(Effect.withSpan("http.sessions.archive")),
			),
)
