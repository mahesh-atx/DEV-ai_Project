import fs from "fs";

export function logErrorToFile(err, context = "") {
  try {
    const timestamp = new Date().toISOString();
    const errorMessage = err && err instanceof Error ? err.stack || err.message : String(err);
    const logLine = `[${timestamp}] ${context ? `[${context}] ` : ""}${errorMessage}\n`;
    fs.appendFileSync("rootx-error.log", logLine);
  } catch (e) {
    // silently fail
  }
}
