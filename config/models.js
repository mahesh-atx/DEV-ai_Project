/**
 * Central Model Registry
 * All available AI models and their configurations.
 */

import { getApiKey } from '../utils/configManager.js';

const MODELS = {
  // 🧠 Kimi (Long context + reasoning)
  kimi: {
    id: "moonshotai/kimi-k2.5",
    name: "Moonshot Kimi-k2.5",
    description: "High Performance, Multi-modal",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 16384,
    contextLimit: 500000,

    temperature: 1.0,
    topP: 1.0,

    isMultimodal: true,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: { thinking: true }
    },
  },

  // ⚡ Fast coding
  qwen_fast: {
    id: "qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B (Fast)",
    description: "Blazing fast, great for standard coding tasks",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 8192,
    contextLimit: 32768,

    temperature: 0.7,
    topP: 0.8,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "coding",

    extraParams: {},
  },

  // 🐢 Heavy coding beast
  qwen: {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    name: "Qwen3-Coder-480B",
    description: "Best for complex coding & reasoning",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 8192,
    contextLimit: 131072,

    temperature: 0.7,
    topP: 0.8,

    isMultimodal: false,
    supportsThinking: false,

    speed: "slow",
    role: "coding",

    extraParams: {},
  },


  // 🌐 GLM-4
  glm: {
    id: "z-ai/glm4.7",
    name: "GLM-4.7",
    description: "Multi-modal Original",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 16384,
    contextLimit: 131072,

    temperature: 1.0,
    topP: 1.0,

    isMultimodal: true,
    supportsThinking: false,

    speed: "balanced",
    role: "general",

    extraParams: {
      chat_template_kwargs: {
        enable_thinking: false
      }
    },
  },

  // 🧠 GLM-5 (thinking model)
  glm5: {
    id: "z-ai/glm5",
    name: "GLM-5",
    description: "Next-gen Multi-modal with Thinking",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 65536,
    contextLimit: 202752,

    temperature: 1.0,
    topP: 1.0,

    isMultimodal: true,
    supportsThinking: true,

    speed: "slow",
    role: "reasoning",

    extraParams: {
      chat_template_kwargs: {
        enable_thinking: true,
        clear_thinking: false
      }
    },
  },

  // ⚡ Fast general model
  minimax: {
    id: "minimaxai/minimax-m2.5",
    name: "MiniMax M2.5",
    description: "Fast, cost-efficient general-purpose model",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 8192,
    contextLimit: 65536,

    temperature: 1.0,
    topP: 0.95,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "general",

    extraParams: {},
  },

  // 🤖 NVIDIA Nemotron (AGENT MODEL 🔥)
  nemotron: {
    id: "nvidia/nemotron-3-super-120b-a12b",
    name: "Nemotron-120B",
    description: "Best for agents, reasoning, and planning",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 8192,
    contextLimit: 131072,

    temperature: 0.7,
    topP: 0.9,

    isMultimodal: false,
    supportsThinking: true,

    speed: "slow",
    role: "agent",

    extraParams: {
      chat_template_kwargs: {
        enable_thinking: true
      }
    },
  },

  // 🦙 Meta Llama 3.1 (Fast and efficient)
  llama_fast: {
    id: "meta/llama-3.1-70b-instruct",
    name: "Llama 3.1 70B",
    description: "Fast and efficient instruction-following model",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 1024,
    contextLimit: 131072,

    temperature: 0.2,
    topP: 0.7,

    isMultimodal: false,
    supportsThinking: false,

    speed: "fast",
    role: "coding",

    extraParams: {},
  },

  // 🚀 OpenAI GPT OSS (Powerful open-source)
  gpt_oss: {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "Powerful open-source model for complex tasks",
    envKey: "NVIDIA_API_KEY",

    maxTokens: 4096,
    contextLimit: 131072,

    temperature: 1,
    topP: 1,

    isMultimodal: false,
    supportsThinking: false,

    speed: "slow",
    role: "general",

    extraParams: {},
  }
};

/**
 * Returns the model config with the API key resolved from env.
 * @param {string} key - One of 'kimi', 'qwen', 'glm'
 */
export function getModel(key) {
  const model = MODELS[key];
  if (!model) throw new Error(`Unknown model key: ${key}`);

  let apiKey = process.env[model.envKey];
  if (!apiKey) {
    apiKey = getApiKey();
  }
  if (!apiKey) {
    throw new Error(
      `Missing API key: Set ${model.envKey} in your .env file or run 'devai' to configure it.`
    );
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
