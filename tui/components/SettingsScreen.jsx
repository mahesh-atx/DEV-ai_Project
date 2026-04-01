import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../constants.js';

const SettingsScreen = ({ onBack }) => {
  const [ready, setReady] = useState(false);

  useInput((input, key) => {
    if (ready) onBack();
    setReady(true);
  });

  return (
    <Box padding={2} borderStyle="round" borderColor={THEME.border} flexDirection="column">
      <Text color={THEME.accent} bold>Global Settings</Text>
      <Text color={THEME.dim} marginBottom={1}>Modify connected endpoints, themes, and workspace limits.</Text>
      <Text color={THEME.text}>Settings panel not implemented in this demo.</Text>
      <Box marginTop={1}>
        <Text color={THEME.accent}>❯ </Text>
        <Text color={THEME.dim}>Press any key to return...</Text>
      </Box>
    </Box>
  );
};

export default SettingsScreen;
