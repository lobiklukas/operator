import type { Component } from "solid-js"
import { useSession } from "../context/session.js"

export const Header: Component = () => {
	const session = useSession()

	return (
		<box
			style={{
				height: 1,
				flexDirection: "row",
				justifyContent: "space-between",
				paddingLeft: 1,
				paddingRight: 1,
			}}
		>
			<text>{`Operator v0.1${session.session ? ` — ${session.session.title}` : ""}`}</text>
			<text>
				{session.isStreaming
					? "streaming..."
					: `tokens: ${session.tokenUsage.input + session.tokenUsage.output}`}
			</text>
		</box>
	)
}
