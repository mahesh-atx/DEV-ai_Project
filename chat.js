import dotenv from "dotenv";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import chalk from "chalk";
import { getModel, listModels } from "./config/models.js";
import { createClient } from "./config/apiClient.js";
import {
  showWelcomeBanner,
  selectModelInteractive,
  showModelDetails,
  showSection,
  createSpinner,
  createStreamingPanel,
  showSuccess,
  showError,
  showInfo,
  showDivider,
  promptInput,
  showList,
} from "./cli-ui.js";

dotenv.config();

async function getUserInput(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function encodeImage(imagePath) {
  const cleanPath = imagePath.replace(/^["'](.+)["']$/, "$1");
  try {
    const imageBuffer = fs.readFileSync(cleanPath);
    const extension = path.extname(cleanPath).toLowerCase().replace(".", "");
    const mimeType = extension === "png" ? "image/png" : "image/jpeg";
    return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  } catch (error) {
    console.error(`Error reading image: ${error.message}`);
    return null;
  }
}

export async function main() {
  // Show welcome banner
  showWelcomeBanner("🤖 AI Chat Assistant", "Multimodal • Persistent Memory • Real-time Streaming");
  
  // Get available models and show interactive selector
  const availableModels = listModels().map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description,
    ...m,
  }));

  if (availableModels.length === 0) {
    showError("No models available. Check your configuration.");
    process.exit(1);
  }

  // Interactive model selection
  let selectedKey;
  try {
    selectedKey = await selectModelInteractive(availableModels);
  } catch (err) {
    showError("Failed to select model");
    process.exit(1);
  }

  let modelConfig;
  try {
    modelConfig = getModel(selectedKey);
  } catch (err) {
    showError(`Error loading model: ${err.message}`);
    process.exit(1);
  }

  // Show model details
  showModelDetails(modelConfig);

  const openai = createClient(modelConfig.apiKey);

  // Conversation memory
  const messages = [
    {
      role: "system",
      content:
        "You are an expert AI assistant. If an image is provided, analyze it accurately. If code is requested, provide only clean, production-ready code without unnecessary commentary. Maintain context of the conversation for follow-up requests.",
    },
  ];

  showSection("Chat Interface");
  showList([
    { icon: "💡", text: "Type your message and press Enter", color: "cyan" },
    { icon: "🖼", text: modelConfig.isMultimodal ? "Images are supported" : "This model doesn't support images", color: "yellow" },
    { icon: "❌", text: "Type 'exit' or 'quit' to end", color: "red" },
  ]);
  showDivider();

  while (true) {
    const userMessage = await getUserInput(`\n${chalk.cyan("You:")} `);

    if (
      userMessage.toLowerCase() === "exit" ||
      userMessage.toLowerCase() === "quit"
    ) {
      showInfo("Chat ended. Goodbye!");
      break;
    }

    let imageBase64 = null;
    if (modelConfig.isMultimodal) {
      const includeImage = await getUserInput(
        chalk.yellow("Add image? (y/n): ")
      );
      if (includeImage.toLowerCase() === "y") {
        const imagePath = await getUserInput(chalk.gray("Image path: "));
        if (imagePath.trim()) {
          imageBase64 = encodeImage(imagePath.trim());
          if (imageBase64) {
            showSuccess("Image encoded Successfully");
          } else {
            showError("Failed to process image");
          }
        }
      }
    }

    if (!userMessage.trim() && !imageBase64) {
      showInfo("Please provide a message or an image");
      continue;
    }

    // Prepare message content based on vision support
    let currentContent;
    if (imageBase64) {
      currentContent = [
        { type: "text", text: userMessage || "Analyze this image." },
        { type: "image_url", image_url: { url: imageBase64 } },
      ];
    } else {
      currentContent = userMessage;
    }

    messages.push({ role: "user", content: currentContent });

    // --- Thinking Indicator with Spinner ---
    const spinner = createSpinner(
      `Processing with ${modelConfig.name}...`
    );
    spinner.start();
    let firstChunk = true;

    let panel;
    try {
      panel = createStreamingPanel({ label: "Assistant response" });
      const completion = await openai.chat.completions.create({
        model: modelConfig.id,
        messages: messages,
        temperature: modelConfig.temperature,
        top_p: modelConfig.topP,
        max_tokens: modelConfig.maxTokens,
        stream: true,
        ...modelConfig.extraParams,
      });

      let fullResponse = "";
      for await (const chunk of completion) {
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          panel.update({ reasoningDelta: delta.reasoning_content, chars: fullResponse.length });
        }

        const deltaContent = delta?.content;
        if (deltaContent) {
          if (firstChunk) {
            spinner.stop();
            panel.stop({ percent: 100 });
            console.log(chalk.bold.green(`\nAssistant (${modelConfig.name}):`));
            firstChunk = false;
          }
          process.stdout.write(deltaContent);
          fullResponse += deltaContent;
        }
      }

      // Store AI response in history
      messages.push({ role: "assistant", content: fullResponse });
      if (firstChunk) {
        spinner.stop();
        panel.stop({ percent: 100 });
      }
      console.log("\n");
      showSuccess("Response complete");

    } catch (error) {
      if (panel) panel.stop({ percent: 100 });
      spinner.fail(chalk.red(`Error: ${error.message}`));
    }

    showDivider();
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch(console.error);
}
