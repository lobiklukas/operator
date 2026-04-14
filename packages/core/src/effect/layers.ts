import { Layer } from "effect"
import { EventBusLive } from "../bus/index.js"
import { type ConfigOptions, ConfigServiceLive } from "../config/service.js"
import { TracingLive } from "../observability/tracing.js"
import { SDKAdapterLive } from "../sdk/adapter.js"
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

	return Layer.mergeAll(SessionLayer, BusLayer, ConfigLayer, StorageLayer, SDKLayer, TracingLive)
}
