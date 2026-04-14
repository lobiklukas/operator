import { Schema } from "effect"
import { Message } from "./message.js"
import { CreateSessionInput, SessionFields } from "./session.js"

export const PromptInput = Schema.Struct({
	text: Schema.String.pipe(Schema.minLength(1)),
})
export type PromptInput = typeof PromptInput.Type

export const SessionWithMessages = Schema.mutable(
	Schema.Struct({
		...SessionFields,
		messages: Schema.mutable(Schema.Array(Message)),
	}),
)
export type SessionWithMessages = typeof SessionWithMessages.Type

export const ApiError = Schema.Struct({
	error: Schema.String,
	code: Schema.optional(Schema.String),
})
export type ApiError = typeof ApiError.Type

export const HealthResponse = Schema.Struct({
	status: Schema.Literal("ok"),
	version: Schema.String,
})
export type HealthResponse = typeof HealthResponse.Type

export { CreateSessionInput }
