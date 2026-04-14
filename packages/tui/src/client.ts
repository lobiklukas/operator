import type {
	CreateSessionInput,
	HealthResponse,
	OperatorEvent,
	Session,
	SessionWithMessages,
} from "@operator/contracts"
import { OperatorEventSchema } from "@operator/contracts"
import { EventSource } from "eventsource"

export interface OperatorClient {
	readonly health: () => Promise<HealthResponse>
	readonly listSessions: () => Promise<Session[]>
	readonly getSession: (id: string) => Promise<SessionWithMessages>
	readonly createSession: (input: CreateSessionInput) => Promise<Session>
	readonly sendPrompt: (sessionId: string, text: string) => Promise<void>
	readonly interruptTurn: (sessionId: string) => Promise<void>
	readonly archiveSession: (sessionId: string) => Promise<void>
	readonly subscribeEvents: (
		sessionId: string,
		handler: (event: OperatorEvent) => void,
	) => () => void
}

export function createClient(baseUrl: string): OperatorClient {
	async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
		const res = await fetch(`${baseUrl}${path}`, {
			...options,
			headers: {
				"Content-Type": "application/json",
				...options?.headers,
			},
		})
		if (!res.ok) {
			const body = await res.text()
			throw new Error(`HTTP ${res.status}: ${body}`)
		}
		return res.json() as Promise<T>
	}

	return {
		health: () => fetchJSON<HealthResponse>("/api/health"),

		listSessions: () => fetchJSON<Session[]>("/api/sessions"),

		getSession: (id) => fetchJSON<SessionWithMessages>(`/api/sessions/${id}`),

		createSession: (input) =>
			fetchJSON<Session>("/api/sessions", {
				method: "POST",
				body: JSON.stringify(input),
			}),

		sendPrompt: async (sessionId, text) => {
			await fetchJSON(`/api/sessions/${sessionId}/prompt`, {
				method: "POST",
				body: JSON.stringify({ text }),
			})
		},

		interruptTurn: async (sessionId) => {
			await fetchJSON(`/api/sessions/${sessionId}/interrupt`, {
				method: "POST",
			})
		},

		archiveSession: async (sessionId) => {
			await fetchJSON(`/api/sessions/${sessionId}/archive`, {
				method: "POST",
			})
		},

		subscribeEvents: (sessionId, handler) => {
			const eventSource = new EventSource(`${baseUrl}/api/sessions/${sessionId}/events`)
			const eventTypes = [
				"session.created",
				"session.updated",
				"message.delta",
				"reasoning.delta",
				"tool.start",
				"tool.complete",
				"tool.error",
				"turn.complete",
				"token.usage",
				"error",
				"system.init",
			]

			for (const type of eventTypes) {
				eventSource.addEventListener(type, (e: MessageEvent) => {
					try {
						const data = JSON.parse(e.data)
						const parsed = OperatorEventSchema.safeParse(data)
						if (parsed.success) {
							handler(parsed.data)
						}
					} catch {
						// ignore parse errors
					}
				})
			}

			return () => {
				eventSource.close()
			}
		},
	}
}
