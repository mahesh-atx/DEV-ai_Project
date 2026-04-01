# DevAI CLI 🚀

**DevAI** is an elite, autonomous CLI-based AI software engineer. It doesn't just autocomplete code—it natively understands your workspace, plans architectures, spins up parallel background agents, writes files, and acts as its own QA engineer to auto-fix errors.

## 🌟 Core Features

### 1. Kilo Orchestrator Mode
DevAI features an advanced multi-agent orchestration pattern inspired by the latest agentic frameworks. 
When asked to perform a complex, multi-stage objective:
- **Understand**: Spawns an "Explorer" agent to read the codebase.
- **Plan**: Breaks the request down into a strict dependency array.
- **Execute**: Launches isolated, specialized "Coder" agents in parallel waves to tackle non-overlapping files completely simultaneously.
- **Synthesize**: Evaluates the returning code diffs and summarizes the objective.

### 2. Deep Web Research
Instead of relying on outdated training data, DevAI accesses the live internet:
- **`websearch`**: Uses the Exa AI MCP to intelligently crawl for up-to-date documentation and API specifications.
- **`webfetch`**: Pulls raw HTML from URLs and natively parses the DOM into LLM-optimized Markdown (supporting payloads up to 5MB).

### 3. Smart Context Management
Never run out of tokens. DevAI explicitly calculates context windows, compacts old conversation history, and utilizes `list_files` and `search_content` to only parse exactly what it needs instead of blindly uploading your entire repository.

### 4. Interactive Plan Mode (`/plan`)
Not ready to write code? DevAI can act as a Lead Architect. It will natively explore your workspace, generate a `.kilo/plans/` markdown blueprint, and iteratively debate technical decisions with you before handing off the final approved plan to the implementation agents.

### 5. The Self-Debugger (`/build`)
DevAI tests its own work. If you run the `/build` command, DevAI executes your local test script (e.g., `npm run test`). If it crashes, DevAI parses the console traceback, infers missing NPM dependencies if needed, and modifies the source code autonomously until the build passes.

### 6. The Polish Agent (`/polish`)
Done implementing a feature? Launch the autonomous Polish agent to sweep through your workspace. It strictly focuses on improving UI/UX margins, refactoring messy functions, and unifying design tokens without altering core logic.

### 7. Multi-Model Support
DevAI isn't locked to one provider. It natively swaps between configurations for:
- **NVIDIA API** (Powered by top models including **NVIDIA Nemotron-120B**, **Qwen3-Coder-480B**, **Moonshot Kimi-k2.5**, and **GLM-5**)
- DeepSeek
- Groq / Llama 3
- GPT-OSS / Open-Weights models

### 8. Surgical Patching
Instead of overwriting 500-line files to add a single comment, DevAI uses native AST-like Diff patching to explicitly search-and-replace only the specific lines that changed, drastically reducing execution time.

### 9. Git Rollback (Safety Guard) 🛡️
DevAI takes a true `git` snapshot of your code before *every single edit*. It displays exactly what was modified and asks you: "Keep changes? (y/undo)". If you type `undo`, the AI's changes are instantly wiped out and your code is restored.

---

## 🌍 Installation

You can install DevAI globally to use the CLI in any project directory on your machine.

```bash
npm install -g devai-cli-coder
```

*(Note: Requires Node.js v18 or newer).*

---

## ⚡ Quick Start

Open a terminal in **any** project folder and type:

```bash
devai
```

On first launch, DevAI will detect that no API key is configured and walk you through an interactive setup:

```
 ┌─────────────────────────────────────────┐
 │          Welcome to DevAI               │
 │                                         │
 │  No NVIDIA API Key Found                │
 │  Get your free key at: build.nvidia.com │
 │                                         │
 │  Enter your API key: nvapi-...          │
 └─────────────────────────────────────────┘
```

The key is stored at `~/.config/devai/config.json` and loaded automatically on future runs.

### API Key Configuration

DevAI needs an **NVIDIA API key** to connect to AI models. You have two ways to provide it:

| Method | How |
|--------|-----|
| **Interactive setup** (recommended) | Just run `devai` — it prompts you on first launch |
| **`.env` file** | Create a `.env` file in your project root: `NVIDIA_API_KEY=nvapi-your-key-here` |

> Get your free API key at [https://build.nvidia.com](https://build.nvidia.com).

The `.env` key takes priority over the stored config if both exist. You can change or clear the stored key anytime via the **Settings** menu in DevAI.

### In-Session Commands

| Command        | Description                                          |
| -------------- | ---------------------------------------------------- |
| `/plan <desc>` | Enter Planner Mode to research and document an architecture plan |
| `/build`       | Drop into the Self-Debugger. Runs your build/test script and auto-fixes errors |
| `/build <cmd>` | Set a custom build command globally (e.g., `/build npm run typecheck`) |
| `/git <msg>`   | Quick sequence to add, commit, and push your current changes |
| `/polish`      | Triggers the UI/UX auto-polish designer agent        |
| `undo` / `n`   | Revert the very last AI edit instantly               |
| `exit`         | Quit the DevAI session                               |

## License

MIT
