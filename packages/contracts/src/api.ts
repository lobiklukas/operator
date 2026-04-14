import { z } from "zod"
import { Message } from "./message.js"
import { CreateSessionInput, Session } from "./session.js"

export const PromptInput = z.object({
	text: z.string().min(1),
})
export type PromptInput = z.infer<typeof PromptInput>

export const SessionWithMessages = Session.extend({
	messages: z.array(Message),
})
export type SessionWithMessages = z.infer<typeof SessionWithMessages>

export const ApiError = z.object({
	error: z.string(),
	code: z.string().optional(),
})
export type ApiError = z.infer<typeof ApiError>

export const HealthResponse = z.object({
	status: z.literal("ok"),
	version: z.string(),
})
export type HealthResponse = z.infer<typeof HealthResponse>

export { CreateSessionInput }
