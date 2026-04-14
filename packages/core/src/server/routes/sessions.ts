import type { SessionID } from "@operator/contracts"
import { PromptInputSchema } from "@operator/contracts"
import type { Effect } from "effect"
import { Hono } from "hono"
import type { SessionService } from "../../session/service.js"

export function createSessionRoutes(
	sessionService: SessionService["Type"],
	runEffect: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
) {
	const app = new Hono()

	app.get("/", async (c) => {
		const sessions = await runEffect(sessionService.list())
		return c.json(sessions)
	})

	app.get("/:id", async (c) => {
		const id = c.req.param("id") as SessionID
		try {
			const session = await runEffect(sessionService.get(id))
			const messages = await runEffect(sessionService.getMessages(id))
			return c.json({ ...session, messages })
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Not found" }, 404)
		}
	})

	app.post("/", async (c) => {
		const body = await c.req.json()
		try {
			const session = await runEffect(sessionService.create(body))
			return c.json(session, 201)
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Failed to create session" }, 500)
		}
	})

	app.post("/:id/prompt", async (c) => {
		const id = c.req.param("id") as SessionID
		const body = await c.req.json()
		const parsed = PromptInputSchema.safeParse(body)
		if (!parsed.success) {
			return c.json({ error: "Invalid input: text is required" }, 400)
		}

		try {
			await runEffect(sessionService.prompt(id, parsed.data.text))
			return c.json({ ok: true })
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Failed to send prompt" }, 500)
		}
	})

	app.post("/:id/interrupt", async (c) => {
		const id = c.req.param("id") as SessionID
		try {
			await runEffect(sessionService.interrupt(id))
			return c.json({ ok: true })
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Failed to interrupt" }, 500)
		}
	})

	app.post("/:id/archive", async (c) => {
		const id = c.req.param("id") as SessionID
		try {
			await runEffect(sessionService.archive(id))
			return c.json({ ok: true })
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Failed to archive" }, 500)
		}
	})

	return app
}
