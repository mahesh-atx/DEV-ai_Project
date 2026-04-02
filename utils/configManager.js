import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR_NAME = '.config/rootx';
const CONFIG_FILE_NAME = 'config.json';

/**
 * Returns the absolute path to the global config directory.
 * Creates the directory if it does not exist.
 */
export function getConfigDir() {
  const dir = path.join(os.homedir(), CONFIG_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the absolute path to the config file.
 */
export function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Reads and returns the parsed config object.
 * Returns an empty object if the file does not exist or is invalid.
 */
export function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Writes the given object as the config file.
 */
export function saveConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Returns the stored NVIDIA API key, or null if not set.
 */
export function getApiKey() {
  const config = loadConfig();
  return config.NVIDIA_API_KEY || null;
}

/**
 * Stores the NVIDIA API key in the global config file
 * and injects it into process.env if not already set.
 */
export function setApiKey(key) {
  const config = loadConfig();
  config.NVIDIA_API_KEY = key;
  saveConfig(config);

  if (!process.env.NVIDIA_API_KEY) {
    process.env.NVIDIA_API_KEY = key;
  }
}

/**
 * Removes the stored API key from the global config.
 */
export function clearApiKey() {
  const config = loadConfig();
  delete config.NVIDIA_API_KEY;
  saveConfig(config);
}

/**
 * Returns true if an API key is available (from env or stored config).
 */
export function hasApiKey() {
  return !!(process.env.NVIDIA_API_KEY || getApiKey());
}

/**
 * Injects the stored API key into process.env if it is not already set.
 * Call this once at application startup.
 */
export function injectApiKeyToEnv() {
  if (!process.env.NVIDIA_API_KEY) {
    const key = getApiKey();
    if (key) {
      process.env.NVIDIA_API_KEY = key;
    }
  }
}
