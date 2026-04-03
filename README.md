# RootX CLI 🚀

**RootX** is an elite, autonomous CLI-based AI software engineer. It doesn't just autocomplete code—it natively understands your workspace, plans architectures, spins up parallel background agents, writes files, and acts as its own QA engineer to auto-fix errors.

## 🌟 Core Features

### 1. Kilo Orchestrator Mode
RootX features an advanced multi-agent orchestration pattern inspired by the latest agentic frameworks. 
When asked to perform a complex, multi-stage objective:
- **Understand**: Spawns an "Explorer" agent to read the codebase.
- **Plan**: Breaks the request down into a strict dependency array.
- **Execute**: Launches isolated, specialized "Coder" agents in parallel waves to tackle non-overlapping files completely simultaneously.
- **Synthesize**: Evaluates the returning code diffs and summarizes the objective.

### 2. Deep Web Research
Instead of relying on outdated training data, RootX accesses the live internet:
- **`websearch`**: Uses the Exa AI MCP to intelligently crawl for up-to-date documentation and API specifications.
- **`webfetch`**: Pulls raw HTML from URLs and natively parses the DOM into LLM-optimized Markdown (supporting payloads up to 5MB).

### 3. Smart Context Management
Never run out of tokens. RootX explicitly calculates context windows, compacts old conversation history, and utilizes `list_files` and `search_content` to only parse exactly what it needs instead of blindly uploading your entire repository.

### 4. Interactive Plan Mode (`/plan`)
Not ready to write code? RootX can act as a Lead Architect. It will natively explore your workspace, generate a `.kilo/plans/` markdown blueprint, and iteratively debate technical decisions with you before handing off the final approved plan to the implementation agents.

### 5. The Self-Debugger (`/build`)
RootX tests its own work. If you run the `/build` command, RootX executes your local test script (e.g., `npm run test`). If it crashes, RootX parses the console traceback, infers missing NPM dependencies if needed, and modifies the source code autonomously until the build passes.

### 6. The Polish Agent (`/polish`)
Done implementing a feature? Launch the autonomous Polish agent to sweep through your workspace. It strictly focuses on improving UI/UX margins, refactoring messy functions, and unifying design tokens without altering core logic.

### 7. Multi-Model Support
RootX isn't locked to one provider. It natively swaps between configurations for:
- **NVIDIA Build / NIM** (Powered by models like **NVIDIA Nemotron-120B**, **Qwen3-Coder-480B**, **Moonshot Kimi-k2.5**, and **GLM-5**)
- **OpenRouter** (Including **Qwen 3.6 Plus Free**, **Trinity Large Preview Free**, **GLM 4.5 Air Free**, **Nemotron 3 Nano 30B Free**, **Dolphin Mistral Venice Free**, and **Hunter Alpha**)
- Open-weights and vendor-hosted models through an OpenAI-compatible client

### 8. Surgical Patching
Instead of overwriting 500-line files to add a single comment, RootX uses native AST-like Diff patching to explicitly search-and-replace only the specific lines that changed, drastically reducing execution time.

### 9. Git Rollback (Safety Guard) 🛡️
RootX takes a true `git` snapshot of your code before *every single edit*. It displays exactly what was modified and asks you: "Keep changes? (y/undo)". If you type `undo`, the AI's changes are instantly wiped out and your code is restored.

### 10. Built-In Todo Tracking
RootX can maintain a structured todo list for complex work and render it directly in the terminal transcript.
- `todowrite` updates the full todo list in one replace-all operation
- `todoread` loads the current session todo state
- Todos are persisted in `.kilo/todos.json`
- Only the main agent owns the shared todo list; delegated subagents do not update it directly
- Todo updates render as checklist-style transcript blocks with pending, in-progress, and completed states

---

## 🌍 Installation

You can install RootX globally to use the CLI in any project directory on your machine.

```bash
npm install -g rootx-cli
```

*(Note: Requires Node.js v18 or newer).*

---

## ⚡ Quick Start

Open a terminal in **any** project folder and type:

```bash
rootx
```

On first launch, RootX will detect that no API key is configured and walk you through an interactive setup:

```
 ┌─────────────────────────────────────────┐
 │          Welcome to RootX               │
 │                                         │
 │  No NVIDIA API Key Found                │
 │  Get your free key at: build.nvidia.com │
 │                                         │
 │  Enter your API key: nvapi-...          │
 └─────────────────────────────────────────┘
```

Stored provider keys live at `~/.config/rootx/config.json` and are loaded automatically on future runs.

### API Key Configuration

RootX can use both **NVIDIA Build** and **OpenRouter** keys. You can provide either or both:

| Method | How |
|--------|-----|
| **Interactive setup** (recommended) | Just run `rootx` — it prompts you on first launch |
| **`.env` file** | Create a `.env` file in your project root: `NVIDIA_API_KEY=nvapi-your-key-here` |

> Get your free API key at [https://build.nvidia.com](https://build.nvidia.com).

The `.env` key takes priority over the stored config if both exist. You can change or clear the stored key anytime via the **Settings** menu in RootX.

You can also add an OpenRouter key with `OPENROUTER_API_KEY=...` in `.env` or through the Settings screen. Provider links:
- NVIDIA Build: [https://build.nvidia.com](https://build.nvidia.com)
- OpenRouter: [https://openrouter.ai/keys](https://openrouter.ai/keys)

If both stored config and `.env` exist for the same provider, the `.env` value wins.

### In-Session Commands

| Command        | Description                                          |
| -------------- | ---------------------------------------------------- |
| `/plan <desc>` | Enter Planner Mode to research and document an architecture plan |
| `/build`       | Drop into the Self-Debugger. Runs your build/test script and auto-fixes errors |
| `/build <cmd>` | Set a custom build command globally (e.g., `/build npm run typecheck`) |
| `/git <msg>`   | Quick sequence to add, commit, and push your current changes |
| `/polish`      | Triggers the UI/UX auto-polish designer agent        |
| `undo` / `n`   | Revert the very last AI edit instantly               |
| `exit`         | Quit the RootX session                               |

## Todo Tracking

RootX uses todos when the task is complex enough to benefit from visible progress tracking. In practice, this usually means:
- multi-step implementation work
- codebase audits or investigations
- tasks with several user requirements
- work that will span multiple edits, validations, or follow-ups

The todo state is stored at `.kilo/todos.json`. The update model is intentionally simple:
- the agent sends the entire todo list on each `todowrite`
- the store replaces the previous list atomically
- the transcript UI renders the latest list as an `Update Todos` block

Todo states:
- `pending`
- `in_progress`
- `completed`
- `cancelled`

UI behavior:
- pending items render as open checkboxes
- in-progress items are highlighted in the transcript
- completed items render in green with strike-through styling when supported by the terminal

## Testing Todo UI

Start the app:

```bash
npm run rootx:direct
```

Then use a prompt that should trigger multi-step tracking, for example:

```text
Analyze this codebase for security issues and track the work with a todo list.
```

What you should see:
- an `Update Todos` activity block in the transcript
- multiple checklist items rendered below it
- one active item highlighted as the current task
- completed items turning green as work progresses
- no raw todo JSON printed in the chat transcript

You can also inspect the persisted state directly:

```text
.kilo/todos.json
```

Good test prompts:
- `Build a login page with validation, API integration, and error handling.`
- `Analyze the project for security issues and track progress with todos.`
- `Refactor the auth flow across the app and keep a todo list updated.`

## License

MIT
