import { z } from "zod"
import type { SessionID } from "./session.js"

export const MessageID = z.string().brand("MessageID")
export type MessageID = z.infer<typeof MessageID>

export const MessageRole = z.enum(["user", "assistant", "system"])
export type MessageRole = z.infer<typeof MessageRole>

export const ToolCallStatus = z.enum(["pending", "running", "completed", "error"])
export type ToolCallStatus = z.infer<typeof ToolCallStatus>

export const TextPart = z.object({
	type: z.literal("text"),
	content: z.string(),
})
export type TextPart = z.infer<typeof TextPart>

export const ReasoningPart = z.object({
	type: z.literal("reasoning"),
	content: z.string(),
})
export type ReasoningPart = z.infer<typeof ReasoningPart>

export const ToolCallPart = z.object({
	type: z.literal("tool_call"),
	id: z.string(),
	name: z.string(),
	params: z.unknown(),
	result: z.string().optional(),
	status: ToolCallStatus,
})
export type ToolCallPart = z.infer<typeof ToolCallPart>

export const MessagePart = z.discriminatedUnion("type", [TextPart, ReasoningPart, ToolCallPart])
export type MessagePart = z.infer<typeof MessagePart>

export const Message = z.object({
	id: MessageID,
	sessionId: z.string() as unknown as z.ZodType<SessionID>,
	role: MessageRole,
	parts: z.array(MessagePart),
	tokenUsage: z
		.object({
			input: z.number().int(),
			output: z.number().int(),
		})
		.nullable(),
	createdAt: z.string().datetime(),
})
export type Message = z.infer<typeof Message>
