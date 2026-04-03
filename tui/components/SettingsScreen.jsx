import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { THEME } from '../constants.js';
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from '../../utils/configManager.js';
import { getProvider, validateApiKey } from '../../config/models.js';

function maskKey(key) {
  if (!key) return '(not set)';
  if (key.length <= 10) return `${key.slice(0, 3)}****`;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

const SettingsScreen = ({ onBack }) => {
  const [screen, setScreen] = useState('menu');
  const [targetProviderKey, setTargetProviderKey] = useState('nvidia');
  const [newKey, setNewKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const nvidia = getProvider('nvidia');
  const openrouter = getProvider('openrouter');

  const menuItems = [
    { label: 'Change NVIDIA Build API Key', value: 'change:nvidia' },
    { label: 'Clear Stored NVIDIA Build API Key', value: 'clear:nvidia' },
    { label: 'Change OpenRouter API Key', value: 'change:openrouter' },
    { label: 'Clear Stored OpenRouter API Key', value: 'clear:openrouter' },
    { label: 'Back to Main Menu', value: 'back' },
  ];

  const getProviderState = (provider) => {
    const storedKey = getStoredApiKey(provider.envKey);
    const envKey = process.env[provider.envKey];
    const source = envKey
      ? (storedKey ? 'both (.env + stored)' : '.env file')
      : (storedKey ? 'stored config' : 'none');

    return {
      storedKey,
      envKey,
      source,
    };
  };

  const handleMenuSelect = (item) => {
    if (item.value === 'back') {
      onBack();
      return;
    }

    const [action, providerKey] = item.value.split(':');
    if (action === 'change') {
      setTargetProviderKey(providerKey);
      setNewKey('');
      setError('');
      setMessage('');
      setScreen('change');
      return;
    }

    if (action === 'clear') {
      const provider = getProvider(providerKey);
      clearStoredApiKey(provider.envKey);
      setMessage(`${provider.name} stored API key cleared.`);
      setScreen('menu');
    }
  };

  const handleKeySubmit = (value) => {
    const trimmed = value.trim();
    const provider = getProvider(targetProviderKey);
    const validationError = validateApiKey(provider.key, trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setStoredApiKey(provider.envKey, trimmed);
    setMessage(`${provider.name} API key updated successfully.`);
    setScreen('menu');
  };

  if (screen === 'change') {
    const provider = getProvider(targetProviderKey);
    const providerState = getProviderState(provider);

    return (
      <Box flexDirection="column" padding={2} width="100%" alignItems="center">
        <Box padding={2} borderStyle="round" borderColor={THEME.border} flexDirection="column" width={72}>
        <Text color={THEME.accent} bold>Change {provider.name} API Key</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={THEME.dim}>Current: {maskKey(providerState.storedKey || providerState.envKey)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={THEME.text}>Enter new {provider.name} API key:</Text>
          <Box marginTop={1}>
            <TextInput
              value={newKey}
              onChange={(val) => { setNewKey(val); setError(''); }}
              onSubmit={handleKeySubmit}
              placeholder={provider.placeholder}
              focus
              showCursor
            />
          </Box>
          {error ? (
            <Box marginTop={1}>
              <Text color={THEME.error}>{error}</Text>
            </Box>
          ) : null}
        </Box>
        <Box marginTop={2}>
          <Text color={THEME.dim}>Press Enter to save, or Esc to cancel.</Text>
        </Box>
        <EscHandler onEsc={() => setScreen('menu')} />
        </Box>
      </Box>
    );
  }

  const nvidiaState = getProviderState(nvidia);
  const openrouterState = getProviderState(openrouter);

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box padding={2} borderStyle="round" borderColor={THEME.border} flexDirection="column" width={72}>
      <Text color={THEME.accent} bold>Global Settings</Text>
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text color={THEME.text}>NVIDIA Build: {maskKey(nvidiaState.storedKey || nvidiaState.envKey)}</Text>
        <Text color={THEME.dim}>Source: {nvidiaState.source}</Text>
        <Text color={THEME.text}>OpenRouter: {maskKey(openrouterState.storedKey || openrouterState.envKey)}</Text>
        <Text color={THEME.dim}>Source: {openrouterState.source}</Text>
        <Text color={THEME.dim}>Config: ~/.config/rootx/config.json</Text>
      </Box>
      {message ? (
        <Box marginBottom={1}>
          <Text color={THEME.success}>{message}</Text>
        </Box>
      ) : null}
      <SelectInput
        items={menuItems}
        onSelect={handleMenuSelect}
        indicatorComponent={({ isSelected }) => (
          <Text color={isSelected ? THEME.accent : THEME.dim}>
            {isSelected ? '❯ ' : '  '}
          </Text>
        )}
        itemComponent={({ isSelected, label }) => (
          <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
            {label}
          </Text>
        )}
      />
      </Box>
    </Box>
  );
};

function EscHandler({ onEsc }) {
  useInput((input, key) => {
    if (key.escape) onEsc();
  });
  return null;
}

export default SettingsScreen;
