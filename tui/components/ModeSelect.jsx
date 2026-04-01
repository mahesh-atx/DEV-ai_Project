import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { THEME, MODES } from '../constants.js';

const ModeSelect = ({ onSelect, onBack }) => {
  const items = [
    ...MODES.map(m => ({ value: m.value, label: m.label, desc: m.desc })),
    { value: 'back', label: '← Back to Menu', desc: '' },
  ];

  const handleSelect = (item) => {
    if (item.value === 'back') onBack();
    else onSelect(MODES.find(m => m.value === item.value));
  };

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box borderStyle="round" borderColor={THEME.border} padding={2} flexDirection="column" width={72}>
        <Text color={THEME.accent} bold marginBottom={1}>Select Execution Mode</Text>
        <Box flexDirection="column" paddingX={2}>
          <SelectInput
            items={items}
            onSelect={handleSelect}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '❯ ' : '  '}</Text>
            )}
            itemComponent={({ isSelected, label, value }) => {
              if (value === 'back') return <Text color={THEME.dim}>{label}</Text>;
              const mode = MODES.find(m => m.value === value);
              return (
                <Box flexDirection="row">
                  <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                    {label.padEnd(14)}
                  </Text>
                  <Text color={THEME.dim}>{mode?.desc}</Text>
                </Box>
              );
            }}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default ModeSelect;
