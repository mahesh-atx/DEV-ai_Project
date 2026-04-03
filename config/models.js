/**
 * Central Model Registry
 * All available AI models and their configurations.
 */

export const PROVIDERS = {
  nvidia: {
    key: "nvidia",
    name: "NVIDIA Build",
    envKey: "NVIDIA_API_KEY",
    baseURL: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
    keyUrl: "https://build.nvidia.com",
    placeholder: "nvapi-xxxxxxxxxxxxxxxxxxxx",
  },
  openrouter: {
    key: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-xxxxxxxxxxxxxxxxxxxx",
  },
};

function withProvider(providerKey, config) {
  const provider = PROVIDERS[providerKey];
  return {
    ...config,
    provider: provider.key,
    providerName: provider.name,
    envKey: provider.envKey,
    baseURL: provider.baseURL,
  };
}

const MODELS = {
  kimi: withProvider("nvidia", {
    id: "moonshotai/kimi-k2.5",
    name: "Moonshot Kimi-k2.5",
    description: "Long context + agents, multi-modal",

    maxTokens: 32768,
    contextLimit: 500000,

    temperature: 0.6,
    topP: 0.95,

    isMultimodal: true,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { thinking: true },
    },
  }),

  qwen_coder: withProvider("nvidia", {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    name: "Qwen3 Coder 480B",
    description: "Best coding model, low temp for stable code",

    maxTokens: 32768,
    contextLimit: 262144,

    temperature: 0.2,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "slow",
    role: "coding",

    extraParams: {
      chat_template_kwargs: { enable_thinking: true },
    },
  }),

  qwen_fast: withProvider("nvidia", {
    id: "qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B (Fast)",
    description: "Blazing fast, great for standard coding tasks",

    maxTokens: 16384,
    contextLimit: 32768,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "coding",

    extraParams: {},
  }),

  qwen35_397b: withProvider("nvidia", {
    id: "qwen/qwen3.5-397b-a17b",
    name: "Qwen3.5 397B",
    description: "Next-gen VLM, advanced vision and agentic",

    maxTokens: 16384,
    contextLimit: 262144,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: true,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { enable_thinking: true },
    },
  }),

  qwen35_122b: withProvider("nvidia", {
    id: "qwen/qwen3.5-122b-a10b",
    name: "Qwen3.5 122B",
    description: "Best practical model, fast and capable",

    maxTokens: 16384,
    contextLimit: 262144,

    temperature: 0.4,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: true,

    speed: "balanced",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { enable_thinking: true },
    },
  }),

  devstral: withProvider("nvidia", {
    id: "mistralai/devstral-2-123b-instruct-2512",
    name: "Devstral 123B",
    description: "Pure coding, low temp to prevent hallucination",

    maxTokens: 32768,
    contextLimit: 131072,

    temperature: 0.2,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "slow",
    role: "coding",

    extraParams: {},
  }),

  deepseek_v32: withProvider("nvidia", {
    id: "deepseek-ai/deepseek-v3.2",
    name: "DeepSeek V3.2",
    description: "Reasoning + code hybrid, DSA attention",

    maxTokens: 32768,
    contextLimit: 163840,

    temperature: 0.6,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { thinking: true },
    },
  }),

  glm: withProvider("nvidia", {
    id: "z-ai/glm4.7",
    name: "GLM-4.7",
    description: "Agentic coding partner, tool use and UI skills",

    maxTokens: 16384,
    contextLimit: 131072,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: true,
    supportsThinking: false,

    speed: "balanced",
    role: "coding",

    extraParams: {},
  }),

  glm5: withProvider("nvidia", {
    id: "z-ai/glm-5",
    name: "GLM-5",
    description: "Heavy reasoning MoE, complex systems engineering",

    maxTokens: 32768,
    contextLimit: 204800,

    temperature: 0.7,
    topP: 0.9,

    isMultimodal: true,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: {
        enable_thinking: true,
        clear_thinking: false,
      },
    },
  }),

  minimax_m25: withProvider("nvidia", {
    id: "minimaxai/minimax-m2.5",
    name: "MiniMax M2.5",
    description: "230B model, coding + reasoning + office tasks",

    maxTokens: 32768,
    contextLimit: 200000,

    temperature: 0.7,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: false,

    speed: "balanced",
    role: "reasoning",

    extraParams: {},
  }),

  nemotron: withProvider("nvidia", {
    id: "nvidia/nemotron-3-super-120b-a12b",
    name: "Nemotron 3 Super 120B",
    description: "1M context agentic reasoning, coding, planning",

    maxTokens: 32768,
    contextLimit: 1048576,

    temperature: 1.0,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "slow",
    role: "agent",

    extraParams: {
      chat_template_kwargs: { enable_thinking: true },
    },
  }),

  mistral_small4: withProvider("nvidia", {
    id: "mistralai/mistral-small-4-119b-2603",
    name: "Mistral Small 4 119B",
    description: "Hybrid MoE, instruct + reasoning + coding + multimodal",

    maxTokens: 32768,
    contextLimit: 262144,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: true,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { enable_thinking: true },
    },
  }),

  step35_flash: withProvider("nvidia", {
    id: "stepfun-ai/step-3.5-flash",
    name: "Step-3.5-Flash 200B",
    description: "Sparse MoE reasoning engine, frontier agentic AI",

    maxTokens: 32768,
    contextLimit: 200000,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { enable_thinking: true },
    },
  }),

  gpt_oss: withProvider("nvidia", {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "OpenAI open-weights, full 128K window generation",

    maxTokens: 32768,
    contextLimit: 131072,

    temperature: 0.4,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "slow",
    role: "general",

    extraParams: {},
  }),

  llama_fast: withProvider("nvidia", {
    id: "meta/llama-3.1-70b-instruct",
    name: "Llama 3.1 70B",
    description: "Fast and efficient instruction-following model",

    maxTokens: 16384,
    contextLimit: 131072,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "coding",

    extraParams: {},
  }),

  qwen36_plus_free: withProvider("openrouter", {
    id: "qwen/qwen3.6-plus:free",
    name: "Qwen 3.6 Plus Free",
    description: "Free OpenRouter reasoning model with 60K output budget",

    maxTokens: 60000,
    contextLimit: 262144,

    temperature: 0.4,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "balanced",
    role: "reasoning",

    extraParams: {},
  }),

  trinity_large_preview_free: withProvider("openrouter", {
    id: "arcee-ai/trinity-large-preview:free",
    name: "Trinity Large Preview Free",
    description: "Free OpenRouter agentic model with 120K output budget",

    maxTokens: 120000,
    contextLimit: 262144,

    temperature: 0.5,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "balanced",
    role: "agent",

    extraParams: {},
  }),

  glm45_air_free: withProvider("openrouter", {
    id: "z-ai/glm-4.5-air:free",
    name: "GLM 4.5 Air Free",
    description: "Free OpenRouter model for fast reasoning and coding with 90K output budget",

    maxTokens: 90000,
    contextLimit: 262144,

    temperature: 0.4,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "fast",
    role: "coding",

    extraParams: {},
  }),

  nemotron_nano_free: withProvider("openrouter", {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    name: "Nemotron 3 Nano 30B Free",
    description: "Free OpenRouter NVIDIA model with 200K output budget",

    maxTokens: 200000,
    contextLimit: 262144,

    temperature: 0.5,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "fast",
    role: "agent",

    extraParams: {},
  }),

  dolphin_mistral_venice_free: withProvider("openrouter", {
    id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    name: "Dolphin Mistral Venice Free",
    description: "Free OpenRouter instruct model with 30K output budget",

    maxTokens: 30000,
    contextLimit: 131072,

    temperature: 0.6,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "general",

    extraParams: {},
  }),

  hunter_alpha: withProvider("openrouter", {
    id: "openrouter/hunter-alpha",
    name: "Hunter Alpha",
    description: "1T-parameter frontier agentic model with 1M-token context",

    maxTokens: 32768,
    contextLimit: 1048576,

    temperature: 0.4,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: true,

    speed: "balanced",
    role: "agent",

    extraParams: {},
  }),
};

export function getProvider(providerKey) {
  return PROVIDERS[providerKey] || null;
}

export function getProviderForModel(key) {
  const model = MODELS[key];
  return model ? getProvider(model.provider) : null;
}

export function validateApiKey(providerKey, key) {
  const trimmed = (key || "").trim();
  const provider = getProvider(providerKey);

  if (!provider) return "Unknown provider.";
  if (!trimmed) return "API key cannot be empty.";

  if (provider.key === "nvidia" && !trimmed.startsWith("nvapi-")) {
    return `Key must start with "nvapi-". Check ${provider.keyUrl}`;
  }

  if (trimmed.length < 20) {
    return "Key seems too short. Please check and try again.";
  }

  return "";
}

/**
 * Returns the model config with the API key resolved from env.
 * @param {string} key - Model key from the MODELS registry
 */
export function getModel(key) {
  const model = MODELS[key];
  if (!model) throw new Error(`Unknown model key: ${key}`);

  const apiKey = process.env[model.envKey];
  if (!apiKey) {
    throw new Error(`Missing API key: Set ${model.envKey} in your .env file`);
  }

  return { ...model, apiKey };
}

/** Returns all model keys for listing. */
export function listModels() {
  return Object.entries(MODELS).map(([key, m]) => ({
    key,
    id: m.id,
    name: m.name,
    description: m.description,
    provider: m.provider,
    providerName: m.providerName,
    envKey: m.envKey,
    configured: !!process.env[m.envKey],
    supportsThinking: !!m.supportsThinking,
    isMultimodal: !!m.isMultimodal,
    role: m.role,
    speed: m.speed,
    maxTokens: m.maxTokens,
    contextLimit: m.contextLimit,
  }));
}

export default MODELS;
