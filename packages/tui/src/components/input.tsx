import type { Component } from "solid-js"
import { useSession } from "../context/session.js"

interface InputBoxProps {
	onSubmit: (text: string) => void
}

export const InputBox: Component<InputBoxProps> = (props) => {
	const session = useSession()

	return (
		<box
			style={{
				height: 3,
				borderStyle: "single",
				borderColor: session.isStreaming ? "#888888" : "#6CB6FF",
				paddingLeft: 1,
				paddingRight: 1,
			}}
		>
			<input
				placeholder={
					session.isStreaming ? "Streaming... (Esc to interrupt)" : "Type your message..."
				}
				onSubmit={(e: unknown) => {
					const value =
						typeof e === "string"
							? e
							: ((e as { target?: { value?: string } })?.target?.value ?? "")
					if (value.trim()) {
						props.onSubmit(value.trim())
					}
				}}
				focused={!session.isStreaming}
			/>
		</box>
	)
}
