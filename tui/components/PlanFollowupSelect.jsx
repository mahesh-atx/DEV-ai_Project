import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { THEME } from '../constants.js';

const PLAN_FOLLOWUP_OPTIONS = [
  { value: 'implement', label: 'Implement in this session', desc: 'Switch to code mode and execute the plan' },
  { value: 'new_session', label: 'Start fresh session', desc: 'Open a clean session with the saved plan' },
  { value: 'revise', label: 'Revise plan', desc: 'Give feedback and update the plan' },
  { value: 'dismissed', label: 'Save and exit', desc: 'Keep the plan and return to chat' },
];

const PlanFollowupSelect = ({ planFile, onSelect }) => {
  const items = PLAN_FOLLOWUP_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    desc: option.desc,
  }));

  return (
    <Box flexDirection="column" paddingX={2} width="100%">
      <Box borderStyle="round" borderColor={THEME.warning} paddingX={2} paddingY={1} flexDirection="column">
        <Text color={THEME.warning} bold>Plan Complete</Text>
        <Text color={THEME.dim}>Saved: {planFile}</Text>
        <Text color={THEME.text}>What would you like to do next?</Text>
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => onSelect(item.value)}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '> ' : '  '}</Text>
            )}
            itemComponent={({ isSelected, label, value }) => {
              const option = PLAN_FOLLOWUP_OPTIONS.find((entry) => entry.value === value);
              return (
                <Box flexDirection="row">
                  <Text color={isSelected ? THEME.text : THEME.dim} backgroundColor={isSelected ? THEME.border : undefined} bold={isSelected}>
                    {label}
                  </Text>
                  <Text color={THEME.dim}> - {option?.desc}</Text>
                </Box>
              );
            }}
          />
        </Box>
        <Text color={THEME.dim} marginTop={1}>Use arrows and Enter</Text>
      </Box>
    </Box>
  );
};

export { PLAN_FOLLOWUP_OPTIONS };
export default PlanFollowupSelect;
