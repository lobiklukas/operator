import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Context, Effect, Layer } from "effect"
import {
	DEFAULT_CONFIG,
	type OperatorConfig,
	OperatorConfig as OperatorConfigSchema,
} from "./schema.js"

export class ConfigService extends Context.Tag("operator/ConfigService")<
	ConfigService,
	{
		readonly get: () => Effect.Effect<OperatorConfig>
		readonly cwd: () => Effect.Effect<string>
		readonly model: () => Effect.Effect<string>
		readonly databasePath: () => Effect.Effect<string>
	}
>() {}

function loadConfigFile(dir: string): Partial<OperatorConfig> {
	const configPath = join(dir, ".operator.json")
	if (!existsSync(configPath)) return {}
	try {
		const raw = readFileSync(configPath, "utf-8")
		return JSON.parse(raw) as Partial<OperatorConfig>
	} catch {
		return {}
	}
}

function loadGlobalConfig(): Partial<OperatorConfig> {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
	const configPath = join(home, ".config", "operator", "config.json")
	if (!existsSync(configPath)) return {}
	try {
		const raw = readFileSync(configPath, "utf-8")
		return JSON.parse(raw) as Partial<OperatorConfig>
	} catch {
		return {}
	}
}

export interface ConfigOptions {
	readonly cwd?: string
	readonly model?: string
}

export const ConfigServiceLive = (options: ConfigOptions = {}) =>
	Layer.succeed(
		ConfigService,
		(() => {
			const workingDir = resolve(options.cwd ?? process.cwd())
			const globalConfig = loadGlobalConfig()
			const projectConfig = loadConfigFile(workingDir)

			const merged = OperatorConfigSchema.parse({
				...DEFAULT_CONFIG,
				...globalConfig,
				...projectConfig,
				...(options.model ? { model: options.model } : {}),
				...(options.cwd ? { cwd: options.cwd } : {}),
			})

			const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
			const defaultDbPath = join(home, ".operator", "database.sqlite")

			return {
				get: () => Effect.succeed(merged),
				cwd: () => Effect.succeed(merged.cwd ?? workingDir),
				model: () => Effect.succeed(merged.model),
				databasePath: () => Effect.succeed(merged.database.path ?? defaultDbPath),
			}
		})(),
	)
