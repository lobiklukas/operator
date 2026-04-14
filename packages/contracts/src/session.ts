import { Schema } from "effect"

export const SessionStatus = Schema.Literal("idle", "running", "error", "archived")
export type SessionStatus = typeof SessionStatus.Type

export const SessionID = Schema.String.pipe(Schema.brand("SessionID"))
export type SessionID = typeof SessionID.Type

export const CreateSessionInput = Schema.Struct({
	model: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
})
export type CreateSessionInput = typeof CreateSessionInput.Type

export const SessionFields = {
	id: SessionID,
	title: Schema.String,
	model: Schema.String,
	status: SessionStatus,
	resumeToken: Schema.NullOr(Schema.String),
	tokenUsageInput: Schema.Int,
	tokenUsageOutput: Schema.Int,
	createdAt: Schema.String,
	updatedAt: Schema.String,
} as const

export const Session = Schema.mutable(Schema.Struct(SessionFields))
export type Session = typeof Session.Type
