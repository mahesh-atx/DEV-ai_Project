# Plan: First-Run API Key Setup

## Goal
When a user installs DevAI via `npm install -g devai-cli-coder` and runs `devai` for the first time without a `.env` file, the tool should detect the missing NVIDIA API key and interactively prompt the user to enter it. The key is stored in a global config file so the user never has to manually create `.env`.

## Approach
Three new/modified files + two small edits. No changes to the existing API integration layer (`config/apiClient.js`) — the key flows through `process.env` as before.

---

## Changes

### 1. Create `utils/configManager.js` (NEW)
Global config store at `~/.config/devai/config.json` (Windows: `%USERPROFILE%\.config\devai\config.json`).

```js
// Functions:
getConfigDir()   → returns the config directory path, creates it if missing
getConfigPath()  → returns full path to config.json
loadConfig()     → reads and parses config.json, returns {} if missing
saveConfig(obj)  → writes config.json
getApiKey()      → returns NVIDIA_API_KEY from config, or null
setApiKey(key)   → saves NVIDIA_API_KEY to config and writes to disk
```

On startup, this module also injects the stored key into `process.env.NVIDIA_API_KEY` if it's not already set (via `.env`). This means the rest of the codebase (`config/models.js`, `config/apiClient.js`) works unchanged.

### 2. Create `tui/components/SetupScreen.jsx` (NEW)
React/Ink component for first-run API key input:
- Shows a welcome message explaining that an NVIDIA API key is required
- Provides a text input field for the key
- Basic validation: must start with `nvapi-` and be >20 chars
- On valid submit: calls `setApiKey(key)`, then `onComplete()` callback
- Shows link: "Get your key at https://build.nvidia.com"

### 3. Modify `tui/app.jsx`
- Import `getApiKey` from `../utils/configManager.js`
- On mount (`useEffect`), check if API key exists
- Add new state: `needsSetup` (boolean)
- If `needsSetup`, render `<SetupScreen onComplete={() => setNeedsSetup(false)} />`
- Otherwise render the existing MainMenu flow
- After setup completes, auto-resolve the model config so the user can proceed immediately

### 4. Modify `config/models.js` — `getModel()` function (line 226-238)
Current behavior: throws if `process.env[model.envKey]` is missing.
New behavior: fall back to `getApiKey()` from configManager before throwing.

```js
import { getApiKey } from '../utils/configManager.js';

export function getModel(key) {
  const model = MODELS[key];
  if (!model) throw new Error(`Unknown model key: ${key}`);

  let apiKey = process.env[model.envKey];
  if (!apiKey) {
    apiKey = getApiKey();  // fallback to stored config
  }
  if (!apiKey) {
    throw new Error(
      `Missing API key: Set ${model.envKey} in your .env file or run 'devai' to configure it.`
    );
  }

  return { ...model, apiKey };
}
```

### 5. Implement `tui/components/SettingsScreen.jsx` (REPLACE stub)
Replace the current "not implemented" placeholder with a functional settings panel:
- Show current API key (masked: `nvapi-****XXXX`)
- Option to change the API key (reuses the same text input pattern from SetupScreen)
- Option to clear the stored key
- Press Esc/Back to return to main menu

### 6. Update `.env.example`
Add a comment clarifying the key can also be set interactively:
```
# Required: Get your API key from https://build.nvidia.com
# You can also set this interactively when you first run `devai`
NVIDIA_API_KEY=your_nvidia_api_key_here
```

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `utils/configManager.js` | CREATE | Global config read/write, env injection |
| `tui/components/SetupScreen.jsx` | CREATE | First-run API key input UI |
| `tui/app.jsx` | MODIFY | Add setup gate before main menu |
| `config/models.js` | MODIFY | Fallback to configManager for API key |
| `tui/components/SettingsScreen.jsx` | REPLACE | Functional settings with key management |
| `.env.example` | MODIFY | Clarify interactive setup option |

## User Flow

```
$ npm install -g devai-cli-coder
$ devai

┌─────────────────────────────────┐
│  Welcome to DevAI               │
│                                 │
│  No NVIDIA API key found.       │
│  Get one at: https://build.nvidia.com │
│                                 │
│  Enter your API key: nvapi-...  │
└─────────────────────────────────┘
  ↓ (key saved to ~/.config/devai/config.json)
┌─────────────────────────────────┐
│  [Main Menu - as before]        │
│  Start Session / Change Mode /  │
│  Change Model / Settings / Exit │
└─────────────────────────────────┘
```

## Verification
1. Delete any existing `.env` file and `~/.config/devai/` directory
2. Run `devai` — should see setup prompt
3. Enter a valid `nvapi-...` key — should proceed to main menu
4. Run `devai` again — should skip setup, go straight to main menu
5. Go to Settings — should show masked key, allow changing it
6. Create a `.env` file with `NVIDIA_API_KEY=...` — `.env` should take priority over stored config
