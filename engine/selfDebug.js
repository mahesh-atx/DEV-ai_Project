/**
 * engine/selfDebug.js — Auto-debug loop that fixes build/test failures
 */

import { execSync } from "child_process";
import chalk from "chalk";
import { createStreamingPanel } from "../cli-ui.js";
import { autoInstallFromError, runCommands } from "./commandExecutor.js";
import { detectBuildCommand, buildSmartContext } from "./context.js";
import { patchFile } from "./patchEngine.js";
import { parseJSON } from "./jsonParser.js";

export async function selfDebugLoop(projectDir, messages, client, modelConfig, customBuildCmd = null, maxAttempts = 3) {
  const buildCmd = detectBuildCommand(projectDir, customBuildCmd);
  if (!buildCmd) {
    console.log("\n⚠️  No build/test command detected.");
    console.log("   Use: /build <command>  to set one (e.g. /build npm test)");
    return;
  }

  console.log(`\n🔨 Running: ${buildCmd}`);
  console.log("─".repeat(50));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const output = execSync(buildCmd, {
        cwd: projectDir,
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"]
      });
      console.log(output.slice(0, 1000));
      console.log(`\n✅ Build/test PASSED on attempt ${attempt}!`);
      return true;
    } catch (e) {
      const errorOutput = (e.stderr || "") + (e.stdout || "") || e.message;
      const truncatedError = errorOutput.slice(0, 2000);
      console.log(`\n🔴 Build FAILED (attempt ${attempt}/${maxAttempts}):`);
      console.log(truncatedError.slice(0, 500));

      // Try auto-installing missing dependency before burning an AI attempt
      const installCmd = autoInstallFromError(errorOutput, projectDir);
      if (installCmd) {
        console.log(chalk.yellow(`\n🔄 Detected missing dependency — running: ${installCmd}`));
        try {
          const installResult = await runCommands([installCmd], projectDir, { source: "debug_auto_install" });
          if (installResult?.executed > 0) {
            console.log(chalk.green("  ✓ Dependency installed, retrying build..."));
            continue;
          }
        } catch {
          console.log(chalk.gray("  ⚠ Auto-install failed, falling back to AI fix."));
        }
      }

      if (attempt >= maxAttempts) {
        console.log(`\n❌ Max attempts (${maxAttempts}) reached. Manual fix needed.`);
        return false;
      }

      // Feed error back to AI for auto-fix
      console.log(`\n🤖 Asking AI to fix (attempt ${attempt + 1}/${maxAttempts})...`);
      process.stdout.write("DevAI: Analyzing error");

      const smartContext = buildSmartContext(projectDir, "fix build error", modelConfig, messages);
      messages.push({
        role: "user",
        content: `BUILD/TEST FAILED. Fix this error:\n\n\`\`\`\n${truncatedError}\`\`\`\n\nProject context:\n${smartContext}\n\nReturn the fixed file(s) as JSON. Use surgical edits when possible.`
      });

      let reply = "";
      const panel = createStreamingPanel({ label: "Debug fix" });
      try {
        const stream = await client.chat.completions.create({
          model: modelConfig.id,
          messages,
          temperature: modelConfig.temperature,
          top_p: modelConfig.topP,
          max_tokens: modelConfig.maxTokens,
          stream: true,
          ...modelConfig.extraParams
        });

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            panel.update({ reasoningDelta: delta.reasoning_content, chars: reply.length });
          }
          if (delta?.content) {
            reply += delta.content;
            panel.update({ chars: reply.length });
          }
        }
        panel.stop({ percent: 100 });
      } catch (apiErr) {
        panel.stop({ percent: 100 });
        console.log(`\n❌ AI API error: ${apiErr.message}`);
        return false;
      }

      if (!reply.trim()) {
        console.log("\n⚠️  AI returned empty response.");
        return false;
      }

      console.log(" ✓");
      messages.push({ role: "assistant", content: reply });

      const parsed = parseJSON(reply);
      if (!parsed || !parsed.files) {
        console.log("⚠️  Could not parse AI fix response.");
        return false;
      }

      // Apply fixes
      console.log(`\n📂 Applying ${parsed.files.length} fix(es):`);
      for (const f of parsed.files) {
        if (!f.path) continue;
        if (f.edits && Array.isArray(f.edits)) {
          patchFile(projectDir, f.path, null, f.edits);
        } else if (typeof f.content === "string") {
          patchFile(projectDir, f.path, f.content);
        }
      }

      console.log(`\n🔄 Retrying build...`);
    }
  }
  return false;
}
