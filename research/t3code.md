# t3code Research

## 1. Project Structure -- Monorepo Layout

t3code is a Turbo-managed monorepo using Bun 1.3.9 as its package manager and Node.js 24.13.1 as its runtime. The codebase is ~97.9% TypeScript.

### Top-Level Layout

```
apps/
  server/      -- Node.js WebSocket server (Effect.js runtime)
  web/         -- React/Vite frontend (Zustand state)
  desktop/     -- Electron/Tauri wrapper (src/, resources/, scripts/)
  marketing/   -- Marketing site
packages/
  contracts/   -- Shared schemas/types (Effect Schema, no runtime logic)
  client-runtime/ -- Client runtime utilities
  shared/      -- Shared utilities between server and web
scripts/       -- Build/utility scripts
```

### Key `apps/server/src/` Directories

| Directory | Purpose |
|---|---|
| `orchestration/` | Event-sourced orchestration engine (decider, projector, Layers, Services) |
| `persistence/` | SQLite-backed persistence (event store, projection repos, migrations) |
| `provider/` | Provider adapters for Claude and Codex (Layers, Services) |
| `checkpointing/` | Git-based workspace checkpoints (capture, restore, diff) |
| `git/` | Git operations (branches, worktrees, pull requests, status) |
| `terminal/` | PTY-backed terminal management |
| `workspace/` | Workspace file system operations |
| `auth/` | Authentication and pairing |
| `environment/` | Execution environment detection |

### Key `apps/web/src/` Files

| File | Purpose |
|---|---|
| `store.ts` | Main Zustand store (EnvironmentState, AppState) |
| `session-logic.ts` | Session state derivation (pending approvals, tool commands, work log) |
| `threadDerivation.ts` | WeakMap-cached thread assembly from normalized state |
| `orchestrationEventEffects.ts` | Derives side effects from orchestration event batches |
| `orchestrationRecovery.ts` | Recovery coordinator for sequence gaps and replay |
| `worktreeCleanup.ts` | Orphaned worktree detection and path formatting |
| `threadSelectionStore.ts` | Zustand store for sidebar multi-selection |
| `uiStateStore.ts` | Persisted UI state (localStorage) |
| `historyBootstrap.ts` | Context window bootstrap for resumed conversations |
| `rpc/wsTransport.ts` | WebSocket transport with reconnection |
| `rpc/wsRpcClient.ts` | Typed RPC client wrapping transport |
| `environmentApi.ts` | Creates per-environment API facades |

### `packages/contracts/src/` Files

Core schema files: `orchestration.ts` (commands, events, read models), `provider.ts` (session schemas), `providerRuntime.ts` (~50 runtime event types), `rpc.ts` (36 RPC definitions via `Rpc.make()`), `environment.ts`, `git.ts`, `terminal.ts`, `model.ts`, `settings.ts`.

---

## 2. Session Management

### Architecture

Sessions are managed at two levels:

1. **Orchestration-level sessions** -- tracked via `thread.session-set` events, persisted in the `ProjectionThreadSessions` SQLite table. The schema is:

```typescript
// packages/contracts/src/provider.ts
export const ProviderSession = Schema.Struct({
  provider: ProviderKind,           // "codex" | "claudeAgent"
  status: ProviderSessionStatus,    // "connecting" | "ready" | "running" | "error" | "closed"
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),  // opaque SDK resume token
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
```

2. **Provider-level sessions** -- managed inside each adapter (e.g., `ClaudeAdapter`). Claude sessions are tracked in a `Map<ThreadId, ClaudeSessionContext>` with fields for prompt queue, stream fiber, pending approvals, pending user inputs, in-flight tools, and token usage.

### Session Creation Flow

1. User sends first message -> `thread.turn.start` command dispatched
2. Decider emits `thread.turn-start-requested` event
3. `ProviderCommandReactor` subscribes to this event, calls `ensureSessionForThread()`
4. `ProviderService.startSession()` resolves the provider adapter via `ProviderAdapterRegistry`, calls `adapter.startSession()`
5. For Claude: initializes SDK `query()` with options, stores the `ClaudeSessionContext`
6. Session binding persisted in `ProviderSessionDirectory` (SQLite `ProviderSessionRuntime` table)
7. `thread.session-set` command dispatched back to orchestration

### Session Resumption

The `resumeCursor` field on `ProviderSession` stores opaque SDK state. For Claude, this is a UUID-based resume token (`resumeSessionId`). When a session restarts:

```typescript
// ClaudeAdapter Layer logic
function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState {
  // Extracts threadId (if not synthetic) and UUID resume token
}
```

The `ProviderCommandReactor` checks whether the existing session's runtime mode, provider, and model match the requested configuration. If compatible, it reuses the session; otherwise it restarts with the resume cursor.

### Session Persistence

The `ProviderSessionDirectory` service (backed by `ProviderSessionRuntimeRepository`) persists:
- `threadId`, `providerName`, `adapterKey`, `runtimeMode`, `status`, `resumeCursor`, `runtimePayload`, `lastSeenAt`

On merge/upsert, runtime payloads are deep-merged (not replaced), and provider changes reset the adapter key.

### Data Persisted Per Thread

Via the event-sourced orchestration model and projection tables:
- Thread shell metadata (title, model, branch, worktree path, runtime mode, interaction mode)
- All messages (user, assistant, system) up to `MAX_THREAD_MESSAGES = 2,000`
- Up to `MAX_THREAD_CHECKPOINTS = 500` checkpoint summaries
- Activities (tool calls, approval requests, etc.)
- Proposed plans
- Turn diff summaries (file changes per turn)
- Session status and active turn state

---

## 3. Compaction / Context Window Handling

### Bootstrap Input (Client-Side)

The `historyBootstrap.ts` module builds a context transcript when resuming conversations, fitting previous messages into a character budget:

```typescript
export function buildBootstrapInput(
  previousMessages: ChatMessage[],
  latestPrompt: string,
  maxChars: number,
): BootstrapInputResult {
  // Builds newest-first, fits as many messages as possible
  // Returns { text, includedCount, omittedCount, truncated }
}
```

It uses a greedy approach: iterate messages from newest to oldest, and include as many as fit within the budget. The output includes an `[N earlier message(s) omitted]` preamble when messages are dropped.

### Message Capping (Server-Side Projector)

The projector enforces hard caps on in-memory and projected state:

```typescript
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
// Proposed plans capped at 200
// Activities capped at 500
```

Messages use `.slice(-MAX_THREAD_MESSAGES)` to retain only the most recent entries.

### SDK-Level Compaction

The Claude Agent SDK itself handles compaction internally. The adapter tracks token usage:

```typescript
function normalizeClaudeTokenUsage(
  value: NonNullableUsage | undefined,
  contextWindow?: number,
): ThreadTokenUsageSnapshot | undefined {
  const inputTokens = (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;
}
```

The `providerRuntime.ts` contract defines a `thread.token-usage.updated` event that streams token counts to the UI. The SDK's `query()` function handles its own message truncation/compaction as part of the multi-turn conversation loop. t3code does not implement custom message compaction logic on top of the SDK -- it delegates this to the SDK's built-in behavior.

### Assistant Message Buffering

During runtime ingestion, assistant text deltas are buffered (max 24,000 chars) and then finalized as complete messages. This prevents unbounded memory growth from streaming tokens.

---

## 4. Threads

### Data Model

Threads are first-class entities in the orchestration system:

```typescript
// From types.ts (web)
export interface Thread {
  id: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;              // "full-access" | "auto-accept-edits" | "approval-required"
  interactionMode: ProviderInteractionMode; // "default" | "plan"
  session: ThreadSession | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  activities: OrchestrationThreadActivity[];
  branch: string | null;
  worktreePath: string | null;
  turnDiffSummaries: TurnDiffSummary[];
  latestTurn: OrchestrationLatestTurn | null;
  archivedAt: string | null;
  // ...
}
```

### Thread Lifecycle Events

The decider handles these thread commands:
- `thread.create` -> `thread.created`
- `thread.delete` -> `thread.deleted`
- `thread.archive` -> `thread.archived`
- `thread.unarchive` -> `thread.unarchived`
- `thread.meta.update` -> `thread.meta-updated`
- `thread.runtime-mode.set` -> `thread.runtime-mode-set`
- `thread.interaction-mode.set` -> `thread.interaction-mode-set`

### Multiple Threads per Project

Projects contain multiple threads, tracked via `threadIdsByProjectId` in the store. Each thread has its own provider session, messages, and worktree path.

### Thread State on the Client

The Zustand store normalizes thread data:

```typescript
interface EnvironmentState {
  threadIds: ThreadId[];
  threadIdsByProjectId: Record<ProjectId, ThreadId[]>;
  threadShellById: Record<ThreadId, ThreadShell>;       // lightweight metadata
  threadSessionById: Record<ThreadId, ThreadSession>;    // session status
  threadTurnStateById: Record<ThreadId, ThreadTurnState>; // latest turn
  messageIdsByThreadId: Record<ThreadId, MessageId[]>;    // detail stream
  messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>>;
  // ... activities, proposed plans, turn diffs similarly
}
```

The `threadDerivation.ts` module assembles full `Thread` objects from this normalized state using WeakMap caching to avoid unnecessary re-renders:

```typescript
const threadCache = new WeakMap<ThreadShell, { session, turnState, messages, ..., thread: Thread }>();

export function getThreadFromEnvironmentState(state, threadId): Thread | undefined {
  // Checks cache, rebuilds only if constituent parts changed
}
```

### Thread Multi-Selection

The `threadSelectionStore.ts` provides sidebar multi-selection with Cmd/Ctrl+Click (toggle) and Shift+Click (range select) support.

### Thread Subscriptions

The RPC client offers two subscription levels:
- `subscribeShell` -- lightweight shell updates for all threads (sidebar)
- `subscribeThread(threadId)` -- detailed messages/activities for one thread

On the server, `ws.ts` concatenates an initial snapshot with a live event stream.

---

## 5. Worktrees (Git Worktree Support)

### Thread-Level Worktree Assignment

Each thread can have an associated `worktreePath` and `branch`:

```typescript
// From decider.ts thread.create command
payload: {
  threadId: command.threadId,
  branch: command.branch,
  worktreePath: command.worktreePath,
  // ...
}
```

### Git Worktree RPC Methods

The `WsRpcClient` exposes:
- `git.createWorktree(input)` -- creates a new git worktree
- `git.removeWorktree(input)` -- removes a worktree
- `git.listBranches(input)` -- lists branches
- `git.createBranch(input)` -- creates a branch
- `git.checkout(input)` -- checks out a branch

These are backed by server-side `GitManager` and `GitCore` services.

### Worktree Cleanup

The `worktreeCleanup.ts` module detects orphaned worktrees:

```typescript
export function getOrphanedWorktreePathForThread(
  threads: readonly Thread[],
  threadId: Thread["id"],
): string | null {
  // Returns the worktree path only if no other thread shares it
}
```

### Branch/Worktree Auto-Generation

The `ProviderCommandReactor` triggers background generation of worktree branch names on the first turn of a thread. The thread meta update stores the branch and worktree path.

---

## 6. Tool Approval / Permissions

### Permission Modes

The SDK defines `PermissionMode` which t3code imports:

```typescript
import { type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
```

t3code maps its `RuntimeMode` enum to SDK permission behaviors:
- `"full-access"` -- auto-approve all tool calls
- `"auto-accept-edits"` -- auto-approve file edits, require approval for others
- `"approval-required"` -- require explicit user approval for all tool calls

### Approval Flow

1. Claude SDK emits a `request.opened` runtime event when a tool needs approval
2. `ProviderRuntimeIngestion` translates this into a `thread.activity.append` orchestration command with an `approval.requested` activity
3. UI displays the pending approval to the user
4. User clicks approve/deny -> `thread.approval.respond` command dispatched
5. Decider emits `thread.approval-response-requested` event
6. `ProviderCommandReactor` calls `provider.respondToRequest(threadId, requestId, decision)`
7. The adapter resolves the pending approval promise, unblocking the SDK

### Approval Data Structures

```typescript
// From ProviderAdapter interface
readonly respondToRequest: (
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
) => Effect.Effect<void, TError>;
```

In the Claude adapter, pending approvals are tracked per session:

```typescript
interface ClaudeSessionContext {
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  // ...
}
```

### User Input Requests

Beyond simple approve/deny, the system supports structured user input:
- `thread.user-input.respond` command with `ProviderUserInputAnswers`
- Multi-select questions defined in `providerRuntime.ts` as `UserInputQuestion`

### Stale Request Detection

The `ProviderCommandReactor` detects stale approval requests (e.g., after app restarts) and reports them rather than silently failing.

---

## 7. Message Streaming

### SDK to Server

The Claude adapter wraps the SDK's `query()` function which returns an `AsyncIterable<SDKMessage>`:

```typescript
const createQuery = options?.createQuery ??
  ((input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => query({ prompt: input.prompt, options: input.options }));
```

Messages flow through:
1. SDK emits `SDKMessage` items via async iteration
2. Adapter classifies each message (content delta, tool use, approval request, etc.)
3. Events are pushed to an unbounded Effect Queue
4. Published on `streamEvents` (a `Stream.Stream<ProviderRuntimeEvent>`)

### Server to Client

Provider runtime events flow through:
1. `ProviderRuntimeIngestion` consumes `provider.streamEvents`
2. Translates events to orchestration commands (e.g., `thread.message.assistant.delta`)
3. Orchestration engine persists events and fans them out via `streamDomainEvents`
4. `ws.ts` exposes `subscribeThread` which concatenates snapshot + live stream
5. WebSocket transport delivers events to the client

### Client Processing

The `WsTransport.subscribe()` method provides auto-reconnecting streams:

```typescript
subscribe<TValue>(
  connect: (client) => Stream.Stream<TValue, Error, never>,
  listener: (value: TValue) => void,
  options?: { retryDelay?, onResubscribe? }
): () => void {
  // Retry loop with exponential backoff on transport errors
}
```

### Assistant Message Delta Pattern

The decider handles streaming text:
- `thread.message.assistant.delta` -> emits `thread.message-sent` with `streaming: true`
- Projector appends delta text: `entry.text = entry.text + message.text`
- `thread.message.assistant.complete` -> emits `thread.message-sent` with `streaming: false`

---

## 8. State Management

### Server: Effect.js

The server uses **Effect.js** (v4.0.0-beta.45) pervasively for:
- **Dependency injection** via `Context.Service` and `Layer`
- **Error handling** with typed error channels
- **Concurrency** via fibers, semaphores, PubSub, queues
- **Streaming** via `Stream.Stream`

Every service follows the pattern:

```typescript
// Service interface
export class MyService extends Context.Service<MyService, MyServiceShape>()(
  "t3/path/MyService"
) {}

// Layer implementation
export const MyServiceLive = Layer.effect(MyService, makeMyService);
```

### Client: Zustand

The web frontend uses **Zustand** for state management:

Multiple stores:
- **Main store** (`store.ts`): `AppState` containing `EnvironmentState` per environment. Holds normalized thread shells, sessions, messages, activities, proposed plans, turn diffs.
- **UI state store** (`uiStateStore.ts`): Persisted to localStorage. Tracks expanded projects, thread visit history, project ordering.
- **Thread selection store** (`threadSelectionStore.ts`): Sidebar multi-selection state.
- **Composer draft store** (`composerDraftStore.ts`): Draft message content.
- **Command palette store** (`commandPaletteStore.ts`): Command palette state.
- **Terminal state store** (`terminalStateStore.ts`): Terminal dimensions and layout.

### Selector Memoization

Custom selectors with manual memoization avoid unnecessary re-renders:

```typescript
export function createThreadSelectorByRef(ref) {
  let previousEnvironmentState, previousThreadId, previousThread;
  return (state) => {
    // Only recompute if environment state or threadId changed
  };
}
```

---

## 9. Provider Abstraction

### Service Hierarchy

```
ProviderService (facade)
  -> ProviderAdapterRegistry (lookup by ProviderKind)
     -> ClaudeAdapter (implements ProviderAdapterShape)
     -> CodexAdapter (implements ProviderAdapterShape)
  -> ProviderSessionDirectory (persistence of thread->provider bindings)
```

### ProviderAdapterShape (The Universal Contract)

```typescript
export interface ProviderAdapterShape<TError> {
  readonly provider: ProviderKind;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly startSession: (input) => Effect.Effect<ProviderSession, TError>;
  readonly sendTurn: (input) => Effect.Effect<ProviderTurnStartResult, TError>;
  readonly interruptTurn: (threadId, turnId?) => Effect.Effect<void, TError>;
  readonly respondToRequest: (threadId, requestId, decision) => Effect.Effect<void, TError>;
  readonly respondToUserInput: (threadId, requestId, answers) => Effect.Effect<void, TError>;
  readonly stopSession: (threadId) => Effect.Effect<void, TError>;
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;
  readonly hasSession: (threadId) => Effect.Effect<boolean>;
  readonly readThread: (threadId) => Effect.Effect<ProviderThreadSnapshot, TError>;
  readonly rollbackThread: (threadId, numTurns) => Effect.Effect<ProviderThreadSnapshot, TError>;
  readonly stopAll: () => Effect.Effect<void, TError>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}
```

### Provider Capabilities

```typescript
export interface ProviderAdapterCapabilities {
  readonly sessionModelSwitch: "in-session" | "restart-session" | "unsupported";
}
```

### Provider Kind Enum

```typescript
ProviderKind = "codex" | "claudeAgent"
```

---

## 10. Error Handling and Recovery

### Orchestration Recovery Coordinator

The `orchestrationRecovery.ts` module implements a state machine for handling event stream interruptions:

```typescript
export function createOrchestrationRecoveryCoordinator() {
  let state: OrchestrationRecoveryState = {
    latestSequence: 0,
    highestObservedSequence: 0,
    bootstrapped: false,
    pendingReplay: false,
    inFlight: null,
  };
}
```

**Recovery reasons**: `"bootstrap"`, `"sequence-gap"`, `"resubscribe"`, `"replay-failed"`

**Event classification**: Each incoming event is classified as:
- `"ignore"` -- already processed (sequence <= latestSequence)
- `"defer"` -- not yet bootstrapped or recovery in flight
- `"recover"` -- sequence gap detected (not latestSequence + 1)
- `"apply"` -- normal sequential event

### WebSocket Transport Recovery

`WsTransport` handles disconnections with:
- Automatic retry loops in `subscribe()` with configurable delay (default 250ms)
- `onResubscribe` callback for client-side state refresh
- `reconnect()` method that creates a new session and cleanly closes the old one
- Transport error classification via `isTransportConnectionErrorMessage`

### Provider Error Handling

The `ProviderCommandReactor` catches failures during turn processing and appends error activities to the thread rather than crashing.

---

## 11. Claude Agent SDK Usage

### SDK Package

```typescript
import {
  query,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  ModelUsage,
  NonNullableUsage,
} from "@anthropic-ai/claude-agent-sdk";
```

### How `query()` Is Called

```typescript
const createQuery = options?.createQuery ??
  ((input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => query({ prompt: input.prompt, options: input.options }));
```

Key aspects:
- **prompt** is an `AsyncIterable<SDKUserMessage>` -- the adapter feeds user messages via a prompt queue
- **options** is `ClaudeQueryOptions` -- configuration including model, permission mode, system prompt, etc.

### Session Context

```typescript
interface ClaudeSessionContext {
  session: ProviderSession;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;           // extends AsyncIterable<SDKMessage>
  streamFiber: Fiber.Fiber<void, Error> | undefined;
  currentApiModelId: string | undefined;
  resumeSessionId: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
}
```

### Runtime Event Types

The `providerRuntime.ts` contract defines ~50 event types:
- Session: `session.started`, `session.configured`, `session.state.changed`, `session.exited`
- Thread: `thread.started`, `thread.state.changed`, `thread.metadata.updated`, `thread.token-usage.updated`
- Turn: `turn.started`, `turn.completed`, `turn.aborted`, `turn.plan.updated`
- Item: `item.started`, `item.updated`, `item.completed`
- Request: `request.opened` (approval), user input queries
- Tool: `tool.progress`, `tool.summary`
- System: authentication, rate limits, MCP operations, file persistence

---

## Summary of Key Architectural Patterns

1. **Event Sourcing**: The orchestration layer is fully event-sourced. Commands go through a `decider` (validation + event generation), events are appended to an `OrchestrationEventStore` (SQLite), and a `projector` builds read models.

2. **CQRS**: Command dispatch and read model queries are separated.

3. **Effect.js Everywhere (Server)**: Every server service uses Effect's `Context.Service` for DI, `Layer` for composition, typed error channels, `Stream` for reactive data flow, and `Scope` for resource management.

4. **Zustand (Client)**: Multiple focused stores with manual memoization. Normalized state prevents redundant re-renders.

5. **WebSocket RPC**: 36 RPC methods defined in `contracts/rpc.ts`, served via Effect's `Rpc` module.

6. **Provider Adapter Pattern**: Pluggable provider system where Claude and Codex implement the same `ProviderAdapterShape` interface.

7. **Git Checkpoint System**: Hidden git refs store workspace snapshots per turn. Checkpoint capture/restore uses isolated temporary git indexes.
