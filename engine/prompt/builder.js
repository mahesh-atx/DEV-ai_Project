import {
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  buildEnvironmentSection,
  getActionsSection,
  getSimpleDoingTasksSection,
  getSimpleIntroSection,
  getSimpleSystemSection,
} from "./sections.js";
import { renderInstructionFiles } from "./instructions.js";
import { renderProjectContext } from "./projectContext.js";
import { renderConfigSection } from "../config/loader.js";

export class SystemPromptBuilder {
  constructor() {
    this.outputStyleName = null;
    this.outputStylePrompt = null;
    this.osName = null;
    this.osVersion = null;
    this.projectContext = null;
    this.config = null;
    this.appendSections = [];
  }

  withOutputStyle(name, prompt) {
    this.outputStyleName = name;
    this.outputStylePrompt = prompt;
    return this;
  }

  withOS(osName, osVersion) {
    this.osName = osName;
    this.osVersion = osVersion;
    return this;
  }

  withProjectContext(projectContext) {
    this.projectContext = projectContext;
    return this;
  }

  withRuntimeConfig(config) {
    this.config = config;
    return this;
  }

  appendSection(section) {
    if (section && String(section).trim()) {
      this.appendSections.push(String(section).trim());
    }
    return this;
  }

  build() {
    const sections = [];

    sections.push(getSimpleIntroSection(Boolean(this.outputStyleName)));
    if (this.outputStyleName && this.outputStylePrompt) {
      sections.push(`# Output Style: ${this.outputStyleName}\n${this.outputStylePrompt}`);
    }
    sections.push(getSimpleSystemSection());
    sections.push(getSimpleDoingTasksSection());
    sections.push(getActionsSection());
    sections.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    sections.push(buildEnvironmentSection({
      modelFamily: this.projectContext?.modelFamily,
      cwd: this.projectContext?.cwd,
      currentDate: this.projectContext?.currentDate,
      osName: this.osName,
      osVersion: this.osVersion,
    }));

    if (this.projectContext) {
      sections.push(renderProjectContext(this.projectContext));
      if (Array.isArray(this.projectContext.instructionFiles) && this.projectContext.instructionFiles.length > 0) {
        sections.push(renderInstructionFiles(this.projectContext.instructionFiles));
      }
    }

    if (this.config) {
      sections.push(renderConfigSection(this.config));
    }

    sections.push(...this.appendSections);
    return sections.filter(Boolean);
  }

  render() {
    return this.build().join("\n\n");
  }
}
