import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { THEME } from '../constants.js';

const PLAN_FOLLOWUP_OPTIONS = [
  { value: 'implement', label: 'Implement in this session', desc: 'Switch to code mode and execute the plan', icon: '▶' },
  { value: 'new_session', label: 'Start fresh session', desc: 'New session with plan + handover context', icon: '✦' },
  { value: 'revise', label: 'Revise plan', desc: 'Provide feedback to improve the plan', icon: '↻' },
  { value: 'dismissed', label: 'Save and exit', desc: 'Plan is saved, return to chat', icon: '✕' },
];

const PlanFollowupSelect = ({ planFile, onSelect }) => {
  const items = [
    ...PLAN_FOLLOWUP_OPTIONS.map(opt => ({
      value: opt.value,
      label: opt.label,
      desc: opt.desc,
      icon: opt.icon,
    })),
  ];

  return (
    <Box flexDirection="column" paddingX={2} width="100%">
      <Box borderStyle="round" borderColor={THEME.warning} paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="column">
        <Text color={THEME.warning} bold>✓ PLAN COMPLETE</Text>
        <Text color={THEME.dim}>  Saved: {planFile}</Text>
        <Text color={THEME.text}>  What would you like to do next?</Text>
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => onSelect(item.value)}
            indicatorComponent={({ isSelected }) => (
              <Text color={isSelected ? THEME.accent : THEME.dim}>{isSelected ? '❯ ' : '  '}</Text>
            )}
            itemComponent={({ isSelected, label, value }) => {
              const opt = PLAN_FOLLOWUP_OPTIONS.find(o => o.value === value);
              return (
                <Box flexDirection="row">
                  <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                    {opt?.icon} {label}
                  </Text>
                  <Text color={THEME.dim}> — {opt?.desc}</Text>
                </Box>
              );
            }}
          />
        </Box>
      </Box>
    </Box>
  );
};

export { PLAN_FOLLOWUP_OPTIONS };
export default PlanFollowupSelect;
