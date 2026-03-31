/**
 * Prompt Selector — Scoring-Based Routing Engine
 * Intelligently selects the appropriate system prompt using weighted scoring
 * v2.0 — Upgraded from basic keyword matching to priority scoring
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const basePrompt = fs.readFileSync(path.join(__dirname, 'base.txt'), 'utf8');
const websitePrompt = fs.readFileSync(path.join(__dirname, 'website.txt'), 'utf8');
const webappPrompt = fs.readFileSync(path.join(__dirname, 'webapp.txt'), 'utf8');
const scriptPrompt = fs.readFileSync(path.join(__dirname, 'script.txt'), 'utf8');

/**
 * Weighted keyword definitions for each mode
 * Higher weight = stronger signal for that mode
 */
const WEBSITE_KEYWORDS = {
  // High confidence triggers (weight: 3)
  'landing page': 3, 'portfolio': 3, 'static site': 3, 'html page': 3,
  'marketing site': 3, 'promotional page': 3,
  // Medium confidence triggers (weight: 2)
  'website': 2, 'simple page': 2, 'single page': 2, 'web page': 2,
  'homepage': 2, 'brochure': 2,
  // Low confidence (weight: 1) — could overlap with webapp
  'responsive': 1, 'ui design': 1
};

const WEBAPP_KEYWORDS = {
  // High confidence triggers (weight: 3)
  'dashboard': 3, 'saas': 3, 'full stack': 3, 'fullstack': 3,
  'admin panel': 3, 'web app': 3, 'e-commerce': 3, 'crud': 3,
  // Medium confidence triggers (weight: 2)
  'authentication': 2, 'database': 2, 'backend': 2, 'login': 2,
  'signup': 2, 'user management': 2, 'real-time': 2, 'chat app': 2,
  'social': 2, 'api': 2, 'frontend': 2,
  // Low confidence (weight: 1)
  'deploy': 1, 'production': 1, 'scale': 1
};

const SCRIPT_KEYWORDS = {
  // High confidence triggers (weight: 3)
  'script': 3, 'automate': 3, 'cli tool': 3, 'command line': 3,
  'batch process': 3, 'automation': 3,
  // Medium confidence triggers (weight: 2)
  'process files': 2, 'generate data': 2, 'scrape': 2,
  'fetch data': 2, 'node script': 2, 'cron': 2,
  // Low confidence (weight: 1)
  'parse': 1, 'convert': 1, 'utility': 1, 'helper': 1
};

/**
 * Calculate weighted score for a set of keywords against user input
 * @param {string} input - Lowercased user input
 * @param {Object} keywordMap - { keyword: weight } map
 * @returns {number} Total weighted score
 */
function calculateScore(input, keywordMap) {
  let score = 0;
  for (const [keyword, weight] of Object.entries(keywordMap)) {
    if (input.includes(keyword)) {
      score += weight;
    }
  }
  return score;
}

/**
 * Analyzes user input and selects the most appropriate prompt using scoring
 * @param {string} userInput - The user's request
 * @param {string} projectType - Detected project type (e.g., "React App", "Empty / Unknown")
 * @returns {string} The selected system prompt
 */
export function selectPrompt(userInput, projectType = "Unknown") {
  const input = userInput.toLowerCase();
  
  // ==================== SCORE CALCULATION ====================
  const scores = {
    website: calculateScore(input, WEBSITE_KEYWORDS),
    webapp: calculateScore(input, WEBAPP_KEYWORDS),
    script: calculateScore(input, SCRIPT_KEYWORDS)
  };
  
  // ==================== PROJECT TYPE BOOST ====================
  // Existing project context adds +2 to matching mode
  if (projectType.includes("React") || projectType.includes("Express") || projectType.includes("Node")) {
    scores.webapp += 2;
  }
  if (projectType.includes("Static Web")) {
    scores.website += 2;
  }
  if (projectType.includes("Python")) {
    scores.script += 2;
  }

  // ==================== FIND WINNER ====================
  const maxScore = Math.max(scores.website, scores.webapp, scores.script);
  
  // If no keywords matched and no project context, use fallback
  if (maxScore === 0) {
    console.log("🤔 Mode: Default (analyzing request...)");
    return basePrompt + `

==================== AUTO-DETECT MODE ====================
The request didn't match a specific category. Analyze carefully and choose the best approach:
- WEBSITE: If it's a simple landing/portfolio/static site → single HTML file, zero config
- WEBAPP: If it needs backend, database, authentication, or complex features → full stack
- SCRIPT: If it's automation, CLI tool, or data processing → focused script

Pick the appropriate approach based on your judgment of the request complexity.
`;
  }

  // ==================== AMBIGUITY CHECK ====================
  // If top two scores are within 1 point, warn about ambiguity
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [firstMode, firstScore] = sortedScores[0];
  const [secondMode, secondScore] = sortedScores[1];
  
  if (firstScore > 0 && secondScore > 0 && (firstScore - secondScore) <= 1) {
    console.log(`⚠️  Ambiguous input: ${firstMode}(${firstScore}) vs ${secondMode}(${secondScore}) — choosing ${firstMode}`);
  }

  // ==================== SELECT PROMPT ====================
  const promptMap = {
    website: { prompt: websitePrompt, label: "🎨 Mode: Website", detail: `(score: ${scores.website})` },
    webapp:  { prompt: webappPrompt,  label: "⚡ Mode: Web Application", detail: `(score: ${scores.webapp})` },
    script:  { prompt: scriptPrompt,  label: "🔧 Mode: Script", detail: `(score: ${scores.script})` }
  };
  
  const selected = promptMap[firstMode];
  console.log(`${selected.label} ${selected.detail}`);
  return basePrompt + selected.prompt;
}

/**
 * Exports all prompts for direct use if needed
 */
export {
  basePrompt,
  websitePrompt,
  webappPrompt,
  scriptPrompt
};

export default selectPrompt;
