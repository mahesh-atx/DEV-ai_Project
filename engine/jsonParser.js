/**
 * engine/jsonParser.js — JSON parsing, cleaning, and repair utilities
 */

import { parse as partialParse } from "partial-json";
import { estimateTokens, getSafeMaxTokens } from "../utils/budgeting.js";

function estimateMessageTokens(messages = []) {
  return messages.reduce((total, message) => {
    const content = typeof message?.content === "string"
      ? message.content
      : message?.content != null
        ? JSON.stringify(message.content)
        : "";
    return total + estimateTokens(content || "");
  }, 0);
}

export function cleanText(text) {
  return text
    .replace(/\u201C/g, '"')    // left curly quote → straight
    .replace(/\u201D/g, '"')    // right curly quote → straight
    .replace(/\u2018/g, "'")    // left single curly → straight
    .replace(/\u2019/g, "'")    // right single curly → straight
    .replace(/\u00A0/g, " ")    // non-breaking space → space
    .replace(/,\s*}/g, "}")     // trailing comma before }
    .replace(/,\s*]/g, "]");    // trailing comma before ]
}

export function extractFilesRegex(text) {
    const files = [];
    const pathRegex = /"path"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = pathRegex.exec(text)) !== null) {
         const filePath = match[1];
         const contentStartSearch = text.indexOf('"content"', match.index);
         if (contentStartSearch === -1) continue;
         
         const contentValueStart = text.indexOf('"', contentStartSearch + 9) + 1;
         let content = "";
         let p = contentValueStart;
         while (p < text.length) {
             if (text[p] === '\\') {
                 if (p + 1 < text.length) {
                    content += text[p] + text[p+1];
                    p += 2;
                    continue;
                 }
             }
             if (text[p] === '"') {
                 break;
             }
             content += text[p];
             p++;
         }
         
         try {
            const unescaped = JSON.parse(`"${content}"`);
            files.push({ path: filePath, action: "create", content: unescaped });
         } catch(e) {
            // failed to parse content, maybe truncated
         }
    }
    return files.length > 0 ? { files } : null;
}

export function parseJSON(text) {
  if (!text || typeof text !== "string") return null;

  // Attempt 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Attempt 1b: partial parse (handles cut-off LLM streams)
  try { return partialParse(text); } catch {}

  // Attempt 2: extract JSON from markdown fences
  try {
    let matchText = text;
    if (text.includes("```json") && !text.includes("```", text.indexOf("```json") + 7)) {
       matchText += "\n```"; // forcibly close it
    }
    const fenceMatch = matchText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      const extracted = cleanText(fenceMatch[1].trim());
      try { return JSON.parse(extracted); } catch {}
      return partialParse(extracted);
    }
  } catch {}

  // Attempt 3: clean + parse whole text
  try {
    const cleaned = cleanText(text);
    return JSON.parse(cleaned);
  } catch {}

  // Attempt 3b: clean + partial parse
  try {
    const cleaned = cleanText(text);
    return partialParse(cleaned);
  } catch {}

  // Attempt 4: Find first { and last }
  try {
    const firstOpen = text.indexOf("{");
    let lastClose = text.lastIndexOf("}");
    if (firstOpen !== -1) {
      if (lastClose !== -1 && lastClose > firstOpen) {
        try { return JSON.parse(cleanText(text.slice(firstOpen, lastClose + 1))); } catch {}
        return partialParse(cleanText(text.slice(firstOpen, lastClose + 1)));
      } else {
        return partialParse(cleanText(text.slice(firstOpen)));
      }
    }
  } catch {}

  // Attempt 5: Recover from Truncation (Regex Extraction)
  try {
      const recovered = extractFilesRegex(text);
      if (recovered && recovered.files.length > 0) {
          console.log(`\n⚠️  JSON parse failed, but recovered ${recovered.files.length} files from content.`);
          return recovered;
      }
  } catch {}

  return null;
}

export async function retryReplyAsStructuredJSON(client, modelConfig, apiMessages, rawReply) {
  try {
    const retryMessages = [
      ...apiMessages,
      { role: "assistant", content: rawReply },
      {
        role: "user",
        content:
          "Your previous reply was not valid JSON. Return the same answer as VALID JSON ONLY. No markdown, no explanation, no code fences. Use the agreed schema with keys like plan, files, commands, message, or instructions.",
      },
    ];

    const inputTokens = estimateMessageTokens(retryMessages);
    const safeMaxTokens = getSafeMaxTokens(inputTokens, modelConfig);
    const completion = await client.chat.completions.create({
      model: modelConfig.id,
      messages: retryMessages,
      temperature: 0,
      top_p: modelConfig.topP,
      max_tokens: safeMaxTokens,
      ...modelConfig.extraParams,
    });

    return completion.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.log(`\n⚠️  JSON retry failed: ${error.message}`);
    return "";
  }
}
