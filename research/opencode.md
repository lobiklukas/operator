# opencode Research

**Repository:** [anomalyco/opencode](https://github.com/anomalyco/opencode) (previously sst/opencode)
**Stars:** ~143K | **Language:** TypeScript | **License:** MIT | **Default Branch:** `dev`
**Runtime:** Bun (primary), Node.js (secondary support)
**Version:** 1.4.3 (as of research date)

---

## 1. Overall Architecture

opencode is a monorepo managed with Turbo, structured under `packages/`:

| Package | Purpose |
|---------|---------|
| `opencode` | Core backend -- agents, sessions, tools, providers, server |
| `app` | Web/desktop frontend (SolidJS + Vite) |
| `sdk` | Generated TypeScript client SDK (JS + Python) |
| `ui` | Shared UI components |
| `plugin` | Plugin type definitions and interfaces |
| `desktop` / `desktop-electron` | Desktop app shells |
| `console` | Cloud console |
| `enterprise` | Enterprise features |
| `containers` | Container/sandbox support |
| `extensions` | IDE extensions (VS Code, Zed) |
| `docs` | Documentation site |
| `util` | Shared utilities |

### Core Technology Stack

- **Language:** TypeScript throughout
- **Runtime:** Bun (primary), with Node.js adapters via conditional imports (`#db`, `#pty`, `#hono`)
- **Effect System:** [Effect-TS](https://effect.website/) heavily used for dependency injection, service layering, and structured concurrency
- **AI SDK:** Vercel AI SDK (`ai` package) for LLM interaction
- **Database:** SQLite via Drizzle ORM
- **HTTP Server:** Hono framework with OpenAPI spec generation
- **TUI:** OpenTUI + SolidJS (terminal rendering)
- **Web Frontend:** SolidJS
- **Schema Validation:** Zod

### Key Architectural Pattern

The backend follows a **service-oriented architecture using Effect-TS**. Every major subsystem (Session, Agent, Provider, Permission, Tool, etc.) is defined as an Effect `Context.Service` with a `Layer` that provides its implementation. Services declare their dependencies as Layer requirements, and the runtime composes them.

```
packages/opencode/src/
  agent/          - Agent definitions and generation
  session/        - Session management, LLM calls, compaction, prompting
  tool/           - Built-in tool implementations
  provider/       - AI provider integrations
  permission/     - Permission evaluation and approval
  config/         - Configuration loading and schema
  server/         - HTTP/WebSocket API (Hono)
  control-plane/  - Workspace management
  worktree/       - Git worktree support
  plugin/         - Plugin loading and hooks
  bus/            - Event bus (pub/sub)
  sync/           - Event sourcing / sync system
  storage/        - SQLite database layer
  snapshot/       - Git-based file snapshots for undo/redo
  effect/         - Effect-TS infrastructure (runtime, state, logging)
  mcp/            - Model Context Protocol client
  lsp/            - Language Server Protocol integration
  skill/          - Skill system (loadable instruction sets)
  file/           - File watching, ripgrep integration
  cli/            - CLI entry points and TUI
```

---

## 2. Session/Thread Management

**File:** `packages/opencode/src/session/index.ts`

Sessions are the core conversation unit. Each session has:

- `id` (SessionID -- ULID-based)
- `slug` (human-readable)
- `projectID` -- ties to a project/directory
- `workspaceID` -- optional workspace association
- `parentID` -- supports parent/child session hierarchy (for forking)
- `title` -- auto-generated, can be renamed
- `version` -- tracks schema version
- `summary` -- file change stats (additions, deletions, files, diffs)
- `share` -- sharing URL
- `revert` -- revert info (messageID, partID, snapshot, diff)
- `permission` -- session-level permission overrides
- `time` -- created, updated, compacting, archived timestamps

Sessions support:
- **Forking**: `getForkedTitle()` creates "Title (fork #N)" naming
- **Child sessions**: Sub-agent tasks create child sessions linked via `parentID`
- **Archiving**: Sessions can be archived (soft delete)

The `Session.Service` (Effect service) provides CRUD operations backed by SQLite via Drizzle ORM. Session events are published via the event bus:
- `Session.Event.Created`
- `Session.Event.Updated`
- `Session.Event.Deleted`
- `Session.Event.Diff` (file change diffs)
- `Session.Event.Error`

### Messages

**File:** `packages/opencode/src/session/message-v2.ts`

Messages use a rich part-based structure (`MessageV2`). Each message has multiple parts:

| Part Type | Description |
|-----------|-------------|
| `TextPart` | LLM text output |
| `ReasoningPart` | Chain-of-thought / thinking |
| `ToolPart` | Tool call with state machine (pending -> running -> completed/error) |
| `FilePart` | Attached files with source info (file, symbol, resource) |
| `AgentPart` | Agent invocation |
| `CompactionPart` | Compaction marker |
| `SubtaskPart` | Sub-agent task delegation |
| `RetryPart` | Retry attempt info |
| `StepStartPart` | LLM step boundary with snapshot |
| `SnapshotPart` | Filesystem snapshot reference |
| `PatchPart` | File change patch |

User messages (`MessageV2.User`) track:
- Model selection (providerID, modelID, variant)
- Agent name
- System prompt
- Output format (text or JSON schema for structured output)
- Token usage

---

## 3. Compaction

**Files:**
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/overflow.ts`
- `packages/opencode/src/agent/prompt/compaction.txt`

### Overflow Detection

**File:** `packages/opencode/src/session/overflow.ts`

Overflow is detected by comparing total token usage against the model's context window:

```typescript
const COMPACTION_BUFFER = 20_000
// usable = model.limit.input - reserved (or context - maxOutputTokens)
// overflow = count >= usable
```

The `reserved` value can be configured via `compaction.reserved` in config, defaulting to `min(20000, maxOutputTokens)`.

Auto-compaction can be disabled via `compaction.auto: false`.

### Pruning

Before full compaction, the system **prunes old tool call outputs** to free context space:

- `PRUNE_MINIMUM = 20_000` tokens -- minimum savings to trigger pruning
- `PRUNE_PROTECT = 40_000` tokens -- protects the most recent tool calls
- Protected tools: `["skill"]` -- never pruned
- Walks backward through message parts, marks old tool outputs as compacted
- Sets `time.compacted` on pruned parts

### Compaction Process

When overflow is detected:

1. A special "compaction" agent is invoked (hidden primary agent)
2. The compaction prompt instructs the LLM to create a detailed summary covering:
   - What was done
   - What is currently being worked on
   - Which files are being modified
   - What needs to be done next
   - Key user preferences and constraints
   - Important technical decisions
3. Plugins can customize via `experimental.session.compacting` hook
4. The summary replaces older messages, preserving the last user message for replay
5. On overflow compaction, it finds the last real user message and splits there, summarizing everything before it

### Compaction Prompt Template

The compaction agent produces a structured summary following this template:
- **Goal** -- What the user is trying to accomplish
- **Instructions** -- Constraints and preferences
- Key decisions and context for continuation

---

## 4. Worktrees

**Files:**
- `packages/opencode/src/worktree/index.ts`
- `packages/opencode/src/control-plane/adaptors/worktree.ts`
- `packages/opencode/src/control-plane/workspace.ts`

### Workspace System

Worktrees are exposed through a **Workspace abstraction** in the control plane. Workspaces have pluggable adaptors:

```typescript
interface WorkspaceAdaptor {
  name: string
  description: string
  configure(info): Promise<config>
  create(info): Promise<void>
  remove(info): Promise<void>
  target(info): { type: "local", directory: string }
}
```

The `WorktreeAdaptor` implements this interface specifically for git worktrees.

### Worktree Service

The `Worktree.Service` (Effect service) provides:

- `makeWorktreeInfo(name?)` -- generates worktree name, branch, directory
- `createFromInfo(info, startCommand?)` -- creates the git worktree
- `remove(input)` -- removes the worktree
- `reset(input)` -- resets worktree state

It uses Effect's `ChildProcessSpawner` to execute git commands. The worktree is created from the current project's git repository with a generated branch name.

### Workspace Lifecycle

Workspaces are persisted in SQLite (`WorkspaceTable`), associated with projects, and can sync events from remote sources (SSE-based). Each workspace has:
- `id`, `type` (e.g., "Worktree"), `branch`, `name`, `directory`, `projectID`
- Connection status tracking (connected/connecting/disconnected/error)

Sessions can be associated with workspaces via `workspaceID`.

---

## 5. TUI Framework

**Files:**
- `packages/opencode/src/cli/cmd/tui/app.tsx`
- `packages/opencode/src/cli/cmd/tui/context/*.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/*.tsx`
- `packages/opencode/src/cli/cmd/tui/component/*.tsx`

### OpenTUI

The TUI uses **@opentui/core** (v0.1.97) and **@opentui/solid** -- a terminal UI rendering framework based on SolidJS. Key imports:

```typescript
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
```

The renderer is configured with:
- 60 FPS target
- Optional mouse support (can be disabled via `OPENCODE_DISABLE_MOUSE` flag)
- Kitty keyboard protocol
- External output passthrough mode
- Copy-to-clipboard support

### App Structure

The TUI app uses a deep SolidJS context provider tree:

```
ErrorBoundary
  ArgsProvider
    ExitProvider
      KVProvider
        ToastProvider
          RouteProvider
            TuiConfigProvider
              SDKProvider (connects to backend HTTP server)
                ProjectProvider
                  SyncProvider
                    ThemeProvider (30+ themes: catppuccin, dracula, nord, etc.)
                      LocalProvider
                        KeybindProvider
                          PromptStashProvider
                            DialogProvider
                              CommandProvider
                                FrecencyProvider
                                  PromptHistoryProvider
                                    PromptRefProvider
                                      App
```

### Routes

- **Home** (`routes/home.tsx`) -- Project/session list
- **Session** (`routes/session/index.tsx`) -- Active conversation view with:
  - Message display
  - Permission dialogs (`permission.tsx`)
  - Question prompts (`question.tsx`)
  - Sub-agent views (`dialog-subagent.tsx`)
  - Timeline/fork dialogs
  - Footer with status

### Dialogs

Rich dialog system: model picker, provider selector, MCP management, theme picker, agent selector, command palette, session list, workspace creator, status popover, help, etc.

### Plugin System for TUI

**File:** `packages/opencode/src/cli/cmd/tui/plugin/`

The TUI has its own plugin system with:
- Plugin slots (`slots.tsx`)
- Runtime management
- API layer (`api.tsx`)
- Feature plugins for sidebar (files, LSP, MCP, todo, context) and home (footer, tips)

---

## 6. Provider Integration

**File:** `packages/opencode/src/provider/provider.ts`

### Bundled Providers

opencode bundles 25+ AI provider SDKs directly:

| Provider | SDK Package |
|----------|------------|
| Anthropic | `@ai-sdk/anthropic` |
| OpenAI | `@ai-sdk/openai` |
| Google (Gemini) | `@ai-sdk/google` |
| Google Vertex | `@ai-sdk/google-vertex` |
| Vertex Anthropic | `@ai-sdk/google-vertex/anthropic` |
| AWS Bedrock | `@ai-sdk/amazon-bedrock` |
| Azure | `@ai-sdk/azure` |
| xAI (Grok) | `@ai-sdk/xai` |
| Mistral | `@ai-sdk/mistral` |
| Groq | `@ai-sdk/groq` |
| DeepInfra | `@ai-sdk/deepinfra` |
| Cerebras | `@ai-sdk/cerebras` |
| Cohere | `@ai-sdk/cohere` |
| Together AI | `@ai-sdk/togetherai` |
| Perplexity | `@ai-sdk/perplexity` |
| Vercel | `@ai-sdk/vercel` |
| OpenRouter | `@openrouter/ai-sdk-provider` |
| GitHub Copilot | Custom `@ai-sdk/openai-compatible` wrapper |
| GitLab | `gitlab-ai-provider` |
| Venice AI | `venice-ai-sdk-provider` |
| Alibaba | `@ai-sdk/alibaba` |
| AI Gateway | `@ai-sdk/gateway` / `ai-gateway-provider` |

### Provider Architecture

All providers implement the Vercel AI SDK's `LanguageModelV3` interface. The `Provider.Service` (Effect service) manages:

- Loading provider SDKs (bundled or npm-installed)
- Model discovery and listing
- Authentication (API keys, OAuth, custom auth plugins)
- Custom provider configuration with per-provider options
- SSE timeout wrapping for streaming responses
- LiteLLM proxy compatibility (dummy tool injection)

### Custom Provider Support

Providers can be configured in `opencode.json`:
```json
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "..." },
      "models": { "my-model": { ... } }
    }
  }
}
```

Custom loaders handle special cases per provider (Anthropic beta headers, OpenCode auth, Bedrock credentials, Vertex OAuth, etc.).

### Provider-Specific System Prompts

**File:** `packages/opencode/src/session/system.ts`

Different system prompts are used depending on the model family:
- `anthropic.txt` for Claude models
- `beast.txt` for GPT-4/o1/o3
- `gpt.txt` for other GPT models
- `gemini.txt` for Gemini
- `codex.txt` for Codex models
- `trinity.txt` for Trinity models
- `kimi.txt` for Kimi models
- `default.txt` fallback

The system prompt includes environment info (working directory, worktree, git status, platform, date).

---

## 7. Tool System

**Files:**
- `packages/opencode/src/tool/tool.ts` -- Tool abstraction
- `packages/opencode/src/tool/registry.ts` -- Tool registry
- `packages/opencode/src/tool/*.ts` -- Individual tools

### Tool Abstraction

```typescript
namespace Tool {
  interface Def<P, M> {
    id: string
    description: string
    parameters: ZodSchema
    execute(args, ctx: Context): Effect<ExecuteResult>
  }

  type Context = {
    sessionID, messageID, agent, abort: AbortSignal, callID,
    messages: MessageV2.WithParts[],
    metadata(input): Effect<void>,  // update tool call metadata
    ask(input): Effect<void>,       // request permission
  }

  interface ExecuteResult {
    title: string
    metadata: Record<string, any>
    output: string
    attachments?: FilePart[]
  }
}
```

All tool outputs are automatically **truncated** via `Truncate.Service` based on the agent's context budget.

### Built-in Tools

| Tool | File | Description |
|------|------|-------------|
| `bash` | `bash.ts` | Shell command execution with tree-sitter parsing for permission analysis |
| `read` | `read.ts` | File reading |
| `write` | `write.ts` | File writing |
| `edit` | `edit.ts` | String replacement editing |
| `apply_patch` | `apply_patch.ts` | Unified diff patch application |
| `multiedit` | `multiedit.ts` | Multiple edits in one call |
| `glob` | `glob.ts` | File pattern matching |
| `grep` | `grep.ts` | Content search via ripgrep |
| `codesearch` | `codesearch.ts` | Code-aware search |
| `ls` | `ls.ts` | Directory listing |
| `task` | `task.ts` | Sub-agent task delegation |
| `todo` | `todo.ts` | Todo item management |
| `question` | `question.ts` | Ask user a question |
| `plan` | `plan.ts` | Plan mode enter/exit |
| `webfetch` | `webfetch.ts` | Web page fetching |
| `websearch` | `websearch.ts` | Web search |
| `lsp` | `lsp.ts` | Language server queries |
| `skill` | `skill.ts` | Load skills |
| `invalid` | `invalid.ts` | Catch-all for unknown tools |

### Custom Tools

Users can define custom tools in:
- `.opencode/tool/*.ts` or `.opencode/tools/*.ts`
- Via plugins that export `ToolDefinition` objects

### Tool Registry

The `ToolRegistry.Service` composes all tools and filters them per request based on:
- Provider capabilities (e.g., some providers don't support certain tools)
- Agent permissions (e.g., `explore` agent only gets read-only tools)
- Feature flags (e.g., `questionEnabled` based on client type)
- Tool descriptions can be dynamic based on agent

### Bash Tool

The bash tool (`bash.ts`) is particularly sophisticated:
- Uses **tree-sitter** to parse shell commands (bash and PowerShell)
- Extracts file paths from commands for permission checking
- Supports working directory, timeout, and description parameters
- Default timeout: 2 minutes
- Handles environment variable expansion, home directory resolution
- Integrates with the permission system for file access patterns

---

## 8. State Management

### Effect-TS Service Pattern

Every major subsystem is an Effect Service:

```typescript
export class Service extends Context.Service<Service, Interface>()("@opencode/ServiceName") {}
export const layer = Layer.effect(Service, Effect.gen(function* () { ... }))
```

Services declare dependencies as `Layer.Layer<Provides, Error, Requires>` and are composed at startup.

### InstanceState

**File:** `packages/opencode/src/effect/instance-state.ts`

`InstanceState` is the core state management primitive. It's a **scoped cache keyed by directory**:

```typescript
InstanceState.make<State>(
  Effect.fn("Name.state")(function* (ctx: InstanceContext) {
    // Initialize state per-instance
    return { ... }
  })
)
```

- Each project directory gets its own isolated state instance
- State is lazily initialized on first access
- Supports invalidation (for config reloads)
- Integrates with instance lifecycle (disposed when instance is removed)

### Instance Context

**File:** `packages/opencode/src/project/instance.ts`

The `Instance` module provides async local storage (ALS) for the current project context:

```typescript
interface InstanceContext {
  directory: string   // working directory
  worktree: string    // git worktree root
  project: Project.Info
}
```

Used via `Instance.directory`, `Instance.worktree`, `Instance.project`, `Instance.bind()`, `Instance.restore()`.

### Event Bus

**File:** `packages/opencode/src/bus/index.ts`

A typed pub/sub event bus built on Effect's `PubSub`:

- Per-instance bus (scoped to project directory)
- Global bus (`GlobalBus`) for cross-instance events
- Type-safe event definitions via `BusEvent.define(type, schema)`
- Supports both streaming subscriptions and callbacks
- Events propagate to SSE clients for real-time TUI updates

### Sync Events

**File:** `packages/opencode/src/sync/index.ts`

An event-sourcing system for durable state:

- Events are versioned and stored in SQLite
- Projectors consume events to update read models
- Supports event conversion between versions
- Used for sessions, messages, and parts

### Session Run State

**File:** `packages/opencode/src/session/run-state.ts`

Manages the lifecycle of active session runs:
- Uses `Runner` (Effect-based) per session
- Enforces single-active-run per session (throws `BusyError`)
- Supports cancellation via fiber interruption
- Tracks busy/idle status

---

## 9. Key Abstractions

### Core Types

| Type | File | Description |
|------|------|-------------|
| `SessionID` | `session/schema.ts` | ULID-based session identifier |
| `MessageID` | `session/schema.ts` | ULID-based message identifier |
| `PartID` | `session/schema.ts` | ULID-based part identifier |
| `ProjectID` | `project/schema.ts` | Project identifier |
| `WorkspaceID` | `control-plane/schema.ts` | Workspace identifier |
| `ProviderID` | `provider/schema.ts` | Provider identifier |
| `ModelID` | `provider/schema.ts` | Model identifier |
| `PermissionID` | `permission/schema.ts` | Permission request identifier |

### Service Interfaces

| Service | Tag | Key Methods |
|---------|-----|-------------|
| `Session.Service` | `@opencode/Session` | create, get, messages, updatePart |
| `Agent.Service` | `@opencode/Agent` | get, list, defaultAgent, generate |
| `Provider.Service` | `@opencode/Provider` | getModel, getProvider, getLanguage, list |
| `Permission.Service` | `@opencode/Permission` | ask, reply, list |
| `ToolRegistry.Service` | `@opencode/ToolRegistry` | ids, all, tools(model) |
| `Config.Service` | `@opencode/Config` | get, directories, waitForDependencies |
| `Bus.Service` | `@opencode/Bus` | publish, subscribe, subscribeCallback |
| `Plugin.Service` | `@opencode/Plugin` | trigger, list, init |
| `Snapshot.Service` | `@opencode/Snapshot` | track, patch, restore, revert, diff |
| `LLM.Service` | `@opencode/LLM` | stream |
| `SessionProcessor.Service` | `@opencode/SessionProcessor` | create |
| `SessionCompaction.Service` | `@opencode/SessionCompaction` | isOverflow, prune, process, create |
| `SessionPrompt.Service` | `@opencode/SessionPrompt` | prompt, loop, shell, command, cancel |
| `Worktree.Service` | `@opencode/Worktree` | makeWorktreeInfo, createFromInfo, remove, reset |
| `SystemPrompt.Service` | `@opencode/SystemPrompt` | environment, skills |

---

## 10. Message Streaming

**File:** `packages/opencode/src/session/llm.ts`

### LLM Streaming

The `LLM.Service` wraps Vercel AI SDK's `streamText()` into an Effect `Stream`:

```typescript
interface StreamInput {
  user: MessageV2.User
  sessionID: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, Tool>
  toolChoice?: "auto" | "required" | "none"
}
```

The stream produces events of type `Result["fullStream"]` (AI SDK's streaming event types).

### System Prompt Assembly

1. Agent prompt OR provider-specific prompt
2. Custom system prompts from the call
3. User message system overrides
4. Plugin transformations via `experimental.chat.system.transform` hook
5. Environment info (directory, worktree, git status, platform, date)
6. Skill descriptions (if skill tool is enabled)

The system prompt is split into 2 parts for **prompt caching** optimization -- the stable header stays as the first part, dynamic content as the second.

### Processing Pipeline

**File:** `packages/opencode/src/session/processor.ts`

The `SessionProcessor` handles the stream event-by-event:

1. **`start`** -- Sets session status to busy
2. **`reasoning-start/delta/end`** -- Tracks reasoning/thinking parts
3. **`text-delta`** -- Accumulates text output parts
4. **`tool-call`** -- Creates tool parts, executes tools with permission checks
5. **`step-start/end`** -- Manages step boundaries, snapshots, doom loop detection
6. **`finish`** -- Records token usage, checks for overflow

Key features:
- **Doom loop detection**: Tracks consecutive steps without tool success (threshold: 3)
- **Snapshot tracking**: Captures filesystem state at step boundaries
- **Tool execution**: Parallel tool calls with deferred completion tracking
- **Compaction trigger**: Checks for context overflow after each finish event
- Returns `"compact" | "stop" | "continue"` to drive the outer loop

### TUI Streaming

**File:** `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`

The TUI connects to the backend via SSE (Server-Sent Events):

```typescript
const events = await sdk.global.event({ signal })
for await (const event of events.stream) {
  handleEvent(event)  // batched at 16ms intervals
}
```

Events are batched and flushed in SolidJS `batch()` calls for efficient rendering at ~60fps.

---

## 11. Permission/Approval System

**File:** `packages/opencode/src/permission/index.ts`

### Permission Model

Permissions use a **pattern-matching ruleset** system:

```typescript
type Rule = { permission: string, pattern: string, action: "allow" | "deny" | "ask" }
type Ruleset = Rule[]
```

### Evaluation

**File:** `packages/opencode/src/permission/evaluate.ts`

Permissions are evaluated by matching `(permission, pattern)` against rulesets using **wildcard glob matching**. Rules are checked in order; the last matching rule wins.

### Permission Categories

From the default agent configuration:

| Permission | Default | Description |
|-----------|---------|-------------|
| `*` (wildcard) | `allow` | Default for all tools |
| `doom_loop` | `ask` | Repeated failures |
| `external_directory.*` | `ask` | Access outside project |
| `question` | `deny` (build: `allow`) | User questions |
| `plan_enter` / `plan_exit` | `deny` (build: `allow`) | Mode switching |
| `read.*` | `allow` | File reading |
| `read.*.env` / `read.*.env.*` | `ask` | Sensitive files |
| `edit.*` | `deny` (plan agent) | File editing in plan mode |

### Permission Flow

1. Tool execution calls `ctx.ask()` with permission details
2. `Permission.Service.ask()` evaluates against merged rulesets (agent + session + config)
3. If action is `"allow"` -- proceeds immediately
4. If action is `"deny"` -- throws `DeniedError`
5. If action is `"ask"` -- publishes `Permission.Event.Asked`, creates a deferred, and waits
6. TUI shows permission dialog (`routes/session/permission.tsx`)
7. User replies: `"once"` (allow this time), `"always"` (add to approved list), or `"reject"`
8. `Permission.Event.Replied` resolves the deferred

### Approval Persistence

- "Always" approvals are stored in SQLite (`PermissionTable`) per project
- Session-level permission overrides can be set
- Config-level permissions in `opencode.json` apply globally

### Error Types

- `RejectedError` -- User explicitly rejected
- `CorrectedError` -- User rejected with feedback message
- `DeniedError` -- Rule prevents usage (includes relevant rules for the model to see)

---

## 12. Configuration

**File:** `packages/opencode/src/config/config.ts`

### Configuration Hierarchy (lowest to highest priority)

1. Remote well-known config (`/.well-known/opencode`)
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`.opencode/opencode.json` or `.opencode/opencode.jsonc`)
5. `OPENCODE_CONFIG_CONTENT` env var
6. Console/org remote config
7. Managed directory config (`/etc/opencode/` or `/Library/Application Support/opencode/`)
8. macOS managed preferences (MDM/`.mobileconfig`)
9. `OPENCODE_PERMISSION` env var (permissions only)

### Config File Format

JSONC (JSON with comments) supported. Key fields:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "anthropic/claude-haiku-3-5",
  "default_agent": "build",
  "provider": { /* custom providers */ },
  "mcp": { /* MCP server configs */ },
  "permission": { /* permission overrides */ },
  "tools": { /* tool enable/disable */ },
  "agent": { /* agent customization */ },
  "command": { /* custom commands */ },
  "plugin": [ /* plugin specs */ ],
  "instructions": [ /* additional instruction files */ ],
  "formatter": { /* code formatter configs */ },
  "lsp": { /* LSP server configs */ },
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 20000
  },
  "experimental": {
    "batch_tool": false,
    "openTelemetry": false,
    "mcp_timeout": 30000
  }
}
```

### Custom Commands

Defined as markdown files in `.opencode/command/*.md` with frontmatter:

```markdown
---
name: commit
description: Create a conventional commit
---
Template content with {{variables}}
```

### Custom Agents

Defined as markdown files in `.opencode/agent/*.md`:

```markdown
---
name: my-agent
description: Custom agent
mode: primary
---
System prompt content
```

### Enterprise / MDM Support

- Managed config directory: `/Library/Application Support/opencode` (macOS), `/etc/opencode` (Linux), `C:\ProgramData\opencode` (Windows)
- macOS managed preferences via `.mobileconfig` / MDM (Jamf, Kandji)
- Strips MDM metadata keys before parsing

---

## 13. How They Use claude-agent-sdk

**They do NOT use `claude-agent-sdk`.** No references found in the codebase.

Instead, opencode uses:

### Vercel AI SDK (`ai` package)

The primary LLM interaction layer. Key imports:
```typescript
import { streamText, generateObject, streamObject, tool, jsonSchema, type ModelMessage } from "ai"
```

- `streamText()` -- Main streaming call in `LLM.run()`
- `generateObject()` / `streamObject()` -- For structured output (title generation, etc.)
- `tool()` / `jsonSchema()` -- Tool definition for the AI SDK
- `convertToModelMessages()` -- Message format conversion

### @ai-sdk/anthropic

Direct Anthropic SDK integration with beta headers:
```typescript
headers: {
  "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
}
```

### @agentclientprotocol/sdk

For ACP (Agent Client Protocol) support -- an external protocol for agent interop:

```typescript
import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
```

The `ACPSessionManager` (`packages/opencode/src/acp/session.ts`) wraps opencode sessions in the ACP protocol format.

### @modelcontextprotocol/sdk

For MCP (Model Context Protocol) client support -- connecting to MCP servers for additional tools and resources.

### Effect-TS

The entire backend is built on Effect for:
- Dependency injection via `Context.Service` and `Layer`
- Structured concurrency via `Effect`, `Fiber`, `Stream`, `Scope`
- State management via `ScopedCache` (InstanceState)
- Error handling via typed errors (`Schema.TaggedErrorClass`)
- Pub/sub via `PubSub`
- Logging via custom Effect logger

---

## Summary of Key Design Decisions

1. **Effect-TS everywhere** -- Provides type-safe dependency injection, structured concurrency, and composable services. Every service declares its dependencies, making the architecture explicit.

2. **AI SDK abstraction** -- Using Vercel AI SDK as the LLM abstraction layer means any provider with an AI SDK adapter works automatically. 25+ providers bundled.

3. **Part-based messages** -- Messages are not simple text; they're composed of typed parts (text, reasoning, tools, files, snapshots, etc.), enabling rich UI rendering and fine-grained operations like pruning.

4. **Git-based snapshots** -- A dedicated git repository (separate from the project) tracks filesystem state for undo/redo, independent of the project's own git history.

5. **Event-sourced state** -- Sessions and messages use event sourcing with projectors, enabling reliable sync between server and clients.

6. **Plugin architecture** -- Both backend (hooks system) and TUI (slot-based) plugin systems, plus custom tools and commands via filesystem convention.

7. **Pattern-based permissions** -- Glob patterns for fine-grained tool access control, evaluated against merged rulesets from multiple sources (defaults, config, session, agent).

8. **Client-server architecture** -- Even the TUI runs as a client connecting to a local HTTP/WebSocket server (Hono), enabling web, desktop, and terminal clients to share the same backend.
