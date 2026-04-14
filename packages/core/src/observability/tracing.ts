import { NodeSdk } from "@effect/opentelemetry"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"

/**
 * OTLP tracing layer. Exports spans to the endpoint configured via
 * OTEL_EXPORTER_OTLP_ENDPOINT (defaults to http://localhost:4318).
 *
 * Spans are silently dropped when no collector is reachable — safe to include
 * unconditionally. Set OTEL_EXPORTER_OTLP_ENDPOINT to enable collection.
 *
 * Local dev: docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
 * Then open http://localhost:16686
 */
export const TracingLive = NodeSdk.layer(() => ({
	resource: { serviceName: "operator" },
	spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
}))
