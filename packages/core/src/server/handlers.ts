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
			Effect.succeed({ status: "ok" as const, version: "0.1.0" }),
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
				}),
			)
			.handle("getSession", ({ path }) =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					const session = yield* sessions.get(path.id as SessionID)
					const messages = yield* sessions.getMessages(path.id as SessionID)
					return { ...session, messages } as any
				}).pipe(
					Effect.mapError(() => ({ error: "Not found" })),
				),
			)
			.handle("createSession", ({ payload }) =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					return (yield* sessions.create(payload)) as any
				}).pipe(
					Effect.mapError((err) => ({
						error: err instanceof Error ? err.message : "Failed to create session",
					})),
				),
			)
			.handle("sendPrompt", ({ path, payload }) =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					yield* sessions.prompt(path.id as SessionID, payload.text)
					return { ok: true as const }
				}).pipe(
					Effect.mapError((err) => ({
						error: err instanceof Error ? err.message : "Failed to send prompt",
					})),
				),
			)
			.handle("interrupt", ({ path }) =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					yield* sessions.interrupt(path.id as SessionID)
					return { ok: true as const }
				}).pipe(
					Effect.mapError((err) => ({
						error: err instanceof Error ? err.message : "Failed to interrupt",
					})),
				),
			)
			.handle("archive", ({ path }) =>
				Effect.gen(function* () {
					const sessions = yield* SessionService
					yield* sessions.archive(path.id as SessionID)
					return { ok: true as const }
				}).pipe(
					Effect.mapError((err) => ({
						error: err instanceof Error ? err.message : "Failed to archive",
					})),
				),
			),
)
