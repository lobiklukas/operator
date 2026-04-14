# Operator — Feature Roadmap

## Version Overview

| Version | Theme | Key Features |
|---------|-------|-------------|
| **v0.1** | MVP | Single session TUI, streaming, persistence, resume |
| **v0.2** | Session Management | Session list sidebar, rename, archive, delete, search |
| **v0.3** | Snapshots & Undo | Filesystem snapshots per turn, undo/redo |
| **v0.4** | Git Worktrees | Isolated branches per session, worktree lifecycle |
| **v0.5** | Permissions | Interactive tool approval UI, permission rules |
| **v0.6** | Web UI | SolidJS web client, same Hono server backend |
| **v0.7** | Extensibility | Plugin system, custom agents, MCP management |

---

## v0.1 — MVP (Current)

**Goal:** Launch Operator, type a prompt, see Claude Code stream a response.

- [x] Claude Agent SDK integration via `query()`
- [x] Effect-TS service architecture (Session, SDK Adapter, Config, Storage, EventBus)
- [x] Hono HTTP/SSE server
- [x] SQLite persistence (sessions + messages via Drizzle)
- [x] OpenTUI + SolidJS TUI (header, message list, tool calls, input box)
- [x] Session resume (`--resume`, `--continue`)
- [x] Follow-up messages in same session
- [x] Turn interruption (Escape / Ctrl+C)
- [x] Auto-approve all tool calls
- [x] Read Claude Code settings (user/project/local)
- [x] `.operator.json` project config
- [x] CLI: `operator`, `operator -c`, `operator -r <id>`, `operator -m <model>`

---

## v0.2 — Session Management

**Goal:** Browse, manage, and switch between sessions.

### Features

- **Session list sidebar**
  - Toggleable sidebar (keybinding: `Tab` or `Ctrl+L`)
  - Shows all sessions: title, model, date, message count
  - Sorted by last activity
  - Search/filter sessions
  - Session preview on hover

- **Session operations**
  - Rename session (inline edit)
  - Archive session (soft delete, recoverable)
  - Delete session (permanent)
  - Fork session (create branch from any message)

- **Session switching**
  - Click or arrow-key to switch active session
  - New session button
  - Keyboard shortcut for new session (`Ctrl+N`)

- **Auto-title generation**
  - Generate session title from first user message
  - Use Claude to summarize the session purpose

### Technical

- New TUI components: `Sidebar`, `SessionListItem`, `SearchInput`
- Session forking: copy messages up to fork point, new session with `parentID`
- Frecency-based sorting (most recently used + most frequently used)

---

## v0.3 — Snapshots & Undo

**Goal:** Track filesystem changes per turn, enable undo/redo.

### Features

- **Per-turn snapshots**
  - Capture filesystem state before each assistant turn
  - Track which files were created, modified, deleted
  - Store as git objects in a separate snapshot repository (like opencode)

- **Undo/redo**
  - Undo last turn's file changes (`Ctrl+Z` or command)
  - Redo undone changes (`Ctrl+Y` or command)
  - Per-file undo (selective restore)

- **Diff viewer**
  - Show file diffs for each turn
  - Inline diff in message stream
  - Full diff dialog with syntax highlighting
  - Uses OpenTUI's built-in `diff` component

- **Turn timeline**
  - Visual timeline of turns with file change summaries
  - Navigate to any turn's snapshot
  - Compare any two snapshots

### Technical

- `Snapshot.Service` — git-based snapshot tracking
- Separate `.operator/snapshots/` git repository
- Drizzle schema: `snapshots` table (turn_id, message_id, git_ref)
- OpenTUI `diff` renderable for inline diffs

---

## v0.4 — Git Worktrees

**Goal:** Each session can work in an isolated git worktree.

### Features

- **Worktree creation**
  - Option to create a session with its own worktree
  - Auto-generated branch name from session title
  - Worktree directory: `.operator/worktrees/<branch-name>/`

- **Worktree lifecycle**
  - Create worktree when session starts
  - Clean up worktree when session is archived/deleted
  - Detect orphaned worktrees

- **Branch management**
  - View current branch in session header
  - Switch sessions = switch worktrees
  - Create PR from worktree (integrate with `gh`)

- **Workspace abstraction**
  - Pluggable workspace adaptor (like opencode)
  - Default: direct directory (no worktree)
  - Optional: git worktree
  - Future: containers, remote workspaces

### Technical

- `Worktree.Service` — git worktree operations
- `WorkspaceAdaptor` interface for pluggable workspace types
- Session schema: add `workspace_id`, `branch`, `worktree_path`
- Worktree cleanup on session archive/delete

---

## v0.5 — Permissions

**Goal:** Interactive tool approval with configurable rules.

### Features

- **Permission dialog**
  - TUI dialog when a tool needs approval
  - Shows: tool name, parameters, file paths affected
  - Actions: Allow Once, Allow Always, Deny, Deny with feedback

- **Permission rules**
  - Pattern-based rules (glob matching)
  - Default rules per permission category
  - Override in `.operator.json`
  - Session-level overrides

- **Permission modes**
  - `auto-approve` — current v0.1 behavior
  - `approve-edits` — auto-approve reads, ask for writes
  - `supervised` — ask for everything
  - Configurable per session or globally

- **Permission persistence**
  - "Allow Always" decisions saved to SQLite
  - Per-project permission memory
  - Exportable/importable permission rules

### Technical

- `Permission.Service` — rule evaluation, approval flow
- Pattern matching engine (glob-based, like opencode)
- Permission Drizzle schema: `permissions` table
- TUI: `PermissionDialog` component with keyboard navigation
- SDK integration: `canUseTool` callback instead of `bypassPermissions`

---

## v0.6 — Web UI

**Goal:** Access Operator through a browser, same backend.

### Features

- **SolidJS web application**
  - Same component logic as TUI (shared via contracts)
  - Responsive design for desktop browsers
  - Real-time streaming via SSE (same endpoint as TUI)

- **Web-specific features**
  - Syntax-highlighted code blocks
  - Clickable file paths (open in editor)
  - Copy buttons on code blocks
  - Markdown rendering

- **Deployment**
  - `operator --web` opens browser UI
  - Serves from same Hono server
  - Optional: expose on LAN for mobile access

### Technical

- New package: `packages/web/` — SolidJS + Vite web app
- Shared: `packages/contracts/` types used by both TUI and web
- Hono serves static web assets + existing API routes
- Same SSE event stream, different rendering layer

---

## v0.7 — Extensibility

**Goal:** Plugin system, custom agents, MCP server management.

### Features

- **Plugin system**
  - `.operator/plugins/` directory
  - Plugin hooks: before/after tool execution, message transform, custom commands
  - Plugin API for extending TUI (custom panels, dialogs)

- **Custom agents**
  - `.operator/agents/*.md` — markdown agent definitions
  - Custom system prompts per agent
  - Agent picker in TUI
  - Agent-specific tool sets and permissions

- **MCP server management**
  - Configure MCP servers in `.operator.json`
  - TUI dialog for MCP server status
  - Pass MCP tools to Claude Code SDK

- **Custom commands**
  - `.operator/commands/*.md` — slash commands
  - Template variables
  - Command palette in TUI (`Ctrl+P`)

### Technical

- `Plugin.Service` — plugin loading, hook execution
- `Agent.Service` — agent definitions, selection
- `MCP.Service` — MCP client management
- Plugin isolation: each plugin runs in its own Effect scope
- Agent definitions: markdown with YAML frontmatter

---

## Beyond v0.7

Ideas for future consideration (not planned):

- **Multi-project support** — manage multiple directories from one Operator instance
- **Desktop app** — Electron/Tauri wrapper for native experience
- **Team features** — shared sessions, shared agents, shared permissions
- **Session sharing** — export/import sessions, share URLs
- **Cost tracking** — detailed token usage analytics, budget alerts
- **Model comparison** — run same prompt against multiple models
- **Voice input** — microphone input for prompts
- **IDE extensions** — VS Code / JetBrains integration
