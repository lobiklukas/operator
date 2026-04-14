export interface SDKSessionConfig {
	readonly sessionId: string
	readonly cwd: string
	readonly model: string
	readonly resumeToken?: string
}

export interface SDKTokenUsage {
	readonly inputTokens: number
	readonly outputTokens: number
	readonly cacheCreationInputTokens: number
	readonly cacheReadInputTokens: number
}
