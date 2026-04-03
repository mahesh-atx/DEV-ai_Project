# RootX CLI

RootX is a terminal-first AI coding assistant for real project work. It can inspect your workspace, plan changes, edit files, run commands with approval, track todos, resume prior sessions, and help you iterate across multiple modes without losing context.

## What RootX Does

RootX combines several workflows inside one TUI:

- Chat and coding inside a persistent project session
- Planning with saved markdown plans in `.kilo/plans/`
- Build-and-fix loops with `/build`
- Multi-mode execution for coding, asking, polishing, planning, and orchestration
- Todo tracking for longer tasks
- Git checkpoint rollback for AI edits
- Session management with resume, rename, delete, and switching

## Core Features

### Persistent Sessions

RootX stores conversations as project-local sessions so different tasks do not get mixed together.

- Sessions are stored in `.rootx/sessions/`
- The last active session is remembered and offered from the main menu
- Each session stores:
  - messages
  - activity log
  - summary data
  - selected mode
  - selected model
  - custom build command
  - last checkpoint reference
- Empty drafts are not saved until the session has meaningful content
- Session titles are generated from the first user message unless you rename them manually

### Multi-Mode Workflow

RootX supports several execution styles:

- `Agent`: general coding mode that can inspect, edit, and run commands
- `Polish`: a refinement pass focused on improving existing work
- `Orchestrator`: multi-agent style execution for broader tasks
- `Planner`: read-first planning mode that writes plans to `.kilo/plans/`
- `Ask Only`: conversation mode without workspace changes

### Build and Self-Debugging

The `/build` flow detects or uses a configured build command, runs it, and helps iterate on failures.

- `/build` uses the saved or auto-detected build/test command
- `/build <command>` sets a custom build command for the current session

### Todo Tracking

For larger work, RootX can maintain a structured todo list.

- Todo state is stored in `.kilo/todos.json`
- Items can be `pending`, `in_progress`, `completed`, or `cancelled`
- Todo updates are rendered directly in the transcript

### Git Safety

RootX keeps a checkpoint of AI workspace changes so you can undo the last AI edit flow.

- `undo` or `n` restores the last saved AI checkpoint when available
- `/git <message>` stages, commits, and pushes current changes

## Installation

Requires Node.js 18 or newer.

Install dependencies:

```bash
npm install
```

Run the app directly from the repo:

```bash
npm run rootx:direct
```

You can also use the entry scripts:

```bash
npm run rootx
npm run rootx:bin
```

If you publish the package, the configured binaries are:

- `rootx`
- `rx`

## First Run

Start RootX in your project directory:

```bash
rootx
```

or, from this repository:

```bash
npm run rootx:direct
```

On first launch, RootX opens setup if no provider key is available.

Stored provider keys live at:

```text
~/.config/rootx/config.json
```

## API Keys and Providers

RootX currently supports:

- NVIDIA Build
- OpenRouter

You can configure keys through:

- the interactive setup screen
- the Settings screen
- a project `.env` file

Supported environment variables:

```text
NVIDIA_API_KEY=...
OPENROUTER_API_KEY=...
```

Provider links:

- NVIDIA Build: [https://build.nvidia.com](https://build.nvidia.com)
- OpenRouter: [https://openrouter.ai/keys](https://openrouter.ai/keys)

If both `.env` and stored config exist for the same provider, the `.env` value wins.

## Main Menu

The main menu includes:

- `Start New Session` or `Resume: "<title>"`
- `Sessions`
- `Change Mode`
- `Change Model`
- `Settings`
- `Exit CLI`

The footer also shows:

- the last active session title when one exists
- navigation help for arrow keys and Enter

## Session Management

The Sessions screen is the main place to manage saved work.

You can:

- open a saved session
- create a new session
- rename a session
- delete a session
- go back to the main menu

Each saved session entry shows:

- title
- mode
- relative updated time
- message count
- last message preview

Behavior notes:

- the active session is marked in the list
- active sessions cannot be deleted from the Sessions screen until you switch away
- RootX autosaves session state as you work
- leaving chat returns you to the main menu without losing saved progress

Session storage files:

```text
.rootx/sessions/index.json
.rootx/sessions/<session-id>.json
```

## Slash Commands

These are the in-chat commands currently supported by the TUI.

| Command | Description |
| --- | --- |
| `/plan <prompt>` | Run Planner mode and generate a plan |
| `/polish <prompt>` | Run Polish mode |
| `/agent <prompt>` | Force Agent mode for a prompt |
| `/ask <prompt>` | Force Ask Only mode for a prompt |
| `/build` | Run the saved or detected build/test command |
| `/build <command>` | Set a custom build command for the current session and use it |
| `/mode` | Open the in-chat mode picker |
| `/mode <name>` | Switch to a mode by label or value |
| `/model` | Open the in-chat model picker |
| `/model <name>` | Switch to a model by key, name, or id |
| `/new` | Start a fresh session |
| `/switch` | Leave chat and open the Sessions screen |
| `/sessions` | Print saved sessions inside the chat transcript |
| `/rename <title>` | Rename the current session |
| `/delete <session-id>` | Delete a non-active saved session after confirmation |
| `/git <message>` | Stage, commit, and push current changes |
| `/clear` | Clear the current visible chat history in memory |
| `/expand` | Toggle the latest collapsible activity block |
| `/collapse` | Toggle the latest collapsible activity block |
| `/toggle` | Toggle the latest collapsible activity block |
| `/exit` | Exit the current chat screen |
| `/quit` | Alias for `/exit` |
| `exit` | Alias for `/exit` |
| `undo` | Restore the last AI checkpoint |
| `n` | Shortcut alias for `undo` when a checkpoint exists |

## Keyboard Shortcuts

The chat UI also supports terminal shortcuts:

- `?`: open or close the shortcuts panel when the input is empty
- `Esc`: stop an active run, close a picker, or close a modal panel
- `Up` / `Down`: scroll transcript
- `PgUp` / `PgDn`: faster transcript scrolling
- `Home` / `End`: jump through transcript history
- `Ctrl+Q`: open question history
- `Ctrl+P` / `Ctrl+N`: cycle through input history

## Session-Aware Behavior

Some behavior is tied directly to the active session:

- model selection is remembered with the session
- mode selection is remembered with the session
- custom build commands are stored per session
- activity logs are stored per session
- summaries and checkpoints are scoped to the current session

This makes it easier to keep unrelated tasks isolated.

## Files RootX Writes

Depending on how you use it, RootX may write to these locations:

```text
.rootx/sessions/
.kilo/plans/
.kilo/todos.json
~/.config/rootx/config.json
```

## Planning Workflow

Planner mode writes markdown plans into:

```text
.kilo/plans/
```

Typical flow:

1. Run `/plan <task>`
2. Review the generated plan
3. Choose whether to implement, revise, or start fresh from the plan

## Todo Tracking Details

Todo tracking is designed for longer tasks and investigations.

RootX typically uses todos for:

- multi-step implementation
- project audits
- longer refactors
- tasks with several requirements

Expected UI behavior:

- pending items show as open checklist items
- in-progress items are highlighted
- completed items are rendered as completed in the transcript

## Settings

The Settings screen lets you:

- change the stored NVIDIA Build API key
- clear the stored NVIDIA Build API key
- change the stored OpenRouter API key
- clear the stored OpenRouter API key

## Repository Scripts

Useful scripts from `package.json`:

```bash
npm run rootx
npm run rootx:bin
npm run rootx:direct
```

## Typical Usage Examples

Start a new coding session:

```text
Build a login page with validation and API integration.
```

Generate a plan first:

```text
/plan Add per-session chat persistence to the TUI.
```

Run in ask-only mode:

```text
/ask Explain how the current command approval flow works.
```

Set and run a custom build:

```text
/build npm run test
```

Rename the current session:

```text
/rename Fix auth redirect bug
```

## License

MIT
