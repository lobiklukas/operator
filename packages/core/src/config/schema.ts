import { z } from "zod"

export const OperatorConfig = z.object({
	model: z.string().default("claude-sonnet-4-6"),
	cwd: z.string().optional(),
	server: z
		.object({
			port: z.number().int().min(0).max(65535).default(0),
		})
		.default({}),
	database: z
		.object({
			path: z.string().optional(),
		})
		.default({}),
})

export type OperatorConfig = z.infer<typeof OperatorConfig>

export const DEFAULT_CONFIG: OperatorConfig = OperatorConfig.parse({})
