import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from "@effect/platform"
import {
	ApiErrorSchema,
	CreateSessionInputSchema,
	HealthResponseSchema,
	MessageSchema,
	PromptInputSchema,
	SessionSchema,
	SessionWithMessagesSchema,
} from "@operator/contracts"
import { Schema } from "effect"

const OkResponse = Schema.Struct({
	ok: Schema.Literal(true),
})

const IdParam = HttpApiSchema.param("id", Schema.String)

// ---------------------------------------------------------------------------
// API Groups
// ---------------------------------------------------------------------------

export const HealthGroup = HttpApiGroup.make("health", { topLevel: true }).add(
	HttpApiEndpoint.get("health", "/api/health").addSuccess(HealthResponseSchema),
)

export const SessionsGroup = HttpApiGroup.make("sessions")
	.add(
		HttpApiEndpoint.get("listSessions", "/").addSuccess(
			Schema.Array(SessionSchema),
		),
	)
	.add(
		HttpApiEndpoint.get("getSession")`/${IdParam}`
			.addSuccess(SessionWithMessagesSchema)
			.addError(ApiErrorSchema, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.post("createSession", "/")
			.setPayload(CreateSessionInputSchema)
			.addSuccess(SessionSchema, { status: 201 })
			.addError(ApiErrorSchema, { status: 500 }),
	)
	.add(
		HttpApiEndpoint.post("sendPrompt")`/${IdParam}/prompt`
			.setPayload(PromptInputSchema)
			.addSuccess(OkResponse)
			.addError(ApiErrorSchema, { status: 400 })
			.addError(ApiErrorSchema, { status: 500 }),
	)
	.add(
		HttpApiEndpoint.post("interrupt")`/${IdParam}/interrupt`
			.addSuccess(OkResponse)
			.addError(ApiErrorSchema, { status: 500 }),
	)
	.add(
		HttpApiEndpoint.post("archive")`/${IdParam}/archive`
			.addSuccess(OkResponse)
			.addError(ApiErrorSchema, { status: 500 }),
	)
	.prefix("/api/sessions")

// ---------------------------------------------------------------------------
// Top-level API
// ---------------------------------------------------------------------------

export class OperatorApi extends HttpApi.make("operator")
	.add(HealthGroup)
	.add(SessionsGroup) {}
