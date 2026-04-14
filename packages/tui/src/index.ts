#!/usr/bin/env bun
import "@opentui/solid/preload"
import { startServer } from "@operator/core"
import { Command } from "commander"
import { createClient } from "./client.js"
import { createSessionStore } from "./context/session.js"

const program = new Command()
	.name("operator")
	.description("A coding CLI tool powered by Claude Code")
	.version("0.1.0")
	.option("-r, --resume <id>", "Resume a specific session by ID")
	.option("-c, --continue", "Continue the most recent session")
	.option("-m, --model <model>", "Override the model")

program.action(async (options: { resume?: string; continue?: boolean; model?: string }) => {
	const server = await startServer({
		model: options.model,
	})

	console.log(`Operator server started at ${server.url}`)

	const client = createClient(server.url)

	let sessionId: string | undefined

	if (options.resume) {
		sessionId = options.resume
	} else if (options.continue) {
		const sessions = await client.listSessions()
		if (sessions.length > 0) {
			sessionId = sessions[0]?.id
		}
	}

	let session: Awaited<ReturnType<typeof client.createSession>> | undefined
	if (sessionId) {
		try {
			const data = await client.getSession(sessionId)
			session = data
			console.log(`Resumed session: ${session.title} (${session.id})`)
		} catch {
			console.error(`Failed to resume session ${sessionId}, creating new one`)
			session = await client.createSession({})
		}
	} else {
		session = await client.createSession({})
		console.log(`New session: ${session.id}`)
	}

	const sessionStore = createSessionStore(client)
	sessionStore.setSession(session)

	if (sessionId) {
		await sessionStore.loadSession(sessionId)
	}

	// Subscribe to events
	const unsubscribe = client.subscribeEvents(session.id, (event) => {
		sessionStore.handleEvent(event)
	})

	// Try to start the TUI renderer
	try {
		const { createCliRenderer } = await import("@opentui/core")
		const { render } = await import("@opentui/solid")
		const { App } = await import("./app.js")

		const renderer = await createCliRenderer()

		render(() => App({ client, baseUrl: server.url, sessionStore }), renderer)

		// Handle process exit
		process.on("SIGINT", async () => {
			unsubscribe()
			renderer.destroy()
			await server.stop()
			process.exit(0)
		})
	} catch (err) {
		// Fallback to simple stdin/stdout mode if OpenTUI fails
		console.error(
			"Failed to start TUI, falling back to simple mode:",
			err instanceof Error ? err.message : String(err),
		)

		const readline = await import("node:readline")
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		})

		const promptUser = () => {
			rl.question("> ", async (text) => {
				if (!text.trim()) {
					promptUser()
					return
				}
				if (text.trim() === "/quit" || text.trim() === "/exit") {
					unsubscribe()
					rl.close()
					await server.stop()
					process.exit(0)
				}
				await sessionStore.sendPrompt(text.trim())
				promptUser()
			})
		}

		promptUser()

		process.on("SIGINT", async () => {
			unsubscribe()
			rl.close()
			await server.stop()
			process.exit(0)
		})
	}
})

program.parse()
