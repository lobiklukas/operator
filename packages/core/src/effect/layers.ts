import { Layer } from "effect"
import { EventBusLive } from "../bus/index.js"
import { type ConfigOptions, ConfigServiceLive } from "../config/service.js"
import { SDKAdapterLive } from "../sdk/adapter.js"
import { ServerServiceLive } from "../server/server.js"
import { SessionServiceLive } from "../session/service.js"
import { StorageServiceLive } from "../storage/database.js"

export function createMainLayer(options: {
	config?: ConfigOptions
	dbPath: string
}) {
	const ConfigLayer = ConfigServiceLive(options.config)
	const StorageLayer = StorageServiceLive(options.dbPath)
	const BusLayer = EventBusLive

	const SDKLayer = SDKAdapterLive.pipe(Layer.provide(BusLayer), Layer.provide(ConfigLayer))

	const SessionLayer = SessionServiceLive.pipe(
		Layer.provide(StorageLayer),
		Layer.provide(BusLayer),
		Layer.provide(ConfigLayer),
		Layer.provide(SDKLayer),
	)

	const ServerLayer = ServerServiceLive.pipe(
		Layer.provide(SessionLayer),
		Layer.provide(BusLayer),
		Layer.provide(ConfigLayer),
	)

	return Layer.mergeAll(ServerLayer, SessionLayer, BusLayer, ConfigLayer, StorageLayer, SDKLayer)
}
