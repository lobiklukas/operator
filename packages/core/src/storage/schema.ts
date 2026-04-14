import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
	id: text("id").primaryKey(),
	title: text("title").notNull().default("New Session"),
	model: text("model").notNull(),
	status: text("status", {
		enum: ["idle", "running", "error", "archived"],
	})
		.notNull()
		.default("idle"),
	resumeToken: text("resume_token"),
	tokenUsageInput: integer("token_usage_input").notNull().default(0),
	tokenUsageOutput: integer("token_usage_output").notNull().default(0),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
})

export const messages = sqliteTable("messages", {
	id: text("id").primaryKey(),
	sessionId: text("session_id")
		.notNull()
		.references(() => sessions.id, { onDelete: "cascade" }),
	role: text("role", {
		enum: ["user", "assistant", "system"],
	}).notNull(),
	parts: text("parts", { mode: "json" }).notNull().$type<unknown[]>(),
	tokenUsage: text("token_usage", { mode: "json" }).$type<{
		input: number
		output: number
	} | null>(),
	createdAt: text("created_at").notNull(),
})
