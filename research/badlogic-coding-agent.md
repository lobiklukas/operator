# badlogic/pi-mono coding-agent Research

> Deep-dive analysis of the `@mariozechner/pi-coding-agent` package (v0.67.1) from the [badlogic/pi-mono](https://github.com/badlogic/pi-mono) monorepo, authored by Mario Zechner. CLI binary name: **`pi`**.

---

## 1. Overall Architecture

### Language and Framework

- **Language:** TypeScript (strict, ESM-only via `"type": "module"`)
- **Runtime:** Node.js >= 20.6.0, with optional Bun binary compilation support
- **Build tool:** `tsgo` (TypeScript compiler, not tsc), with `shx` for cross-platform shell commands
- **Test framework:** Vitest
- **No framework dependency** -- the TUI, AI abstraction, and agent core are all custom packages in the same monorepo

### Monorepo Package Structure

The coding-agent sits in a layered monorepo with clean separation of concerns across four packages:

| Package | npm Name | Role |
|---------|----------|------|
| `packages/tui` | `@mariozechner/pi-tui` | Terminal UI library with differential rendering |
| `packages/ai` | `@mariozechner/pi-ai` | Unified LLM API (Anthropic, OpenAI, Google, Mistral, Groq, AWS Bedrock) |
| `packages/agent` | `@mariozechner/pi-agent-core` | Stateful agent loop with tool execution and event streaming |
| `packages/coding-agent` | `@mariozechner/pi-coding-agent` | The CLI harness -- tools, sessions, extensions, modes |

Dependency flow: `coding-agent` -> `agent-core` -> `ai` -> (provider SDKs). The TUI is a sibling dependency of the coding-agent.

### Source Tree (`packages/coding-agent/src/`)

```
src/
  cli.ts                     # Shebang entry point
  main.ts                    # CLI orchestration (arg parsing, mode selection, session creation)
  config.ts                  # Path resolution, version, package detection (npm/pnpm/yarn/bun)
  migrations.ts              # Schema migration logic
  package-manager-cli.ts     # `pi package` / `pi config` subcommands
  index.ts                   # Public SDK exports

  cli/
    args.ts                  # CLI argument parsing
    config-selector.ts       # Interactive config selection
    file-processor.ts        # @file argument processing (images, text)
    initial-message.ts       # Build first prompt from CLI args + stdin + files
    list-models.ts           # --list-models output
    session-picker.ts        # Interactive session selector for --resume

  core/
    agent-session.ts         # AgentSession class (3059 lines) -- central runtime
    agent-session-runtime.ts # AgentSessionRuntime -- owns session + services, handles switch/fork/import
    agent-session-services.ts# Factory for cwd-bound services
    session-manager.ts       # JSONL tree-based session persistence (~1420 lines)
    settings-manager.ts      # Global + project settings with file locking
    system-prompt.ts         # System prompt construction with tools, guidelines, context files
    messages.ts              # Custom message types (BashExecution, Custom, BranchSummary, CompactionSummary)
    model-registry.ts        # Model discovery and auth
    model-resolver.ts        # CLI model pattern matching, scoped model resolution
    event-bus.ts             # Simple pub/sub event bus (Node EventEmitter wrapper)
    bash-executor.ts         # Shell command execution
    extensions/              # Extension system (loader, runner, types, wrapper)
    compaction/              # Context compaction (compaction.ts, branch-summarization.ts, utils.ts)
    tools/                   # Built-in tools (read, bash, edit, write, grep, find, ls)
    export-html/             # HTML session export with template
    auth-storage.ts          # Credential storage
    keybindings.ts           # Keybinding manager
    prompt-templates.ts      # Reusable markdown prompts
    skills.ts                # Agent Skills standard implementation
    slash-commands.ts        # Built-in slash command registry
    sdk.ts                   # Public createAgentSession() API
    output-guard.ts          # stdout takeover for non-interactive modes
    resource-loader.ts       # Unified loader for extensions, skills, prompts, themes
    timings.ts               # Performance timing instrumentation

  modes/
    interactive/
      interactive-mode.ts    # Full TUI mode (4781 lines)
      components/            # 36 TUI components (see UI section)
      theme/                 # JSON theme files
      assets/                # PNG assets
    rpc/
      rpc-mode.ts            # Headless JSON-RPC over stdin/stdout
      rpc-client.ts          # Client for embedding
      rpc-types.ts           # Protocol types
      jsonl.ts               # JSONL line reader
    print-mode.ts            # Single-shot text/JSON output mode

  utils/
    git.ts, shell.ts, paths.ts, clipboard.ts, image-*.ts, etc.
```

---

## 2. How It Spawns/Uses Claude (and Other LLMs)

**Pi does NOT use Claude Code, the Claude Agent SDK, or any CLI wrapper.** It is a fully independent agent implementation that calls LLM provider APIs directly.

### Direct API via `@mariozechner/pi-ai`

The `pi-ai` package is a unified LLM abstraction layer that wraps:
- `@anthropic-ai/sdk` (Anthropic Claude models)
- `openai` (OpenAI models)
- `@google/genai` (Google Gemini)
- `@mistralai/mistralai` (Mistral)
- `@aws-sdk/client-bedrock-runtime` (AWS Bedrock)

Key functions: `streamSimple()` for streaming responses, `completeSimple()` for single-shot completions.

### Streaming Architecture

The `Agent` class (in `pi-agent-core`) calls the provider through a pluggable `streamFn`:

```typescript
// In sdk.ts -- createAgentSession()
agent = new Agent({
  streamFn: async (model, context, options) => {
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    return streamSimple(model, context, {
      ...options,
      apiKey: auth.apiKey,
      headers: auth.headers,
    });
  },
  // ...
});
```

The `Agent` does not know about Anthropic specifically. Model objects carry provider info (`model.provider`, `model.api`), and `streamSimple` routes to the correct SDK internally.

### Transport Options

Configurable via settings: `"sse"` (default) or `"websocket"`. Both are forwarded to the provider SDK calls.

### Model Resolution

Models are discovered from:
1. Provider SDK auto-discovery (checks for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.)
2. `~/.pi/agent/models.json` for custom model definitions
3. `--model provider/pattern:thinking` CLI flags
4. `--models` for scoped model sets (Ctrl+P cycling)

---

## 3. Session Management

Sessions are the central persistence mechanism, stored as **append-only JSONL files** with a **tree structure**.

### Session File Format

Each line is a JSON entry with `id` (UUID) and `parentId`, forming a tree:

```
{"version":3,"id":"session-uuid","timestamp":"...","cwd":"/path/to/project"}
{"id":"entry-1","parentId":null,"type":"model_change","provider":"anthropic","modelId":"claude-opus-4-5"}
{"id":"entry-2","parentId":"entry-1","type":"thinking_level_change","thinkingLevel":"medium"}
{"id":"entry-3","parentId":"entry-2","type":"message","message":{"role":"user",...}}
{"id":"entry-4","parentId":"entry-3","type":"message","message":{"role":"assistant",...}}
```

### Entry Types

- `message` -- user/assistant/toolResult messages
- `thinking_level_change` -- thinking level switches
- `model_change` -- model switches
- `compaction` -- compaction summaries with `firstKeptEntryId` pointer
- `branch_summary` -- summary of abandoned branches
- `custom_message` -- extension-injected messages
- `custom` -- arbitrary extension data
- `label` -- named bookmarks on entries
- `session_info` -- metadata (display name, parent session)

### Session Lifecycle

| Operation | Method | Description |
|-----------|--------|-------------|
| New session | `SessionManager.create(cwd, sessionDir)` | Creates new JSONL file in `<cwd>/.pi/sessions/` or `~/.pi/agent/sessions/` |
| Resume | `SessionManager.open(path)` | Opens existing file, applies migrations |
| Continue recent | `SessionManager.continueRecent(cwd)` | Finds most recently modified session for this cwd |
| Fork | `SessionManager.forkFrom(sourcePath, cwd)` | Copies source session to new file |
| In-memory | `SessionManager.inMemory()` | No persistence (for `--no-session`) |

### Context Reconstruction

`buildSessionContext()` walks the tree from the current leaf to root, collecting messages, model, and thinking level:

```typescript
// Returns { messages: AgentMessage[], model: {...}, thinkingLevel: "medium" }
const context = sessionManager.buildSessionContext();
```

### Session Discovery

Sessions are stored per-project in `.pi/sessions/` by default. Global session listing scans `~/.pi/agent/sessions/` across all projects. Sessions from other projects can be forked into the current project with user confirmation.

### Branching

The tree structure enables **branching without separate files**. The `/tree` command lets users navigate branches, and `/fork` creates new branches from any user message. When navigating away from a branch, a **branch summary** is generated via LLM to preserve context.

### Migration System

Version upgrades from v1 to v3 are handled by `migrations.ts`, including adding tree structure (id/parentId), renaming message roles, and schema updates. Migrations run on file open.

---

## 4. Compaction

Compaction handles context window limits by LLM-summarizing older messages while keeping recent ones.

### Trigger Condition

```typescript
function shouldCompact(contextTokens, contextWindow, settings) {
  return contextTokens > contextWindow - settings.reserveTokens; // default 16384
}
```

Context tokens are estimated from the last assistant message's `usage` field (actual provider-reported tokens), plus a char/4 heuristic for any trailing messages after that.

### Compaction Algorithm

1. **Find cut point:** Walk backwards from newest entry, accumulating estimated token counts until `keepRecentTokens` (default 20,000) is reached. Valid cut points are user, assistant, custom, or bashExecution messages (never tool results).

2. **Handle split turns:** If the cut falls mid-turn (e.g., after an assistant message but before its tool results), the turn is split. Messages before the cut point within that turn get a separate "turn prefix summary."

3. **Generate summary:** Calls the LLM with a structured prompt requesting:
   - Goal, Constraints, Progress (Done/In Progress/Blocked), Key Decisions, Next Steps, Critical Context

4. **Iterative updates:** If a previous compaction summary exists, uses an UPDATE prompt that merges new information into the existing summary rather than regenerating from scratch.

5. **File tracking:** Extracts read/modified file lists from tool calls across all compacted messages and appends them to the summary.

6. **Persist:** Appends a `compaction` entry to the session JSONL with `summary`, `firstKeptEntryId`, `tokensBefore`, and file operation details.

### Settings

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### Extension Hook

Extensions can intercept compaction via the `before_provider_request` event and the compaction preparation API (`prepareCompaction()`), allowing custom compaction strategies.

---

## 5. Threads (Tree-Based Conversation)

Pi uses a **tree** rather than linear threads. Every session entry has `id` and `parentId`, forming a DAG where each path from root to leaf is a conversation branch.

### Key Operations

- **`/tree`**: Opens a tree selector UI showing all branches. Filter modes: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- **`/fork`**: From any user message, creates a new branch. In persisted sessions, creates a physically separate JSONL file via `createBranchedSession()`.
- **Navigate tree**: `session.navigateTree(targetId)` moves the leaf pointer. When leaving a branch, generates a **branch summary** via LLM.
- **Labels**: Any entry can be labeled (`/label`) for bookmarking.

### Branch Summarization

When navigating away from a branch:

1. Collects entries between old leaf and the common ancestor with the target
2. Walks from newest to oldest, fitting within token budget
3. Generates structured summary (Goal, Constraints, Progress, Key Decisions, Next Steps)
4. Summary is injected as a `branchSummary` user-role message in the target branch's context

This ensures context from abandoned branches isn't completely lost.

### Context Building

`buildSessionContext()` always walks from the current leaf to root, so switching branches immediately changes what the LLM sees. Compaction entries and branch summaries along the path are included as synthetic user messages with XML-tagged content:

```
<summary>
## Goal
...
</summary>
```

---

## 6. Worktrees

**Pi does not implement git worktree support.** There is no evidence of git worktree management in the codebase.

However, sessions **are tied to working directories**. Each session header records its `cwd`. When resuming a session from a different project directory:

- Interactive mode prompts the user with "Continue" / "Cancel" if the original cwd no longer exists
- Non-interactive modes fail with `MissingSessionCwdError`
- Sessions can be forked into the current project

The `AgentSessionRuntime` class manages cwd binding:
```typescript
// When switching sessions, services are recreated for the new cwd
const sessionManager = SessionManager.open(sessionPath, undefined, cwdOverride);
assertSessionCwdExists(sessionManager, this.cwd);
```

---

## 7. TUI/UI

### Architecture

Pi's TUI is built on `@mariozechner/pi-tui`, a custom terminal UI library with differential rendering. It is NOT based on Ink, blessed, or any other TUI framework.

### Modes

Pi operates in four mutually exclusive modes:

| Mode | Trigger | Description |
|------|---------|-------------|
| **Interactive** | Default (TTY) | Full TUI with editor, message rendering, keybindings |
| **Print** | `pi -p "prompt"` or piped stdin | Single-shot: send prompt, print response, exit |
| **JSON** | `pi --mode json "prompt"` | Event stream as JSONL to stdout |
| **RPC** | `pi --mode rpc` | Headless JSON-RPC over stdin/stdout for embedding |

### Interactive Mode Components (36 components)

The `src/modes/interactive/components/` directory contains a rich component set:

- **Message display:** `assistant-message.ts`, `user-message.ts`, `custom-message.ts`, `branch-summary-message.ts`, `compaction-summary-message.ts`, `skill-invocation-message.ts`
- **Tool rendering:** `tool-execution.ts`, `bash-execution.ts`, `diff.ts`
- **Editors:** `custom-editor.ts`, `extension-editor.ts`, `extension-input.ts`
- **Selectors:** `model-selector.ts`, `thinking-selector.ts`, `theme-selector.ts`, `session-selector.ts`, `tree-selector.ts`, `config-selector.ts`, `settings-selector.ts`, `extension-selector.ts`, `scoped-models-selector.ts`, `oauth-selector.ts`, `show-images-selector.ts`, `user-message-selector.ts`
- **UI chrome:** `footer.ts`, `keybinding-hints.ts`, `dynamic-border.ts`, `bordered-loader.ts`, `countdown-timer.ts`, `visual-truncate.ts`, `login-dialog.ts`

### Theme System

Themes are JSON files with hot-reload support via file watching. Built-in dark/light themes ship in `src/modes/interactive/theme/`. Custom themes can be placed in `~/.pi/agent/themes/` or specified per-project.

### Key Bindings

- Customizable via `KeybindingsManager`
- Ctrl+P cycles through scoped models
- Double-Escape opens tree view (configurable: fork/tree/none)
- Standard slash command autocomplete in editor

### RPC Mode for Embedding

The RPC protocol enables embedding pi in editors/IDEs:

```json
// Request
{"type": "prompt", "id": "1", "message": "Fix the bug", "images": []}

// Response
{"type": "response", "command": "prompt", "id": "1", "success": true}

// Events stream as AgentSessionEvent objects
{"type": "message_start", ...}
{"type": "message_update", ...}
```

Commands include: `prompt`, `steer`, `follow_up`, `abort`, `get_state`, `set_model`, `compact`, `switch_session`, `fork`, `bash`, `get_messages`, etc. Extension UI context is proxied through RPC with dialog/confirm/input/select support.

---

## 8. Tool System

### Built-in Tools

Pi ships 7 tools, with 4 active by default:

| Tool | Default | Description |
|------|---------|-------------|
| `read` | Yes | Read files (text + images, with offset/limit pagination, syntax highlighting) |
| `bash` | Yes | Execute shell commands (streaming output, timeout, 5000-line/512KB truncation) |
| `edit` | Yes | Exact text replacement edits with unified diff output |
| `write` | Yes | Create/overwrite files |
| `grep` | No | Ripgrep-style search (respects .gitignore) |
| `find` | No | File discovery |
| `ls` | No | Directory listing |

### Tool Implementation Pattern

Each tool follows a consistent factory pattern:

```typescript
// Pre-built instance using process.cwd()
export const readTool: Tool = createReadTool(process.cwd());

// Factory for custom cwd
export function createReadTool(cwd: string, options?: ReadToolOptions): Tool { ... }

// Definition for extensions (includes rendering hooks)
export function createReadToolDefinition(cwd: string, options?: ReadToolOptions): ToolDef { ... }
```

### Tool Features

- **`bash`**: Pluggable `BashOperations` interface (local or SSH), spawn hooks for modifying commands/env, configurable shell path and command prefix, real-time streaming with `onUpdate` callback, automatic temp file for large outputs
- **`read`**: Image detection and auto-resize (max 2000x2000), offset/limit for large file pagination, image content sent as multipart attachments
- **`edit`**: Multi-edit batching with `oldText`/`newText` pairs, line ending preservation (LF/CRLF), BOM stripping, unified diff generation
- **`write`**: Integrated with file mutation queue for safe concurrency

### File Mutation Queue

`withFileMutationQueue()` serializes concurrent file operations, preventing race conditions when the LLM issues parallel tool calls affecting the same file.

### Custom Tools via Extensions

Extensions can register custom tools via `ToolDefinition`:

```typescript
interface ToolDefinition<TInput, TDetails> {
  name: string;
  label: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (toolCallId, input, signal, onUpdate, ctx) => Promise<ToolResult>;
  render?: (details, options) => Component; // TUI rendering
}
```

### Tool Execution Modes

The `Agent` supports parallel (default) or sequential tool execution, configurable via `toolExecution` option. `beforeToolCall` and `afterToolCall` hooks allow extensions to intercept, modify, or cancel tool invocations.

---

## 9. State Management

### Layered State Architecture

State flows through several layers:

```
Settings (global + project JSON files)
  -> SettingsManager (merged, with file locking)
    -> AgentSessionServices (cwd-bound service bundle)
      -> AgentSession (runtime orchestration)
        -> Agent (in-memory state: messages, model, tools, streaming status)
          -> SessionManager (JSONL persistence)
```

### Agent State (`pi-agent-core`)

The `Agent` class maintains mutable state:

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
}
```

Assigning `state.tools` or `state.messages` copies the array (defensive copy pattern).

### AgentSession (coding-agent layer)

`AgentSession` wraps the `Agent` with session-specific concerns:
- Extension lifecycle management
- Scoped model tracking
- Compaction detection and execution
- Bash command execution (the `!` prefix feature)
- Session switching and branching coordination
- System prompt rebuilding when tools/extensions change

### AgentSessionRuntime

Owns the session + its cwd-bound services. Handles runtime replacement during `/new`, `/resume`, `/fork`, and `/import`:

```typescript
// Teardown current -> create new -> apply
async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
  await this.emitBeforeSwitch("resume", sessionPath);
  await this.teardownCurrent();
  this.apply(await this.createRuntime({ cwd, agentDir, sessionManager }));
}
```

### Settings Persistence

`SettingsManager` uses a two-scope merge strategy:
1. **Global**: `~/.pi/agent/settings.json`
2. **Project**: `<cwd>/.pi/settings.json`

Project settings override global settings. Nested objects merge recursively; arrays and primitives are overridden. File writes use `proper-lockfile` for safe concurrent access with sync retry logic.

---

## 10. Message Handling

### Message Types

Pi extends the standard user/assistant/toolResult roles with four custom message types via declaration merging on `CustomAgentMessages`:

| Type | Role | Purpose |
|------|------|---------|
| `BashExecutionMessage` | `bashExecution` | Shell command results from `!` prefix |
| `CustomMessage` | `custom` | Extension-injected messages |
| `BranchSummaryMessage` | `branchSummary` | Summary when leaving a branch |
| `CompactionSummaryMessage` | `compactionSummary` | Summary from context compaction |

### LLM Conversion

`convertToLlm()` transforms all custom message types to standard LLM messages:

- `bashExecution` -> `user` role with formatted command + output text
- `custom` -> `user` role with text/image content
- `branchSummary` -> `user` role with `<summary>` XML tags
- `compactionSummary` -> `user` role with `<summary>` XML tags
- Messages with `excludeFromContext: true` are filtered out (the `!!` prefix feature)

### Image Handling

Images can be blocked globally via `settings.images.blockImages`. When enabled, a defense-in-depth filter in `convertToLlmWithBlockImages` replaces all `ImageContent` with "Image reading is disabled." text placeholders.

### Event System

The `Agent` emits lifecycle events to subscribers:

- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`

`AgentSession` extends these with session-level events (`AgentSessionEvent`) for the UI layer.

### Message Queuing

Two separate queues control message injection:

- **Steering queue**: Messages injected after the current assistant turn finishes (e.g., "stop and do X instead")
- **Follow-up queue**: Messages that run only when the agent would otherwise stop

Both support `"all"` (drain everything) or `"one-at-a-time"` (process one per cycle) modes, configurable via settings.

---

## 11. Configuration

### Configuration Hierarchy

1. **CLI flags** (highest precedence): `--model`, `--thinking`, `--tools`, `--no-extensions`, `--system-prompt`, etc.
2. **Project settings**: `<cwd>/.pi/settings.json`
3. **Global settings**: `~/.pi/agent/settings.json`
4. **Defaults** (lowest precedence)

### Key Settings

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-4-5",
  "defaultThinkingLevel": "medium",
  "transport": "sse",
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000 },
  "branchSummary": { "reserveTokens": 16384, "skipPrompt": false },
  "retry": { "enabled": true, "maxRetries": 3, "baseDelayMs": 2000, "maxDelayMs": 60000 },
  "packages": ["some-npm-package", { "source": "git+https://...", "extensions": ["ext1"] }],
  "extensions": ["./my-extension.ts"],
  "skills": ["./my-skills/"],
  "prompts": ["./my-prompts/"],
  "themes": ["./my-theme.json"],
  "enabledModels": ["anthropic/*", "openai/gpt-4o*"],
  "terminal": { "showImages": true, "clearOnShrink": false },
  "images": { "autoResize": true, "blockImages": false },
  "shellPath": "/bin/zsh",
  "shellCommandPrefix": "shopt -s expand_aliases",
  "doubleEscapeAction": "tree",
  "sessionDir": "./custom-sessions/"
}
```

### Environment Variables

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc. for provider auth
- `PI_CODING_AGENT_DIR` overrides the global config directory
- `PI_OFFLINE` disables network features
- `PI_PACKAGE_DIR` overrides package asset resolution (for Nix/Guix)
- `PI_HARDWARE_CURSOR` enables terminal hardware cursor
- `PI_CLEAR_ON_SHRINK` clears empty rows when content shrinks
- `PI_STARTUP_BENCHMARK` measures initialization time

### Package System

Pi supports shareable resource bundles ("Pi Packages") from npm or git:

```json
{ "packages": ["@someone/pi-extension-pack"] }
```

Packages can provide extensions, skills, prompt templates, and themes. Object syntax allows filtering:

```json
{ "source": "@someone/pack", "extensions": ["specific-ext"], "skills": ["specific-skill"] }
```

---

## 12. Key Design Decisions

### 1. No Claude Code / No SDK Dependency

Pi is a fully independent implementation. It does not wrap Claude Code CLI, use the Anthropic Agent SDK, or depend on any agent framework. It implements its own agent loop, tool system, and session management from scratch. This gives it:
- Provider-agnostic multi-model support (Anthropic, OpenAI, Google, Mistral, Bedrock)
- Full control over context management and compaction
- Custom message types and event system

### 2. Tree-Based Sessions vs. Linear History

Unlike most coding agents that maintain linear conversation history, pi uses an append-only tree structure in JSONL files. This enables:
- Branching without file duplication (branches are just different paths through the tree)
- Non-destructive navigation (no history is ever deleted)
- Branch summaries that preserve context when switching
- Label-based bookmarking

### 3. Minimal Core + Extension Architecture

The philosophy is "adapt pi to your workflows, not the other way around." The core ships only 4 tools (read, bash, edit, write) and delegates everything else to:
- **Extensions**: TypeScript modules with full lifecycle hooks (session start/shutdown, before/after tool calls, context transformation, custom commands, UI widgets)
- **Skills**: Markdown files following the [Agent Skills standard](https://agentskills.io) -- the LLM reads them on demand
- **Prompt Templates**: Reusable markdown prompts
- **Themes**: JSON theme files with hot-reload

### 4. Custom TUI Library

Rather than using Ink or blessed, pi builds on its own `pi-tui` package with differential rendering. This gives it precise control over terminal rendering performance and enables features like:
- In-place streaming of assistant responses
- Inline diff rendering for edit operations
- Theme hot-reloading
- Image display in supported terminals
- Custom component composition (36 components)

### 5. Compaction with Iterative Summarization

Pi's compaction doesn't just truncate or do a single summary. It:
- Uses the previous compaction summary as input for incremental updates
- Handles split turns (where the cut point falls mid-conversation-turn)
- Tracks file operations across compaction boundaries
- Generates structured summaries (Goal, Progress, Decisions, Next Steps)

### 6. RPC Mode for Embedding

The headless RPC mode over stdin/stdout makes pi embeddable in any editor or tool chain without spawning a TUI. This is a practical design for IDE integration without requiring a language server protocol.

### 7. Defensive Concurrency

The `withFileMutationQueue()` pattern serializes file operations when the LLM issues parallel tool calls, preventing write conflicts. Settings use `proper-lockfile` for cross-process safety.

### 8. Provider-Agnostic Model Cycling

The `--models` flag and Ctrl+P cycling allow switching between models from different providers mid-session. The session records model changes as entries, so resuming always knows which model was last used.

### 9. Configurable via `piConfig` in package.json

The app name and config directory are defined in `package.json`'s `piConfig` field, making it trivial to rebrand (e.g., fork as "tau" with `.tau/` config dir):

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

### 10. Bun Binary Compilation

The build system supports `bun build --compile` for single-binary distribution, with special path resolution logic for Bun's virtual filesystem. This enables zero-dependency distribution alongside the npm package.

---

## Summary

Pi is a thoughtfully engineered, provider-agnostic coding agent CLI built entirely from scratch in TypeScript. Its standout characteristics are the tree-based session model, extension-first architecture, custom TUI library, and structured compaction system. It avoids all external agent frameworks in favor of a clean, layered architecture: `ai` (provider abstraction) -> `agent-core` (stateful loop) -> `coding-agent` (tools, sessions, UI). The RPC mode and package system make it suitable for both interactive terminal use and embedding in other tools.
