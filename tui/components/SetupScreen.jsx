import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { THEME, LOGO } from '../constants.js';
import { setStoredApiKey } from '../../utils/configManager.js';
import { getProvider, getProviderForModel, validateApiKey } from '../../config/models.js';

const SetupScreen = ({ modelKey = null, onComplete }) => {
  const lockedProvider = modelKey ? getProviderForModel(modelKey) : null;
  const [providerKey, setProviderKey] = useState(lockedProvider?.key || 'nvidia');
  const [apiKey, setApiKeyInput] = useState('');
  const [error, setError] = useState('');
  const provider = lockedProvider || getProvider(providerKey) || getProvider('nvidia');

  useInput((input, key) => {
    if (lockedProvider) return;
    if (!key.tab) return;

    setProviderKey((current) => (current === 'nvidia' ? 'openrouter' : 'nvidia'));
    setApiKeyInput('');
    setError('');
  });

  const handleSubmit = (value) => {
    const trimmed = value.trim();
    const validationError = validateApiKey(provider.key, trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setStoredApiKey(provider.envKey, trimmed);
    onComplete(provider.key);
  };

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box
        borderStyle="round"
        borderColor={THEME.border}
        padding={2}
        flexDirection="column"
        width={72}
      >
        <Box flexDirection="column" alignItems="center" marginBottom={2}>
          <Text color={THEME.accent}>{LOGO}</Text>
        </Box>

        <Box flexDirection="column" paddingX={2}>
          <Text color={THEME.warning} bold marginBottom={1}>
            No {provider.name} API Key Found
          </Text>
          <Text color={THEME.text} marginBottom={1}>
            {modelKey
              ? `RootX needs a ${provider.name} API key to use the selected model.`
              : 'RootX needs an API key before you can start a session.'}
          </Text>
          <Text color={THEME.dim} marginBottom={1}>
            Get your key at: {provider.keyUrl}
          </Text>

          {!lockedProvider ? (
            <Box marginTop={1} flexDirection="column">
              <Text color={THEME.accent}>Provider:</Text>
              <Box marginTop={1}>
                <Text color={provider.key === 'nvidia' ? THEME.accent : THEME.dim} bold={provider.key === 'nvidia'}>
                  NVIDIA Build
                </Text>
                <Text color={THEME.dim}>  /  </Text>
                <Text color={provider.key === 'openrouter' ? THEME.accent : THEME.dim} bold={provider.key === 'openrouter'}>
                  OpenRouter
                </Text>
              </Box>
              <Text color={THEME.dim}>Press Tab to switch provider.</Text>
            </Box>
          ) : null}

          <Box marginTop={1} flexDirection="column">
            <Text color={THEME.accent}>Enter your API key:</Text>
            <Box marginTop={1}>
              <TextInput
                value={apiKey}
                onChange={(val) => {
                  setApiKeyInput(val);
                  setError('');
                }}
                onSubmit={handleSubmit}
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
            <Text color={THEME.dim}>
              Press Enter to save. Keys are stored locally at ~/.config/rootx/
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default SetupScreen;
