import os from "os";
import { SystemPromptBuilder } from "./builder.js";
import { buildProjectContext } from "./projectContext.js";
import { discoverInstructionDocs } from "./instructions.js";
import { ConfigLoader } from "../config/loader.js";

export function buildPromptRuntime(options = {}) {
  const cwd = options.projectRoot || options.cwd || process.cwd();
  const instructionFiles = options.instructionFiles || discoverInstructionDocs(cwd, options);
  const projectContext = options.projectContext || buildProjectContext(cwd, {
    ...options,
    instructionFiles,
  });
  const runtimeConfig = options.runtimeConfig || ConfigLoader.defaultFor(cwd).load();

  const builder = new SystemPromptBuilder()
    .withOS(options.osName || os.platform(), options.osVersion || os.release())
    .withProjectContext(projectContext)
    .withRuntimeConfig(runtimeConfig);

  if (options.outputStyle?.name && options.outputStyle?.prompt) {
    builder.withOutputStyle(options.outputStyle.name, options.outputStyle.prompt);
  }

  for (const section of options.appendSections || []) {
    builder.appendSection(section);
  }

  const sections = builder.build();
  return {
    sections,
    prompt: sections.join("\n\n"),
    projectContext,
    runtimeConfig,
  };
}

export { SystemPromptBuilder } from "./builder.js";
export * from "./sections.js";
export * from "./instructions.js";
export * from "./projectContext.js";
export * from "./compaction.js";
