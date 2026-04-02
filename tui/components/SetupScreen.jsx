import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { THEME, LOGO } from '../constants.js';
import { setApiKey } from '../../utils/configManager.js';

const SetupScreen = ({ onComplete }) => {
  const [apiKey, setApiKeyInput] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('API key cannot be empty.');
      return;
    }
    if (!trimmed.startsWith('nvapi-')) {
      setError('Key must start with "nvapi-". Check https://build.nvidia.com');
      return;
    }
    if (trimmed.length < 20) {
      setError('Key seems too short. Please check and try again.');
      return;
    }
    setApiKey(trimmed);
    onComplete();
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
            No NVIDIA API Key Found
          </Text>
          <Text color={THEME.text} marginBottom={1}>
            RootX requires an NVIDIA API key to function.
          </Text>
          <Text color={THEME.dim} marginBottom={1}>
            Get your free key at: https://build.nvidia.com
          </Text>

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
            <Text color={THEME.dim}>
              Press Enter to save. The key is stored locally at ~/.config/rootx/
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default SetupScreen;
