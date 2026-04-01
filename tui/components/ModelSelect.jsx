import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { listModels } from '../../config/models.js';
import { THEME } from '../constants.js';

const ModelSelect = ({ onSelect, onBack }) => {
  const availableModels = listModels();
  const items = [
    ...availableModels.map(m => ({ value: m.key, label: m.name, desc: m.description })),
    { value: 'back', label: '← Back to Menu', desc: '' },
  ];

  const handleSelect = (item) => {
    if (item.value === 'back') onBack();
    else onSelect({ key: item.value, name: item.label, description: item.desc });
  };

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box borderStyle="round" borderColor={THEME.border} padding={2} flexDirection="column" width={72}>
        <Text color={THEME.accent} bold marginBottom={1}>Select AI Model</Text>
        <Box flexDirection="column" paddingX={2}>
          <SelectInput
            items={items}
            onSelect={handleSelect}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '❯ ' : '  '}</Text>
            )}
            itemComponent={({ isSelected, label, value }) => {
              if (value === 'back') return <Text color={THEME.dim}>{label}</Text>;
              const item = items.find(i => i.value === value);
              return (
                <Box flexDirection="row">
                  <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                    {label.padEnd(24)}
                  </Text>
                  <Text color={THEME.dim}>{item?.desc}</Text>
                </Box>
              );
            }}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default ModelSelect;
