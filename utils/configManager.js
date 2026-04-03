import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR_NAME = '.config/rootx';
const CONFIG_FILE_NAME = 'config.json';
const KNOWN_API_ENV_KEYS = ['NVIDIA_API_KEY', 'OPENROUTER_API_KEY'];

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
 * Returns the stored API key for the given env key, or null if not set.
 */
export function getStoredApiKey(envKey) {
  const config = loadConfig();
  return config[envKey] || null;
}

/**
 * Stores the API key in the global config file
 * and injects it into process.env if not already set.
 */
export function setStoredApiKey(envKey, key) {
  const config = loadConfig();
  config[envKey] = key;
  saveConfig(config);

  if (!process.env[envKey]) {
    process.env[envKey] = key;
  }
}

/**
 * Removes the stored API key from the global config.
 */
export function clearStoredApiKey(envKey) {
  const config = loadConfig();
  const previousValue = config[envKey];
  delete config[envKey];
  saveConfig(config);

  if (previousValue && process.env[envKey] === previousValue) {
    delete process.env[envKey];
  }
}

/**
 * Returns true if an API key is available (from env or stored config).
 */
export function hasApiKey(envKey) {
  return !!(process.env[envKey] || getStoredApiKey(envKey));
}

/**
 * Returns true if any known provider key is available.
 */
export function hasAnyApiKey() {
  return KNOWN_API_ENV_KEYS.some((envKey) => hasApiKey(envKey));
}

/**
 * Injects all stored API keys into process.env if they are not already set.
 * Call this once at application startup.
 */
export function injectApiKeysToEnv() {
  for (const envKey of KNOWN_API_ENV_KEYS) {
    if (process.env[envKey]) continue;
    const key = getStoredApiKey(envKey);
    if (key) {
      process.env[envKey] = key;
    }
  }
}

/**
 * Backwards-compatible NVIDIA helpers used by older code paths.
 */
export function getApiKey() {
  return getStoredApiKey('NVIDIA_API_KEY');
}

export function setApiKey(key) {
  setStoredApiKey('NVIDIA_API_KEY', key);
}

export function clearApiKey() {
  clearStoredApiKey('NVIDIA_API_KEY');
}

export function injectApiKeyToEnv() {
  injectApiKeysToEnv();
}
