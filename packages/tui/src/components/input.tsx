import type { InputRenderable } from "@opentui/core"
import type { Component } from "solid-js"
import { useSession } from "../context/session.js"

interface InputBoxProps {
	onSubmit: (text: string) => void
}

export const InputBox: Component<InputBoxProps> = (props) => {
	const session = useSession()
	let inputRef: InputRenderable | undefined

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
				ref={inputRef}
				placeholder={
					session.isStreaming ? "Streaming... (Esc to interrupt)" : "Type your message..."
				}
				// OpenTUI's InputRenderable emits the plain text string on enter,
				// but the type merges with TextareaRenderable's SubmitEvent — cast to resolve.
				onSubmit={((value: string) => {
					if (value.trim()) {
						props.onSubmit(value.trim())
						if (inputRef) {
							inputRef.value = ""
						}
					}
				}) as any}
				focused={!session.isStreaming}
			/>
		</box>
	)
}
