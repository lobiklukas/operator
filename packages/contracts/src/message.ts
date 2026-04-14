import { Schema } from "effect"
import { SessionID } from "./session.js"

export const MessageID = Schema.String.pipe(Schema.brand("MessageID"))
export type MessageID = typeof MessageID.Type

export const MessageRole = Schema.Literal("user", "assistant", "system")
export type MessageRole = typeof MessageRole.Type

export const ToolCallStatus = Schema.Literal("pending", "running", "completed", "error")
export type ToolCallStatus = typeof ToolCallStatus.Type

export const TextPart = Schema.Struct({
	type: Schema.Literal("text"),
	content: Schema.String,
})
export type TextPart = typeof TextPart.Type

export const ReasoningPart = Schema.Struct({
	type: Schema.Literal("reasoning"),
	content: Schema.String,
})
export type ReasoningPart = typeof ReasoningPart.Type

export const ToolCallPart = Schema.Struct({
	type: Schema.Literal("tool_call"),
	id: Schema.String,
	name: Schema.String,
	params: Schema.Unknown,
	result: Schema.optional(Schema.String),
	status: ToolCallStatus,
})
export type ToolCallPart = typeof ToolCallPart.Type

export const MessagePart = Schema.Union(TextPart, ReasoningPart, ToolCallPart)
export type MessagePart = typeof MessagePart.Type

export const Message = Schema.mutable(
	Schema.Struct({
		id: MessageID,
		sessionId: SessionID,
		role: MessageRole,
		parts: Schema.mutable(Schema.Array(MessagePart)),
		tokenUsage: Schema.NullOr(
			Schema.Struct({
				input: Schema.Int,
				output: Schema.Int,
			}),
		),
		createdAt: Schema.String,
	}),
)
export type Message = typeof Message.Type
