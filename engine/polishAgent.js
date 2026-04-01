/**
 * Polish Agent - Combined Refactor + UI Improvement Agent
 * Analyzes existing code and suggests quality + UI enhancements
 * Uses the same model as the Builder agent (single-model approach)
 */

const POLISH_PROMPT = `
You are the Polish Agent - a code quality and UI specialist.

YOUR JOB:
Analyze the provided code and return improvements. You must:

1. CODE QUALITY:
   - Remove code duplication
   - Improve readability and naming
   - Optimize performance (remove unnecessary re-renders, heavy loops)
   - Add missing error handling
   - Simplify overly complex logic

2. UI/UX IMPROVEMENTS (if HTML/CSS/JSX present):
   - Improve responsive design
   - Add missing accessibility (aria, alt, focus states)
   - Enhance spacing, typography, visual hierarchy
   - Add smooth transitions/animations where appropriate
   - Improve color contrast and consistency

3. RULES:
   - Keep ALL existing functionality - do NOT break anything
   - Use surgical edits (search/replace) when possible
   - Only create new files if genuinely needed
   - Be conservative - improve, don't rewrite

RETURN VALID JSON ONLY (no markdown, no explanation):
{
  "plan": ["Improvement 1", "Improvement 2"],
  "files": [
    {
      "path": "relative/path/to/file",
      "action": "edit",
      "edits": [
        { "search": "exact old code", "replace": "improved code" }
      ]
    }
  ]
}
`;

function emitReporter(reporter, method, payload) {
  if (reporter && typeof reporter[method] === 'function') {
    reporter[method](payload);
  }
}

function logLine(runtime, level, message) {
  const reporter = runtime?.reporter || null;
  emitReporter(reporter, 'log', { level, message });
  if (!runtime?.silent) {
    console.log(message);
  }
}

/**
 * Run the Polish Agent on current codebase
 * @param {string} context - Smart context with file contents
 * @param {Object} runtime - { callAI, parseJSON, reporter?, silent? }
 * @returns {Object|null} Parsed JSON result with file edits, or null on failure
 */
export async function runPolishAgent(context, runtime) {
  logLine(runtime, 'info', 'Polish Agent: analyzing code for improvements...');

  const fullPrompt = `${POLISH_PROMPT}\n\nCODE TO IMPROVE:\n${context}`;

  try {
    const reply = await runtime.callAI(fullPrompt);

    if (!reply || !reply.trim()) {
      logLine(runtime, 'warning', 'Polish Agent returned empty response.');
      return null;
    }

    const parsed = runtime.parseJSON(reply);

    if (!parsed) {
      logLine(runtime, 'warning', 'Polish Agent response could not be parsed.');
      return null;
    }

    if (parsed.plan) {
      logLine(runtime, 'success', `Polish improvements planned: ${parsed.plan.length}`);
    }

    return parsed;
  } catch (error) {
    logLine(runtime, 'error', `Polish Agent error: ${error.message}`);
    return null;
  }
}

export default runPolishAgent;
