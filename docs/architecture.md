# Operator — Technical Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Operator Process                        │
│                                                                 │
│  ┌─────────────┐    SSE/HTTP    ┌─────────────────────────────┐ │
│  │  TUI Client │◄──────────────►│        Hono Server          │ │
│  │             │                │                             │ │
│  │  OpenTUI    │                │  ┌───────────────────────┐  │ │
│  │  SolidJS    │                │  │   Effect-TS Runtime   │  │ │
│  │  Renderer   │                │  │                       │  │ │
│  │             │                │  │  ┌─────────────────┐  │  │ │
│  │  Components:│                │  │  │ Session Service  │  │  │ │
│  │  - Header   │                │  │  │ SDK Adapter      │  │  │ │
│  │  - Messages │                │  │  │ Event Bus        │  │  │ │
│  │  - ToolView │                │  │  │ Config Service   │  │  │ │
│  │  - Input    │                │  │  └─────────────────┘  │  │ │
│  └─────────────┘                │  │                       │  │ │
│                                 │  │  ┌─────────────────┐  │  │ │
│                                 │  │  │ SQLite + Drizzle │  │  │ │
│                                 │  │  └─────────────────┘  │  │ │
│                                 │  │                       │  │ │
│                                 │  │  ┌─────────────────┐  │  │ │
│                                 │  │  │ Claude Agent SDK │  │  │ │
│                                 │  │  │   query()        │  │  │ │
│                                 │  │  └─────────────────┘  │  │ │
│                                 │  └───────────────────────┘  │ │
│                                 └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
operator/
├── package.json              # Root workspace config
├── bun.lock                  # Bun lockfile
├── turbo.json                # Turborepo pipeline config
├── tsconfig.json             # Base TypeScript config
├── .operator.json            # Example project config
│
├── packages/
│   ├── core/                 # Backend: services, server, SDK, database
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # Public API exports
│   │       ├── main.ts               # Server entry point
│   │       ├── sdk/                   # Claude Agent SDK adapter
│   │       │   ├── adapter.ts         # SDK query() wrapper
│   │       │   ├── messages.ts        # SDK message classification
│   │       │   └── types.ts           # SDK-related types
│   │       ├── session/               # Session management
│   │       │   ├── service.ts         # Session Effect service
│   │       │   ├── schema.ts          # Session Drizzle schema
│   │       │   └── types.ts           # Session types
│   │       ├── server/                # Hono HTTP/SSE server
│   │       │   ├── server.ts          # Hono app setup
│   │       │   ├── routes/            # Route handlers
│   │       │   │   ├── sessions.ts    # Session CRUD routes
│   │       │   │   └── events.ts      # SSE event stream
│   │       │   └── middleware.ts      # Hono middleware
│   │       ├── bus/                   # Event pub/sub
│   │       │   └── index.ts           # Effect PubSub bus
│   │       ├── config/                # Configuration
│   │       │   ├── service.ts         # Config Effect service
│   │       │   └── schema.ts          # Config Zod schema
│   │       ├── storage/               # Database
│   │       │   ├── database.ts        # SQLite connection + Drizzle
│   │       │   ├── migrations/        # Drizzle migrations
│   │       │   └── schema.ts          # All Drizzle table schemas
│   │       └── effect/                # Effect-TS infrastructure
│   │           ├── runtime.ts         # Effect runtime setup
│   │           └── layers.ts          # Service layer composition
│   │
│   ├── tui/                  # Frontend: terminal UI
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # TUI entry point
│   │       ├── app.tsx               # Root SolidJS component
│   │       ├── client.ts             # HTTP/SSE client for core server
│   │       ├── components/
│   │       │   ├── header.tsx         # Header bar (title, tokens, status)
│   │       │   ├── message-list.tsx   # Scrollable message display
│   │       │   ├── message.tsx        # Single message renderer
│   │       │   ├── tool-call.tsx      # Tool call display
│   │       │   └── input.tsx          # Text input box
│   │       └── context/
│   │           ├── session.tsx        # Session state context
│   │           └── connection.tsx     # Server connection context
│   │
│   └── contracts/            # Shared types and schemas
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts              # Public exports
│           ├── session.ts            # Session types & schemas
│           ├── message.ts            # Message types & part schemas
│           ├── events.ts             # Event type definitions
│           └── api.ts                # API request/response types
│
├── docs/                     # Documentation
│   ├── prd-v0.1.md
│   ├── architecture.md
│   └── roadmap.md
│
└── research/                 # Research documents
    ├── opencode.md
    ├── t3code.md
    ├── badlogic-coding-agent.md
    └── opentui.md
```

---

## Effect-TS Service Architecture

### Service Dependency Graph

```
                    ┌──────────────┐
                    │   Runtime    │  (top-level composition)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼──┐  ┌─────▼─────┐  ┌──▼────────┐
     │  Server   │  │  Session   │  │  Config    │
     │  Service  │  │  Service   │  │  Service   │
     └────────┬──┘  └─────┬─────┘  └──┬────────┘
              │           │            │
              │     ┌─────▼─────┐     │
              │     │    SDK     │     │
              │     │  Adapter   │     │
              │     └─────┬─────┘     │
              │           │            │
         ┌────▼───────────▼────────────▼──┐
         │           Event Bus            │
         └────────────┬───────────────────┘
                      │
         ┌────────────▼───────────────────┐
         │      Storage (SQLite)          │
         └────────────────────────────────┘
```

### Service Definitions

Each service follows the Effect-TS pattern used by opencode:

```typescript
// Service interface
interface SessionServiceShape {
  readonly create: (input: CreateSessionInput) => Effect.Effect<Session, SessionError>
  readonly get: (id: SessionID) => Effect.Effect<Session, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Session>>
  readonly prompt: (id: SessionID, text: string) => Effect.Effect<void, SessionError>
  readonly interrupt: (id: SessionID) => Effect.Effect<void, SessionError>
  readonly resume: (id: SessionID) => Effect.Effect<Session, SessionError>
}

// Service tag
class SessionService extends Context.Service<SessionService, SessionServiceShape>()(
  "operator/SessionService"
) {}

// Layer implementation
const SessionServiceLive = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const storage = yield* StorageService
    const bus = yield* EventBus
    const sdk = yield* SDKAdapter
    // ... implementation
    return SessionService.of({ create, get, list, prompt, interrupt, resume })
  })
)
```

### Layer Composition

```typescript
// packages/core/src/effect/layers.ts

const StorageLayer = StorageService.layer.pipe(
  Layer.provide(/* SQLite config */)
)

const EventBusLayer = EventBus.layer

const ConfigLayer = ConfigService.layer

const SDKAdapterLayer = SDKAdapter.layer.pipe(
  Layer.provide(ConfigLayer),
  Layer.provide(EventBusLayer),
)

const SessionLayer = SessionService.layer.pipe(
  Layer.provide(StorageLayer),
  Layer.provide(EventBusLayer),
  Layer.provide(SDKAdapterLayer),
)

const ServerLayer = ServerService.layer.pipe(
  Layer.provide(SessionLayer),
  Layer.provide(EventBusLayer),
  Layer.provide(ConfigLayer),
)

// Top-level runtime
export const MainLayer = Layer.mergeAll(
  ServerLayer,
  StorageLayer,
  ConfigLayer,
)
```

---

## SDK Adapter Detail

### Message Flow

```
User types prompt
       │
       ▼
  TUI sends HTTP POST /api/sessions/:id/prompt
       │
       ▼
  SessionService.prompt()
       │
       ▼
  SDKAdapter.sendTurn(sessionId, userMessage)
       │
       ├── Enqueues SDKUserMessage to prompt Queue
       │
       ▼
  SDK query() AsyncIterable yields SDKMessage items
       │
       ▼
  SDKAdapter.processStream() classifies each message:
       │
       ├── text delta      → Event.MessageDelta { sessionId, text }
       ├── tool call start → Event.ToolStart { sessionId, toolId, name, params }
       ├── tool call end   → Event.ToolComplete { sessionId, toolId, result }
       ├── reasoning       → Event.Reasoning { sessionId, text }
       ├── token usage     → Event.TokenUsage { sessionId, input, output }
       ├── turn complete   → Event.TurnComplete { sessionId }
       └── error           → Event.Error { sessionId, error }
       │
       ▼
  EventBus.publish(event)
       │
       ▼
  SSE endpoint streams to TUI client
       │
       ▼
  TUI SolidJS reactivity updates components
```

### SDK Session Lifecycle

```typescript
// packages/core/src/sdk/adapter.ts

interface SDKAdapterShape {
  // Start a new SDK session
  readonly startSession: (input: {
    sessionId: SessionID
    cwd: string
    model: string
    resumeToken?: string
  }) => Effect.Effect<void, SDKError>

  // Send a user message to the active session
  readonly sendTurn: (input: {
    sessionId: SessionID
    content: Array<{ type: "text"; text: string }>
  }) => Effect.Effect<void, SDKError>

  // Interrupt the current turn
  readonly interruptTurn: (sessionId: SessionID) => Effect.Effect<void, SDKError>

  // Stop and clean up a session
  readonly stopSession: (sessionId: SessionID) => Effect.Effect<void, SDKError>

  // Stream of all events from all sessions
  readonly events: Stream.Stream<OperatorEvent>
}
```

### SDK Options Construction

```typescript
function buildQueryOptions(input: {
  cwd: string
  model: string
  sessionId: string
  resumeToken?: string
}): ClaudeQueryOptions {
  return {
    cwd: input.cwd,
    model: input.model,
    pathToClaudeCodeExecutable: findClaudeBinary(),
    settingSources: ["user", "project", "local"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    sessionId: input.resumeToken ? undefined : input.sessionId,
    resume: input.resumeToken,
    includePartialMessages: true,
    env: process.env,
    settings: {},
  }
}
```

---

## Database Schema

### SQLite via Drizzle ORM

```typescript
// packages/core/src/storage/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),                    // ULID
  title: text("title").notNull().default("New Session"),
  model: text("model").notNull(),
  status: text("status", {
    enum: ["idle", "running", "error", "archived"]
  }).notNull().default("idle"),
  resumeToken: text("resume_token"),
  tokenUsageInput: integer("token_usage_input").notNull().default(0),
  tokenUsageOutput: integer("token_usage_output").notNull().default(0),
  createdAt: text("created_at").notNull(),        // ISO 8601
  updatedAt: text("updated_at").notNull(),        // ISO 8601
})

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),                    // ULID
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant", "system"]
  }).notNull(),
  parts: text("parts", { mode: "json" }).notNull(), // MessagePart[]
  tokenUsage: text("token_usage", { mode: "json" }), // { input, output }
  createdAt: text("created_at").notNull(),
})
```

### Database Location

```
~/.operator/
  database.sqlite          # SQLite database
  database.sqlite-wal      # WAL file (write-ahead log)
```

The directory is created on first run. Future versions may support per-project databases.

---

## Hono Server API

### Routes

```typescript
// packages/core/src/server/routes/sessions.ts
import { Hono } from "hono"

const app = new Hono()

// List all sessions
app.get("/api/sessions", async (c) => {
  const sessions = await runEffect(SessionService.list())
  return c.json(sessions)
})

// Get session with messages
app.get("/api/sessions/:id", async (c) => {
  const session = await runEffect(SessionService.get(c.req.param("id")))
  const messages = await runEffect(SessionService.getMessages(c.req.param("id")))
  return c.json({ ...session, messages })
})

// Create new session
app.post("/api/sessions", async (c) => {
  const body = await c.req.json()
  const session = await runEffect(SessionService.create(body))
  return c.json(session, 201)
})

// Send prompt
app.post("/api/sessions/:id/prompt", async (c) => {
  const { text } = await c.req.json()
  await runEffect(SessionService.prompt(c.req.param("id"), text))
  return c.json({ ok: true })
})

// Interrupt turn
app.post("/api/sessions/:id/interrupt", async (c) => {
  await runEffect(SessionService.interrupt(c.req.param("id")))
  return c.json({ ok: true })
})
```

### SSE Event Stream

```typescript
// packages/core/src/server/routes/events.ts
import { streamSSE } from "hono/streaming"

app.get("/api/sessions/:id/events", (c) => {
  return streamSSE(c, async (stream) => {
    const sessionId = c.req.param("id")
    const subscription = EventBus.subscribe(
      (event) => event.sessionId === sessionId
    )

    for await (const event of subscription) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  })
})
```

---

## TUI Architecture

### Component Tree

```
App
├── ConnectionProvider        # SSE connection to server
│   └── SessionProvider      # Active session state
│       ├── Header           # Title, token count, status indicator
│       ├── MessageList      # Scrollable message container
│       │   └── Message[]    # Individual messages
│       │       ├── TextContent
│       │       ├── ReasoningContent
│       │       └── ToolCallView
│       └── InputBox         # User text input
```

### SSE Client

```typescript
// packages/tui/src/client.ts

interface OperatorClient {
  // HTTP methods
  listSessions(): Promise<Session[]>
  getSession(id: string): Promise<SessionWithMessages>
  createSession(input: CreateSessionInput): Promise<Session>
  sendPrompt(sessionId: string, text: string): Promise<void>
  interruptTurn(sessionId: string): Promise<void>

  // SSE subscription
  subscribeEvents(sessionId: string, handler: (event: OperatorEvent) => void): () => void
}

function createClient(baseUrl: string): OperatorClient {
  // fetch + EventSource wrapper
}
```

### SolidJS State Management

```typescript
// packages/tui/src/context/session.tsx
import { createContext, createSignal, createResource } from "solid-js"

interface SessionState {
  session: Session | null
  messages: Message[]
  isStreaming: boolean
  tokenUsage: { input: number; output: number }
}

function SessionProvider(props) {
  const [state, setState] = createStore<SessionState>({
    session: null,
    messages: [],
    isStreaming: false,
    tokenUsage: { input: 0, output: 0 },
  })

  // SSE event handler updates state reactively
  const handleEvent = (event: OperatorEvent) => {
    switch (event.type) {
      case "message.delta":
        // Append text to last assistant message
        break
      case "tool.start":
        // Add tool call part to last message
        break
      case "tool.complete":
        // Update tool call status
        break
      case "turn.complete":
        setState("isStreaming", false)
        break
      case "token.usage":
        setState("tokenUsage", event.usage)
        break
    }
  }

  return <SessionContext.Provider value={state}>{props.children}</SessionContext.Provider>
}
```

---

## Configuration Loading

### Priority Order (lowest to highest)

1. Built-in defaults
2. `~/.config/operator/config.json` (global user config)
3. `.operator.json` (project config)
4. CLI flags (`--model`, etc.)
5. Environment variables (`OPERATOR_MODEL`, etc.)

### Config Schema

```typescript
// packages/core/src/config/schema.ts
import { z } from "zod"

export const OperatorConfig = z.object({
  model: z.string().default("claude-sonnet-4-6"),
  cwd: z.string().optional(),
  server: z.object({
    port: z.number().default(0),  // 0 = random available port
  }).default({}),
  database: z.object({
    path: z.string().default("~/.operator/database.sqlite"),
  }).default({}),
})

export type OperatorConfig = z.infer<typeof OperatorConfig>
```

### Config Service

```typescript
class ConfigService extends Context.Service<ConfigService>()(
  "operator/ConfigService"
) {
  readonly get: () => Effect.Effect<OperatorConfig>
  readonly cwd: () => Effect.Effect<string>
  readonly model: () => Effect.Effect<string>
}
```

---

## Error Handling

### Typed Error Hierarchy

```typescript
// packages/contracts/src/errors.ts

class OperatorError extends Schema.TaggedError<OperatorError>()(
  "OperatorError",
  { message: Schema.String }
) {}

class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  { sessionId: Schema.String }
) {}

class SDKError extends Schema.TaggedError<SDKError>()(
  "SDKError",
  { message: Schema.String, cause: Schema.Unknown }
) {}

class ConfigError extends Schema.TaggedError<ConfigError>()(
  "ConfigError",
  { message: Schema.String }
) {}
```

### Error Flow

1. SDK errors are caught in the adapter and emitted as `Event.Error`
2. Service errors propagate through Effect's typed error channel
3. Server routes catch errors and return appropriate HTTP status codes
4. TUI displays errors inline in the message stream

---

## Process Lifecycle

### Startup Sequence

```
1. CLI entry (packages/tui/src/index.ts)
   │
   ├── Parse CLI arguments (--resume, --continue, --model)
   ├── Load config (.operator.json + global + env)
   │
   ├── Boot core server (packages/core/src/main.ts)
   │   ├── Initialize Effect runtime
   │   ├── Open SQLite database
   │   ├── Run Drizzle migrations
   │   ├── Start Hono server (random port)
   │   └── Return server URL
   │
   └── Boot TUI client (packages/tui/src/app.tsx)
       ├── Create OpenTUI renderer (60fps, kitty keyboard)
       ├── Connect SSE to server
       ├── If resuming: fetch session + messages from API
       ├── Render component tree
       └── Focus input box
```

### Shutdown Sequence

```
1. User presses Ctrl+C
   │
   ├── TUI: Send interrupt if streaming
   ├── TUI: Destroy OpenTUI renderer
   ├── TUI: Close SSE connection
   │
   ├── Server: Stop all SDK sessions
   ├── Server: Close Hono server
   ├── Server: Close SQLite connection
   │
   └── Process exits cleanly
```

---

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.x | Claude Code integration |
| `effect` | ^3.x | Effect-TS core |
| `@effect/schema` | ^0.x | Schema validation |
| `hono` | ^4.x | HTTP server |
| `drizzle-orm` | ^0.x | ORM for SQLite |
| `drizzle-kit` | ^0.x | Migration tooling |
| `@opentui/core` | ^0.1.x | Terminal rendering |
| `@opentui/solid` | ^0.1.x | SolidJS reconciler |
| `solid-js` | ^1.x | Reactive UI framework |
| `zod` | ^3.x | Schema validation |
| `ulid` | ^2.x | ID generation |
| `commander` | ^12.x | CLI argument parsing |
