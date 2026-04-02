/**
 * Central Model Registry
 * All available AI models and their configurations.
 */

const MODELS = {
  kimi: {
    id: "moonshotai/kimi-k2.5",
    name: "Moonshot Kimi-k2.5",
    description: "Long context + agents, multi-modal",
    envKey: "NVIDIA_API_KEY",

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
  },

  qwen_coder: {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    name: "Qwen3 Coder 480B",
    description: "Best coding model, low temp for stable code",
    envKey: "NVIDIA_API_KEY",

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
  },

  qwen_fast: {
    id: "qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B (Fast)",
    description: "Blazing fast, great for standard coding tasks",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 16384,
    contextLimit: 32768,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "coding",

    extraParams: {},
  },

  qwen35_397b: {
    id: "qwen/qwen3.5-397b-a17b",
    name: "Qwen3.5 397B",
    description: "Next-gen VLM, advanced vision and agentic",
    envKey: "NVIDIA_API_KEY",

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
  },

  qwen35_122b: {
    id: "qwen/qwen3.5-122b-a10b",
    name: "Qwen3.5 122B",
    description: "Best practical model, fast and capable",
    envKey: "NVIDIA_API_KEY",

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
  },

  devstral: {
    id: "mistralai/devstral-2-123b-instruct-2512",
    name: "Devstral 123B",
    description: "Pure coding, low temp to prevent hallucination",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 32768,
    contextLimit: 131072,

    temperature: 0.2,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "slow",
    role: "coding",

    extraParams: {},
  },

  deepseek_v32: {
    id: "deepseek-ai/deepseek-v3.2",
    name: "DeepSeek V3.2",
    description: "Reasoning + code hybrid, DSA attention",
    envKey: "NVIDIA_API_KEY",

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
  },

  glm: {
    id: "z-ai/glm4.7",
    name: "GLM-4.7",
    description: "Agentic coding partner, tool use and UI skills",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 16384,
    contextLimit: 131072,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: true,
    supportsThinking: false,

    speed: "balanced",
    role: "coding",

    extraParams: {},
  },

  glm5: {
    id: "z-ai/glm-5",
    name: "GLM-5",
    description: "Heavy reasoning MoE, complex systems engineering",
    envKey: "NVIDIA_API_KEY",

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
  },

  minimax_m25: {
    id: "minimaxai/minimax-m2.5",
    name: "MiniMax M2.5",
    description: "230B model, coding + reasoning + office tasks",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 32768,
    contextLimit: 200000,

    temperature: 0.7,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: false,

    speed: "balanced",
    role: "reasoning",

    extraParams: {},
  },

  nemotron: {
    id: "nvidia/nemotron-3-super-120b-a12b",
    name: "Nemotron 3 Super 120B",
    description: "1M context agentic reasoning, coding, planning",
    envKey: "NVIDIA_API_KEY",

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
  },

  mistral_small4: {
    id: "mistralai/mistral-small-4-119b-2603",
    name: "Mistral Small 4 119B",
    description: "Hybrid MoE, instruct + reasoning + coding + multimodal",
    envKey: "NVIDIA_API_KEY",

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
  },

  step35_flash: {
    id: "stepfun-ai/step-3.5-flash",
    name: "Step-3.5-Flash 200B",
    description: "Sparse MoE reasoning engine, frontier agentic AI",
    envKey: "NVIDIA_API_KEY",

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
  },

  gpt_oss: {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "OpenAI open-weights, full 128K window generation",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 32768,
    contextLimit: 131072,

    temperature: 0.4,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "slow",
    role: "general",

    extraParams: {},
  },

  llama_fast: {
    id: "meta/llama-3.1-70b-instruct",
    name: "Llama 3.1 70B",
    description: "Fast and efficient instruction-following model",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 16384,
    contextLimit: 131072,

    temperature: 0.5,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "coding",

    extraParams: {},
  },
};

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
    supportsThinking: !!m.supportsThinking,
  }));
}

export default MODELS;
