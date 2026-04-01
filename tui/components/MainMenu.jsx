import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { THEME, LOGO } from '../constants.js';

const MainMenu = ({ mode, model, onSelect }) => {
  const items = [
    { label: 'Start Session', value: 'chat' },
    { label: `Change Mode  ⸺ Current: ${mode.label}`, value: 'modes' },
    { label: `Change Model ⸺ Current: ${model.label}`, value: 'models' },
    { label: 'Settings', value: 'settings' },
    { label: 'Exit CLI', value: 'exit' },
  ];

  const handleSelect = (item) => {
    if (item.value === 'exit') {
      process.exit(0);
    }
    onSelect(item.value);
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
          <Box marginTop={1}>
            <Text color={THEME.dim}>v2.0.0 ⸺ Multimodal • Persistent Memory • Real-time Streaming</Text>
          </Box>
        </Box>

        <Box flexDirection="column" paddingX={4}>
          <SelectInput
            items={items}
            onSelect={handleSelect}
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

        <Box
          marginTop={2}
          paddingTop={1}
          borderTop={true}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderStyle="single"
          borderColor={THEME.border}
          alignItems="center"
          flexDirection="column"
        >
          <Text color={THEME.dim}>
            Tip: Configure your run before starting the session.
          </Text>
          <Text color={THEME.dim}>Use ↑/↓ arrows to navigate, Enter to select</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default MainMenu;
