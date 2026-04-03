import OpenAI from "openai";

/**
 * Creates an OpenAI-compatible client for the chosen provider.
 * @param {Object} modelConfig - Resolved model config including provider, key, and base URL.
 * @returns {OpenAI} Configured client instance.
 */
export function createClient(modelConfig = {}) {
  const { apiKey, baseURL, provider } = modelConfig;

  if (!apiKey) {
    throw new Error("Missing API key for selected model.");
  }

  const defaultHeaders = provider === "openrouter"
    ? {
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://rootx.local",
        "X-Title": process.env.OPENROUTER_APP_NAME || "RootX CLI",
      }
    : undefined;

  return new OpenAI({ apiKey, baseURL, defaultHeaders });
}
