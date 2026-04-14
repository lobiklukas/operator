import { createContext, useContext } from "solid-js"
import type { OperatorClient } from "../client.js"
import { createClient } from "../client.js"

export interface ConnectionState {
	readonly client: OperatorClient
	readonly baseUrl: string
}

const ConnectionContext = createContext<ConnectionState>()

export function useConnection(): ConnectionState {
	const ctx = useContext(ConnectionContext)
	if (!ctx) throw new Error("useConnection must be used within ConnectionProvider")
	return ctx
}

export function createConnectionState(baseUrl: string): ConnectionState {
	return {
		client: createClient(baseUrl),
		baseUrl,
	}
}

export { ConnectionContext }
