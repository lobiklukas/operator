import type { Message as MessageType } from "@operator/contracts"
import { type Component, For, Show } from "solid-js"

interface MessageProps {
	message: MessageType
}

export const MessageView: Component<MessageProps> = (props) => {
	const roleLabel = () => {
		switch (props.message.role) {
			case "user":
				return "You"
			case "assistant":
				return "Claude"
			case "system":
				return "System"
		}
	}

	const roleColor = () => {
		switch (props.message.role) {
			case "user":
				return "#6CB6FF"
			case "assistant":
				return "#A8D8A8"
			case "system":
				return "#FFD700"
		}
	}

	return (
		<box style={{ flexDirection: "column", marginBottom: 1 }}>
			<text fg={roleColor()}>{`${roleLabel()}:`}</text>
			<For each={props.message.parts}>
				{(part) => {
					switch (part.type) {
						case "text":
							return (
								<box style={{ paddingLeft: 2 }}>
									<text>{part.content}</text>
								</box>
							)
						case "reasoning":
							return (
								<box style={{ paddingLeft: 2 }}>
									<text fg="#888888">{`[thinking] ${part.content}`}</text>
								</box>
							)
						case "tool_call":
							return (
								<box
									style={{
										flexDirection: "column",
										paddingLeft: 2,
										marginTop: 0,
										marginBottom: 0,
									}}
								>
									<text fg="#FFAA00">{`⚡ ${part.name} [${part.status}]`}</text>
									<Show when={part.result}>
										<box style={{ paddingLeft: 2 }}>
											<text fg="#888888">
												{String(part.result).slice(0, 200)}
												{String(part.result).length > 200 ? "..." : ""}
											</text>
										</box>
									</Show>
								</box>
							)
						default:
							return null
					}
				}}
			</For>
		</box>
	)
}
