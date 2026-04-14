import { useKeyboard, useRenderer } from "@opentui/solid"
import type { Component } from "solid-js"
import type { OperatorClient } from "./client.js"
import { Header } from "./components/header.js"
import { InputBox } from "./components/input.js"
import { MessageList } from "./components/message-list.js"
import { ConnectionContext, createConnectionState } from "./context/connection.js"
import { SessionContext, type SessionStore } from "./context/session.js"

interface AppProps {
	client: OperatorClient
	baseUrl: string
	sessionStore: SessionStore
}

export const App: Component<AppProps> = (props) => {
	const connectionState = createConnectionState(props.baseUrl)
	const renderer = useRenderer()

	useKeyboard((key) => {
		if (key.ctrl && key.name === "c") {
			if (props.sessionStore.isStreaming) {
				props.sessionStore.interrupt()
			} else {
				renderer.destroy()
				process.exit(0)
			}
		}
		if (key.name === "escape" && props.sessionStore.isStreaming) {
			props.sessionStore.interrupt()
		}
	})

	const handleSubmit = async (text: string) => {
		await props.sessionStore.sendPrompt(text)
	}

	return (
		<ConnectionContext.Provider value={connectionState}>
			<SessionContext.Provider value={props.sessionStore}>
				<box style={{ flexDirection: "column", height: "100%", width: "100%" }}>
					<Header />
					<box
						style={{
							height: 1,
							borderStyle: "single",
						}}
					/>
					<MessageList />
					<InputBox onSubmit={handleSubmit} />
				</box>
			</SessionContext.Provider>
		</ConnectionContext.Provider>
	)
}
