/**
 * Token and Context Budgeting Utilities
 */

/**
 * Safer heuristic: 3.5 chars per token for mixed code/text
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Convert token count back to safe character budget
 */
export function tokensToChars(tokens) {
  return Math.floor(tokens * 3.5);
}

/**
 * Calculate the maximum allowed input tokens based on model limits and requested output
 */
export function estimateMaxInputTokens(model) {
  const BUFFER = 1500; // Safety margin for system prompt and overhead
  const maxOutput = model.maxTokens || 4096;
  return Math.max(1024, model.contextLimit - maxOutput - BUFFER);
}

/**
 * Dynamically adjust maxTokens (output) to fit within the context window
 */
export function getSafeMaxTokens(inputTokens, model) {
  const BUFFER = 1000;
  const avail = model.contextLimit - inputTokens - BUFFER;
  
  return Math.max(
    1024, // Minimum useful output
    Math.min(model.maxTokens || 4096, avail)
  );
}

/**
 * Calculate context usage percentage
 */
export function getUsageStats(inputTokens, contextLimit) {
  const percent = Math.round((inputTokens / contextLimit) * 100);
  return {
    tokens: inputTokens,
    total: contextLimit,
    percent,
    isHigh: percent > 85,
    isCritical: percent > 95
  };
}
