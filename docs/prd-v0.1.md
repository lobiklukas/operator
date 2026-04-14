# Operator v0.1 — Product Requirements Document

## Overview

Operator is a terminal-based coding CLI tool that spawns Claude Code sessions via the `@anthropic-ai/claude-agent-sdk`. It provides a rich TUI interface built with OpenTUI + SolidJS, backed by a local Hono HTTP/WebSocket server with SQLite persistence.

v0.1 is the **minimum viable product**: launch Operator in a terminal, type a prompt, it spawns a Claude Code session via the SDK, and streams the response in a TUI.

## Goals

1. Spawn and manage Claude Code sessions through the official Agent SDK
2. Provide a responsive terminal UI for real-time streaming of Claude Code output
3. Persist sessions to SQLite so users can resume previous threads
4. Establish a client-server architecture that supports a future web UI
5. Use Effect-TS throughout for type-safe dependency injection, concurrency, and error handling

## Non-Goals (v0.1)

- Multiple AI providers (Claude Code only)
- Custom system prompts or agent definitions
- Git worktree support
- Filesystem snapshots / undo-redo
- Web UI (architecture prepared, not implemented)
- Session list / sidebar in TUI
- Permission approval dialogs (auto-approve all)
- Plugin system
- MCP server management
- Multi-project support

---

## User Stories

### US-1: Start a new session
**As a** developer,
**I want to** run `operator` in my project directory and type a prompt,
**So that** Claude Code starts working on my request and I see the output in real-time.

**Acceptance criteria:**
- Running `operator` opens a TUI with an input box
- Typing a prompt and pressing Enter starts a Claude Code session via the SDK
- Assistant response streams in real-time (text deltas appear as they arrive)
- Tool calls (file reads, edits, bash commands) are displayed as they execute
- The session is persisted to SQLite automatically

### US-2: Resume a previous session
**As a** developer,
**I want to** continue a previous conversation with Claude Code,
**So that** I can pick up where I left off without losing context.

**Acceptance criteria:**
- Operator persists sessions with messages to SQLite
- Running `operator --resume <session-id>` loads the previous session
- Running `operator --continue` resumes the most recent session
- Previous messages are displayed in the TUI
- New prompts continue the existing Claude Code session (using SDK resume)

### US-3: Send follow-up messages
**As a** developer,
**I want to** send additional prompts in the same session,
**So that** Claude Code maintains context across my requests.

**Acceptance criteria:**
- After a response completes, the input box becomes active again
- Typing a new prompt sends it to the same session
- Claude Code maintains full conversation context

### US-4: Interrupt a running response
**As a** developer,
**I want to** cancel a running Claude Code response,
**So that** I can redirect the agent or stop unwanted work.

**Acceptance criteria:**
- Pressing `Ctrl+C` (or `Escape`) interrupts the current turn
- The SDK turn is aborted cleanly
- The input box becomes active for a new prompt
- Previous messages in the session are preserved

### US-5: View tool activity
**As a** developer,
**I want to** see what tools Claude Code is using (file reads, edits, bash commands),
**So that** I understand what changes are being made to my codebase.

**Acceptance criteria:**
- Tool calls are rendered inline in the message stream
- Each tool shows: tool name, parameters (file paths, commands), and result summary
- Tool output is collapsible or truncated for readability

---

## Architecture

### Client-Server Split

```
┌──────────────────────┐         ┌──────────────────────┐
│    packages/tui      │  SSE/WS │    packages/core     │
│                      │◄───────►│                      │
│  OpenTUI + SolidJS   │  HTTP   │  Hono Server         │
│  Terminal renderer   │         │  Effect-TS Services   │
│  Keyboard input      │         │  Claude Agent SDK     │
│  Message display     │         │  SQLite + Drizzle     │
└──────────────────────┘         └──────────────────────┘
```

**Why client-server?** Enables adding a web UI later without refactoring the core. The TUI is just one client connecting to the same Hono server.

### Monorepo Structure

```
packages/
  core/           — Effect-TS services, Hono server, SDK integration, SQLite
  tui/            — OpenTUI + SolidJS terminal application
  contracts/      — Shared TypeScript types, schemas, API contracts
```

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Bun | Fast startup, native TS, SQLite driver |
| Type system | TypeScript | Type safety throughout |
| Effect system | Effect-TS | DI, concurrency, error handling, streaming |
| AI SDK | @anthropic-ai/claude-agent-sdk | Official Claude Code integration |
| HTTP server | Hono | Lightweight, OpenAPI support |
| Database | SQLite + Drizzle ORM | Embedded, zero-config persistence |
| TUI framework | OpenTUI (@opentui/core, @opentui/solid) | Native Zig core, SolidJS reconciler |
| UI framework | SolidJS | Fine-grained reactivity, shared with future web UI |
| Schema | Zod | Runtime validation, AI SDK compatibility |

---

## Core Components

### 1. Claude Agent SDK Integration

The SDK adapter wraps `query()` from `@anthropic-ai/claude-agent-sdk`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

// Options passed to query()
{
  prompt: AsyncIterable<SDKUserMessage>,  // fed via Effect Queue
  options: {
    cwd: string,                          // project directory
    model: string,                        // e.g. "claude-sonnet-4-6"
    settingSources: ["user", "project", "local"],  // read CC settings
    permissionMode: "bypassPermissions",  // auto-approve for v0.1
    allowDangerouslySkipPermissions: true,
    sessionId: string,                    // new session UUID
    resume: string,                       // resume token (for resume)
    includePartialMessages: true,         // streaming deltas
    env: process.env,
  }
}
```

The adapter:
- Manages a prompt queue (Effect Queue) to feed user messages
- Iterates the `AsyncIterable<SDKMessage>` stream from the SDK
- Classifies each message (text delta, tool use, approval, completion)
- Emits typed events on an Effect PubSub bus
- Tracks token usage
- Handles session lifecycle (start, interrupt, stop)

### 2. Session Service

An Effect service managing session CRUD and lifecycle:

```typescript
class SessionService extends Context.Service<SessionService>()("operator/SessionService") {
  // CRUD
  create(input: CreateSessionInput): Effect<Session>
  get(id: SessionID): Effect<Session>
  list(): Effect<Session[]>
  archive(id: SessionID): Effect<void>

  // Messages
  getMessages(sessionId: SessionID): Effect<Message[]>
  appendMessage(sessionId: SessionID, message: Message): Effect<void>

  // Lifecycle
  resume(id: SessionID): Effect<Session>
}
```

Backed by SQLite tables:
- `sessions` — id, title, model, status, created_at, updated_at
- `messages` — id, session_id, role, content (JSON parts), created_at

### 3. Hono HTTP/WS Server

Exposes the core services to clients:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/sessions` | HTTP | List sessions |
| `GET /api/sessions/:id` | HTTP | Get session with messages |
| `POST /api/sessions` | HTTP | Create new session |
| `POST /api/sessions/:id/prompt` | HTTP | Send prompt to session |
| `POST /api/sessions/:id/interrupt` | HTTP | Interrupt current turn |
| `GET /api/sessions/:id/events` | SSE | Stream real-time events |
| `GET /api/health` | HTTP | Server health check |

### 4. Event System

A typed pub/sub bus built on Effect PubSub:

```typescript
// Event types
Session.Event.Created
Session.Event.Updated
Session.Event.MessageDelta    // streaming text
Session.Event.ToolStart       // tool call started
Session.Event.ToolComplete    // tool call finished
Session.Event.TurnComplete    // assistant turn done
Session.Event.Error
Session.Event.TokenUsage      // token count update
```

Events flow: SDK stream -> adapter -> PubSub -> SSE endpoint -> TUI client

### 5. TUI Application

OpenTUI + SolidJS terminal app connecting to the local Hono server:

**Layout (v0.1):**
```
┌─────────────────────────────────────┐
│  Operator v0.1          tokens: 1.2k│  <- header bar
├─────────────────────────────────────┤
│                                     │
│  User: Fix the login bug in auth.ts │  <- message list
│                                     │  <- (scrollable)
│  Assistant: I'll fix the login...   │
│  ┌─ Read auth.ts ─────────────┐    │  <- tool call
│  │ (file contents)             │    │
│  └─────────────────────────────┘    │
│  The issue is on line 42...         │
│                                     │
├─────────────────────────────────────┤
│  > Type your message...        Enter│  <- input box
└─────────────────────────────────────┘
```

**Components:**
- `Header` — app name, token usage, session status
- `MessageList` — scrollable list of messages (user + assistant)
- `ToolCallView` — inline tool call display (name, params, output)
- `InputBox` — text input with Enter to send, Escape to interrupt

**Keyboard shortcuts:**
- `Enter` — send message
- `Escape` — interrupt current turn
- `Ctrl+C` — quit Operator
- `Up/Down` or scroll — navigate message history

---

## Configuration

### `.operator.json` (project root)

```json
{
  "$schema": "https://operator.dev/config.json",
  "model": "claude-sonnet-4-6",
  "cwd": "."
}
```

v0.1 config is minimal. Future versions will add:
- Custom agents
- Permission overrides
- MCP server configuration
- Plugin configuration
- Keybindings

### Claude Code Settings

Operator reads Claude Code's native settings via `settingSources: ["user", "project", "local"]`:
- `~/.claude/settings.json` (user)
- `.claude/settings.json` (project)
- `.claude/settings.local.json` (local)

This means existing Claude Code configurations (allowed tools, MCP servers, hooks) are respected automatically.

---

## Data Model

### Session

| Field | Type | Description |
|-------|------|-------------|
| id | ULID | Primary key |
| title | string | Auto-generated from first message |
| model | string | Model used (e.g. "claude-sonnet-4-6") |
| status | enum | "idle" / "running" / "error" / "archived" |
| resume_token | string? | SDK resume token for session continuity |
| token_usage_input | integer | Total input tokens |
| token_usage_output | integer | Total output tokens |
| created_at | datetime | Creation timestamp |
| updated_at | datetime | Last activity timestamp |

### Message

| Field | Type | Description |
|-------|------|-------------|
| id | ULID | Primary key |
| session_id | ULID | Foreign key to sessions |
| role | enum | "user" / "assistant" / "system" |
| parts | JSON | Array of typed parts (text, tool, reasoning) |
| token_usage | JSON? | Token counts for this message |
| created_at | datetime | Creation timestamp |

### Message Parts (JSON)

```typescript
type MessagePart =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_call"; id: string; name: string; params: unknown; result?: string; status: "pending" | "running" | "completed" | "error" }
```

---

## Startup Flow

1. `operator` CLI entry point parses args (--resume, --continue, --model)
2. Core server boots:
   a. Effect runtime initializes
   b. SQLite database opens (creates tables if needed via Drizzle migrations)
   c. Hono server starts on a random available port
3. TUI client launches:
   a. OpenTUI renderer initializes
   b. Connects to local Hono server via SSE
   c. If resuming: loads previous messages from API, displays them
   d. Renders input box, waits for user prompt
4. User types prompt, presses Enter:
   a. TUI sends POST to `/api/sessions/:id/prompt`
   b. Server creates/resumes Claude Code session via SDK
   c. SDK stream events flow through PubSub -> SSE -> TUI
   d. TUI renders streaming text and tool calls in real-time
5. Turn completes:
   a. Messages persisted to SQLite
   b. Input box becomes active again

## Exit Flow

1. User presses `Ctrl+C`
2. TUI sends interrupt if a turn is running
3. TUI renderer destroys cleanly
4. Server shuts down (SDK sessions closed, SQLite connection closed)
5. Process exits

---

## CLI Interface

```
operator [options]

Options:
  --resume, -r <id>     Resume a specific session by ID
  --continue, -c        Continue the most recent session
  --model, -m <model>   Override the model (default: from config or claude-sonnet-4-6)
  --version, -v         Show version
  --help, -h            Show help

Examples:
  operator                        # Start new session
  operator -c                     # Continue last session
  operator -r 01JFG...            # Resume specific session
  operator -m claude-opus-4-6     # Use a specific model
```

---

## Success Metrics

- User can start Operator, type a prompt, and see Claude Code's streaming response in < 3 seconds
- Sessions persist across restarts (resume works)
- TUI renders at 60fps without jank during streaming
- Clean shutdown with no orphaned processes

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| claude-agent-sdk API changes | Breaks SDK integration | Pin SDK version, wrap in adapter layer |
| OpenTUI pre-1.0 instability | TUI rendering bugs | Isolate TUI in separate package, can swap later |
| Effect-TS learning curve | Slower development | Follow opencode patterns as reference |
| Bun SQLite compatibility | Data corruption | Use Drizzle ORM abstraction, test with both Bun and Node |

---

## Future Versions (out of scope for v0.1)

See [roadmap.md](./roadmap.md) for the full feature roadmap.

- **v0.2**: Session list sidebar, session management (rename, archive, delete)
- **v0.3**: Filesystem snapshots, undo/redo per turn
- **v0.4**: Git worktree support (isolated branches per session)
- **v0.5**: Permission approval UI (interactive tool approval in TUI)
- **v0.6**: Web UI client (SolidJS, connects to same Hono server)
- **v0.7**: Plugin system, custom agents, MCP server management
