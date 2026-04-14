import { type Component, For } from "solid-js"
import { useSession } from "../context/session.js"
import { MessageView } from "./message.js"

export const MessageList: Component = () => {
	const session = useSession()

	return (
		<box
			style={{
				flexDirection: "column",
				flexGrow: 1,
				overflow: "scroll",
				paddingLeft: 1,
				paddingRight: 1,
				paddingTop: 1,
			}}
		>
			<For each={session.messages}>{(msg) => <MessageView message={msg} />}</For>
			{session.error && (
				<box style={{ paddingLeft: 1 }}>
					<text fg="#FF4444">{`Error: ${session.error}`}</text>
				</box>
			)}
		</box>
	)
}
