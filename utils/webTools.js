/**
 * utils/webTools.js
 * Implements Kilo-style webfetch and websearch capabilities for the Orchestrator.
 */

import fetch from 'node-fetch'; // polyfill if needed, or native fetch in Node 18+
import https from 'https';

// Optional: You can load an Exa API key from environment variables
const EXA_API_KEY = process.env.EXA_API_KEY || '';

/**
 * Strips HTML tags and returns a somewhat clean text/markdown representation.
 * For a truly robust solution, libraries like `turndown` or `cheerio` are recommended.
 */
function simpleHtmlToMarkdown(html) {
  if (!html) return '';
  let text = html;
  // Remove script and style blocks entirely
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Replace typical block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|ul|ol|table|tr|blockquote)>/gi, '\n\n');
  text = text.replace(/<br\s*[\/]?>/gi, '\n');
  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Collapse multiple newlines and spaces
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/**
 * webfetch: Fetches a URL and returns its content as text/markdown.
 * Has a 30s timeout and a 5MB size limit.
 */
export async function webfetch(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Invalid URL protocol: ${url.protocol}. Must be http or https`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000); // 30s timeout

    const requestOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: controller.signal
    };

    // Use native global fetch 
    const response = await globalThis.fetch(urlStr, requestOptions);
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 403 && response.headers.get('cf-mitigated') === 'challenge') {
        return { error: 'CloudFlare protection blocked the request.' };
      }
      return { error: `HTTP Error: ${response.status} ${response.statusText}` };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
      return { error: 'Response exceeds 5MB size limit.' };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('image/')) {
       return { error: 'URL points to an image. Use image processing tools if needed.' };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return { error: 'Downloaded content exceeds 5MB size limit.' };
    }

    const textPayload = new TextDecoder().decode(arrayBuffer);
    
    let parsedContent = textPayload;
    if (contentType.includes('text/html')) {
       parsedContent = simpleHtmlToMarkdown(textPayload);
    }

    return { content: parsedContent };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { error: 'Request timed out after 30 seconds.' };
    }
    return { error: error.message };
  }
}

/**
 * websearch: Performs a web search query via Exa AI MCP.
 * Requires EXA_API_KEY environment variable if implementing actual API hit.
 */
export async function websearch(query, numResults = 8) {
  if (!EXA_API_KEY) {
      return { 
          error: "No EXA_API_KEY provided in .env. Search cannot be completely fulfilled. Mocking a response for now." 
      };
      // In a real implementation where you want Exa MCP:
      // You hit https://mcp.exa.ai/mcp using a JSON-RPC 2.0 structure.
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const response = await globalThis.fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY
      },
      body: JSON.stringify({
        query: query,
        numResults: numResults,
        useAutoprompt: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
        return { error: `Exa API Error: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    return { 
        results: data.results.map(r => ({
           title: r.title,
           url: r.url,
           snippet: r.text || r.highlight || r.snippet || ""
        }))
    };
  } catch (err) {
    if (err.name === 'AbortError') {
       return { error: 'Web search timed out after 25 seconds.' };
    }
    return { error: `Web search failure: ${err.message}` };
  }
}
