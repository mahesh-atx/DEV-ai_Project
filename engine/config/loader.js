import fs from "fs";
import os from "os";
import path from "path";
import { deepMergeObjects } from "./merging.js";
import { loadConfig as loadRootxConfig } from "../../utils/configManager.js";

function getRootxCompatConfigPath() {
  return path.join(os.homedir(), ".config", "rootx", "config.json");
}

function readOptionalJsonObject(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`Config file must contain a JSON object: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function optionalArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function optionalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseFeatureConfig(merged = {}) {
  const hooks = optionalObject(merged.hooks);
  const plugins = optionalObject(merged.plugins);
  const enabledPlugins = optionalObject(merged.enabledPlugins);
  const mcpServers = optionalObject(merged.mcpServers);
  const sandbox = optionalObject(merged.sandbox);

  return {
    hooks: {
      preToolUse: optionalArray(hooks.PreToolUse),
      postToolUse: optionalArray(hooks.PostToolUse),
    },
    plugins: {
      enabledPlugins,
      externalDirectories: optionalArray(plugins.externalDirectories),
      installRoot: typeof plugins.installRoot === "string" ? plugins.installRoot : null,
      registryPath: typeof plugins.registryPath === "string" ? plugins.registryPath : null,
      bundledRoot: typeof plugins.bundledRoot === "string" ? plugins.bundledRoot : null,
    },
    mcp: {
      servers: mcpServers,
    },
    oauth: merged.oauth && typeof merged.oauth === "object" ? merged.oauth : null,
    model: typeof merged.model === "string" ? merged.model : null,
    permissionMode:
      typeof merged.permissionMode === "string"
        ? merged.permissionMode
        : typeof merged.permissions?.defaultMode === "string"
          ? merged.permissions.defaultMode
          : null,
    sandbox: {
      enabled: typeof sandbox.enabled === "boolean" ? sandbox.enabled : null,
      namespaceRestrictions:
        typeof sandbox.namespaceRestrictions === "boolean" ? sandbox.namespaceRestrictions : null,
      networkIsolation: typeof sandbox.networkIsolation === "boolean" ? sandbox.networkIsolation : null,
      filesystemMode: typeof sandbox.filesystemMode === "string" ? sandbox.filesystemMode : null,
      allowedMounts: optionalArray(sandbox.allowedMounts),
    },
  };
}

export class RuntimeConfig {
  constructor(merged = {}, loadedEntries = []) {
    this._merged = merged;
    this._loadedEntries = loadedEntries;
    this._featureConfig = parseFeatureConfig(merged);
  }

  merged() {
    return this._merged;
  }

  loadedEntries() {
    return this._loadedEntries;
  }

  asJson() {
    return this._merged;
  }

  get(key) {
    return this._merged?.[key];
  }

  hooks() {
    return this._featureConfig.hooks;
  }

  plugins() {
    return this._featureConfig.plugins;
  }

  mcp() {
    return this._featureConfig.mcp;
  }

  oauth() {
    return this._featureConfig.oauth;
  }

  model() {
    return this._featureConfig.model;
  }

  permissionMode() {
    return this._featureConfig.permissionMode;
  }

  sandbox() {
    return this._featureConfig.sandbox;
  }

  static empty() {
    return new RuntimeConfig({}, []);
  }
}

export class ConfigLoader {
  constructor(cwd = process.cwd(), configHome = path.join(os.homedir(), ".claw")) {
    this.cwd = path.resolve(cwd);
    this.configHome = configHome;
  }

  static defaultFor(cwd = process.cwd()) {
    return new ConfigLoader(cwd);
  }

  discover() {
    return [
      {
        source: "user",
        kind: "claw-legacy",
        path: path.join(path.dirname(this.configHome), ".claw.json"),
      },
      {
        source: "user",
        kind: "claw",
        path: path.join(this.configHome, "settings.json"),
      },
      {
        source: "project",
        kind: "claw-legacy",
        path: path.join(this.cwd, ".claw.json"),
      },
      {
        source: "project",
        kind: "claw",
        path: path.join(this.cwd, ".claw", "settings.json"),
      },
      {
        source: "local",
        kind: "claw",
        path: path.join(this.cwd, ".claw", "settings.local.json"),
      },
      {
        source: "compatibility",
        kind: "rootx",
        path: getRootxCompatConfigPath(),
      },
    ];
  }

  load() {
    let merged = {};
    const loadedEntries = [];

    for (const entry of this.discover()) {
      let value;

      if (entry.kind === "rootx") {
        const raw = loadRootxConfig();
        value = raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0 ? raw : null;
      } else {
        value = readOptionalJsonObject(entry.path);
      }

      if (!value) continue;

      merged = deepMergeObjects(merged, value);
      loadedEntries.push(entry);
    }

    return new RuntimeConfig(merged, loadedEntries);
  }
}

export function renderConfigSection(config) {
  const runtimeConfig = config instanceof RuntimeConfig ? config : new RuntimeConfig(config || {}, []);
  const lines = ["# Runtime config"];

  if (!runtimeConfig.loadedEntries().length) {
    lines.push(" - No Claw or compatibility settings files loaded.");
    return lines.join("\n");
  }

  for (const entry of runtimeConfig.loadedEntries()) {
    lines.push(` - Loaded ${entry.source}: ${entry.path}`);
  }

  lines.push("");
  lines.push(JSON.stringify(runtimeConfig.asJson(), null, 2));
  return lines.join("\n");
}
