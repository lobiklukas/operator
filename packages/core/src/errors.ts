import { Data } from "effect"

export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
	readonly id: string
}> {
	override get message() {
		return `Session not found: ${this.id}`
	}
}

export class SessionPromptError extends Data.TaggedError("SessionPromptError")<{
	readonly sessionId: string
	readonly cause: string
}> {
	override get message() {
		return `Prompt failed for session ${this.sessionId}: ${this.cause}`
	}
}

export class SDKImportError extends Data.TaggedError("SDKImportError")<{
	readonly cause: string
}> {
	override get message() {
		return `Failed to import SDK: ${this.cause}`
	}
}

export class SDKStreamError extends Data.TaggedError("SDKStreamError")<{
	readonly sessionId: string
	readonly cause: string
}> {
	override get message() {
		return `SDK stream error for session ${this.sessionId}: ${this.cause}`
	}
}

export class NoActiveSessionError extends Data.TaggedError("NoActiveSessionError")<{
	readonly sessionId: string
}> {
	override get message() {
		return `No active session: ${this.sessionId}`
	}
}
