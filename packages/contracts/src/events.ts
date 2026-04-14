import { Schema } from "effect"

const BaseEvent = Schema.Struct({
	sessionId: Schema.String,
	timestamp: Schema.String,
})

export const SessionCreatedEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("session.created"),
})
export type SessionCreatedEvent = typeof SessionCreatedEvent.Type

export const SessionUpdatedEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("session.updated"),
})
export type SessionUpdatedEvent = typeof SessionUpdatedEvent.Type

export const MessageDeltaEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("message.delta"),
	text: Schema.String,
	messageId: Schema.String,
})
export type MessageDeltaEvent = typeof MessageDeltaEvent.Type

export const ReasoningDeltaEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("reasoning.delta"),
	text: Schema.String,
	messageId: Schema.String,
})
export type ReasoningDeltaEvent = typeof ReasoningDeltaEvent.Type

export const ToolStartEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("tool.start"),
	toolCallId: Schema.String,
	name: Schema.String,
	params: Schema.Unknown,
	messageId: Schema.String,
})
export type ToolStartEvent = typeof ToolStartEvent.Type

export const ToolCompleteEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("tool.complete"),
	toolCallId: Schema.String,
	result: Schema.String,
	messageId: Schema.String,
})
export type ToolCompleteEvent = typeof ToolCompleteEvent.Type

export const ToolErrorEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("tool.error"),
	toolCallId: Schema.String,
	error: Schema.String,
	messageId: Schema.String,
})
export type ToolErrorEvent = typeof ToolErrorEvent.Type

export const TurnCompleteEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("turn.complete"),
	messageId: Schema.String,
})
export type TurnCompleteEvent = typeof TurnCompleteEvent.Type

export const TokenUsageEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("token.usage"),
	input: Schema.Int,
	output: Schema.Int,
})
export type TokenUsageEvent = typeof TokenUsageEvent.Type

export const ErrorEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("error"),
	error: Schema.String,
})
export type ErrorEvent = typeof ErrorEvent.Type

export const SystemInitEvent = Schema.Struct({
	...BaseEvent.fields,
	type: Schema.Literal("system.init"),
	model: Schema.String,
	tools: Schema.Array(Schema.String),
	cwd: Schema.String,
})
export type SystemInitEvent = typeof SystemInitEvent.Type

export const OperatorEvent = Schema.Union(
	SessionCreatedEvent,
	SessionUpdatedEvent,
	MessageDeltaEvent,
	ReasoningDeltaEvent,
	ToolStartEvent,
	ToolCompleteEvent,
	ToolErrorEvent,
	TurnCompleteEvent,
	TokenUsageEvent,
	ErrorEvent,
	SystemInitEvent,
)
export type OperatorEvent = typeof OperatorEvent.Type
