import { z } from "zod"

export const SessionStatus = z.enum(["idle", "running", "error", "archived"])
export type SessionStatus = z.infer<typeof SessionStatus>

export const SessionID = z.string().brand("SessionID")
export type SessionID = z.infer<typeof SessionID>

export const CreateSessionInput = z.object({
	model: z.string().optional(),
	title: z.string().optional(),
})
export type CreateSessionInput = z.infer<typeof CreateSessionInput>

export const Session = z.object({
	id: SessionID,
	title: z.string(),
	model: z.string(),
	status: SessionStatus,
	resumeToken: z.string().nullable(),
	tokenUsageInput: z.number().int(),
	tokenUsageOutput: z.number().int(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
})
export type Session = z.infer<typeof Session>
