import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { THEME } from '../constants.js';
import { getApiKey, setApiKey, clearApiKey } from '../../utils/configManager.js';

const MASKED_PREFIX = 'nvapi-';
const MASKED_VISIBLE_CHARS = 4;

function maskKey(key) {
  if (!key) return '(not set)';
  if (key.startsWith(MASKED_PREFIX) && key.length > MASKED_PREFIX.length + MASKED_VISIBLE_CHARS) {
    return MASKED_PREFIX + '****' + key.slice(-MASKED_VISIBLE_CHARS);
  }
  return key.slice(0, 6) + '****' + key.slice(-4);
}

const SettingsScreen = ({ onBack }) => {
  const [screen, setScreen] = useState('menu');
  const [newKey, setNewKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const currentKey = getApiKey();
  const envKey = process.env.NVIDIA_API_KEY;
  const keySource = envKey ? (currentKey ? 'both (.env + stored)' : '.env file') : (currentKey ? 'stored config' : 'none');

  const menuItems = [
    { label: 'Change API Key', value: 'change' },
    { label: 'Clear Stored API Key', value: 'clear' },
    { label: 'Back to Main Menu', value: 'back' },
  ];

  const handleMenuSelect = (item) => {
    if (item.value === 'back') {
      onBack();
    } else if (item.value === 'change') {
      setNewKey('');
      setError('');
      setMessage('');
      setScreen('change');
    } else if (item.value === 'clear') {
      clearApiKey();
      setMessage('Stored API key cleared.');
      setScreen('menu');
    }
  };

  const handleKeySubmit = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('API key cannot be empty.');
      return;
    }
    if (!trimmed.startsWith('nvapi-')) {
      setError('Key must start with "nvapi-".');
      return;
    }
    if (trimmed.length < 20) {
      setError('Key seems too short. Please check and try again.');
      return;
    }
    setApiKey(trimmed);
    setMessage('API key updated successfully.');
    setScreen('menu');
  };

  if (screen === 'change') {
    return (
      <Box flexDirection="column" padding={2} width="100%" alignItems="center">
        <Box padding={2} borderStyle="round" borderColor={THEME.border} flexDirection="column" width={72}>
        <Text color={THEME.accent} bold>Change API Key</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={THEME.dim}>Current: {maskKey(currentKey || envKey)}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={THEME.text}>Enter new NVIDIA API key:</Text>
          <Box marginTop={1}>
            <TextInput
              value={newKey}
              onChange={(val) => { setNewKey(val); setError(''); }}
              onSubmit={handleKeySubmit}
              placeholder="nvapi-xxxxxxxxxxxxxxxxxxxx"
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

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box padding={2} borderStyle="round" borderColor={THEME.border} flexDirection="column" width={72}>
      <Text color={THEME.accent} bold>Global Settings</Text>
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text color={THEME.text}>API Key: {maskKey(currentKey || envKey)}</Text>
        <Text color={THEME.dim}>Source: {keySource}</Text>
        <Text color={THEME.dim}>Config: ~/.config/devai/config.json</Text>
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
