import type { Message, MessagePart, OperatorEvent, Session } from "@operator/contracts"
import { createContext, useContext } from "solid-js"
import { createStore } from "solid-js/store"
import type { OperatorClient } from "../client.js"

export interface SessionState {
	session: Session | null
	messages: Message[]
	isStreaming: boolean
	tokenUsage: { input: number; output: number }
	error: string | null
}

export interface SessionActions {
	setSession: (session: Session) => void
	sendPrompt: (text: string) => Promise<void>
	interrupt: () => Promise<void>
	handleEvent: (event: OperatorEvent) => void
	loadSession: (id: string) => Promise<void>
}

export type SessionStore = SessionState & SessionActions

const SessionContext = createContext<SessionStore>()

export function useSession(): SessionStore {
	const ctx = useContext(SessionContext)
	if (!ctx) throw new Error("useSession must be used within SessionProvider")
	return ctx
}

export function createSessionStore(client: OperatorClient): SessionStore {
	const [state, setState] = createStore<SessionState>({
		session: null,
		messages: [],
		isStreaming: false,
		tokenUsage: { input: 0, output: 0 },
		error: null,
	})

	let currentAssistantMsgIndex = -1

	function handleEvent(event: OperatorEvent) {
		switch (event.type) {
			case "message.delta": {
				if (currentAssistantMsgIndex === -1) {
					const newMsg: Message = {
						id: event.messageId as Message["id"],
						sessionId: (state.session?.id ?? "") as Message["sessionId"],
						role: "assistant",
						parts: [{ type: "text", content: event.text }],
						tokenUsage: null,
						createdAt: event.timestamp,
					}
					setState("messages", (msgs) => [...msgs, newMsg])
					currentAssistantMsgIndex = state.messages.length - 1
				} else {
					const msg = state.messages[currentAssistantMsgIndex]
					if (msg) {
						const lastPart = msg.parts[msg.parts.length - 1]
						if (lastPart?.type === "text") {
							const updatedParts = [...msg.parts]
							updatedParts[updatedParts.length - 1] = {
								type: "text",
								content: lastPart.content + event.text,
							}
							setState("messages", currentAssistantMsgIndex, "parts", updatedParts)
						}
					}
				}
				break
			}

			case "tool.start": {
				if (currentAssistantMsgIndex >= 0) {
					const msg = state.messages[currentAssistantMsgIndex]
					if (msg) {
						const newPart: MessagePart = {
							type: "tool_call",
							id: event.toolCallId,
							name: event.name,
							params: event.params,
							status: "running",
						}
						setState("messages", currentAssistantMsgIndex, "parts", [...msg.parts, newPart])
					}
				}
				break
			}

			case "tool.complete": {
				if (currentAssistantMsgIndex >= 0) {
					const msg = state.messages[currentAssistantMsgIndex]
					if (msg) {
						const updatedParts = msg.parts.map((p) =>
							p.type === "tool_call" && p.id === event.toolCallId
								? { ...p, status: "completed" as const, result: event.result }
								: p,
						)
						setState("messages", currentAssistantMsgIndex, "parts", updatedParts)
					}
				}
				break
			}

			case "tool.error": {
				if (currentAssistantMsgIndex >= 0) {
					const msg = state.messages[currentAssistantMsgIndex]
					if (msg) {
						const updatedParts = msg.parts.map((p) =>
							p.type === "tool_call" && p.id === event.toolCallId
								? { ...p, status: "error" as const, result: event.error }
								: p,
						)
						setState("messages", currentAssistantMsgIndex, "parts", updatedParts)
					}
				}
				break
			}

			case "turn.complete": {
				setState("isStreaming", false)
				currentAssistantMsgIndex = -1
				break
			}

			case "token.usage": {
				setState("tokenUsage", { input: event.input, output: event.output })
				break
			}

			case "error": {
				setState("error", event.error)
				setState("isStreaming", false)
				break
			}
		}
	}

	async function sendPrompt(text: string) {
		if (!state.session) return

		const userMsg: Message = {
			id: `user_${Date.now()}` as Message["id"],
			sessionId: state.session.id,
			role: "user",
			parts: [{ type: "text", content: text }],
			tokenUsage: null,
			createdAt: new Date().toISOString(),
		}
		setState("messages", (msgs) => [...msgs, userMsg])
		setState("isStreaming", true)
		setState("error", null)
		currentAssistantMsgIndex = -1

		try {
			await client.sendPrompt(state.session.id, text)
		} catch (err) {
			setState("error", err instanceof Error ? err.message : String(err))
			setState("isStreaming", false)
		}
	}

	async function interrupt() {
		if (!state.session) return
		try {
			await client.interruptTurn(state.session.id)
			setState("isStreaming", false)
		} catch {
			// ignore
		}
	}

	async function loadSession(id: string) {
		try {
			const data = await client.getSession(id)
			setState("session", data)
			setState("messages", data.messages)
		} catch (err) {
			setState("error", err instanceof Error ? err.message : String(err))
		}
	}

	return {
		get session() {
			return state.session
		},
		get messages() {
			return state.messages
		},
		get isStreaming() {
			return state.isStreaming
		},
		get tokenUsage() {
			return state.tokenUsage
		},
		get error() {
			return state.error
		},
		setSession: (session) => setState("session", session),
		sendPrompt,
		interrupt,
		handleEvent,
		loadSession,
	}
}

export { SessionContext }
