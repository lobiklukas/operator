import { z } from "zod"

const BaseEvent = z.object({
	sessionId: z.string(),
	timestamp: z.string().datetime(),
})

export const SessionCreatedEvent = BaseEvent.extend({
	type: z.literal("session.created"),
})
export type SessionCreatedEvent = z.infer<typeof SessionCreatedEvent>

export const SessionUpdatedEvent = BaseEvent.extend({
	type: z.literal("session.updated"),
})
export type SessionUpdatedEvent = z.infer<typeof SessionUpdatedEvent>

export const MessageDeltaEvent = BaseEvent.extend({
	type: z.literal("message.delta"),
	text: z.string(),
	messageId: z.string(),
})
export type MessageDeltaEvent = z.infer<typeof MessageDeltaEvent>

export const ReasoningDeltaEvent = BaseEvent.extend({
	type: z.literal("reasoning.delta"),
	text: z.string(),
	messageId: z.string(),
})
export type ReasoningDeltaEvent = z.infer<typeof ReasoningDeltaEvent>

export const ToolStartEvent = BaseEvent.extend({
	type: z.literal("tool.start"),
	toolCallId: z.string(),
	name: z.string(),
	params: z.unknown(),
	messageId: z.string(),
})
export type ToolStartEvent = z.infer<typeof ToolStartEvent>

export const ToolCompleteEvent = BaseEvent.extend({
	type: z.literal("tool.complete"),
	toolCallId: z.string(),
	result: z.string(),
	messageId: z.string(),
})
export type ToolCompleteEvent = z.infer<typeof ToolCompleteEvent>

export const ToolErrorEvent = BaseEvent.extend({
	type: z.literal("tool.error"),
	toolCallId: z.string(),
	error: z.string(),
	messageId: z.string(),
})
export type ToolErrorEvent = z.infer<typeof ToolErrorEvent>

export const TurnCompleteEvent = BaseEvent.extend({
	type: z.literal("turn.complete"),
	messageId: z.string(),
})
export type TurnCompleteEvent = z.infer<typeof TurnCompleteEvent>

export const TokenUsageEvent = BaseEvent.extend({
	type: z.literal("token.usage"),
	input: z.number().int(),
	output: z.number().int(),
})
export type TokenUsageEvent = z.infer<typeof TokenUsageEvent>

export const ErrorEvent = BaseEvent.extend({
	type: z.literal("error"),
	error: z.string(),
})
export type ErrorEvent = z.infer<typeof ErrorEvent>

export const SystemInitEvent = BaseEvent.extend({
	type: z.literal("system.init"),
	model: z.string(),
	tools: z.array(z.string()),
	cwd: z.string(),
})
export type SystemInitEvent = z.infer<typeof SystemInitEvent>

export const OperatorEvent = z.discriminatedUnion("type", [
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
])
export type OperatorEvent = z.infer<typeof OperatorEvent>
