import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../constants.js';

const PlanBox = ({ planItems = ['Plan generation in progress...'], quality = null }) => (
  <Box flexDirection="column" paddingX={2} marginBottom={1} marginTop={1}>
    <Box
      borderStyle="single"
      borderColor={THEME.accent}
      borderTop={true} borderBottom={true} borderLeft={false} borderRight={false}
      paddingY={1}
      flexDirection="column"
    >
      <Text bold color={THEME.text}>📋 IMPLEMENTATION PLAN</Text>
      <Box flexDirection="column" marginTop={1}>
        {planItems.map((item, i) => (
          <Text key={i} color={THEME.text}>
            <Text color={THEME.accent}>{i + 1}. </Text>{item}
          </Text>
        ))}
      </Box>
      {quality !== null && (
        <Box marginTop={1}>
          <Text color={THEME.text}>
            📊 Quality: <Text color={THEME.accent}>{'█'.repeat(Math.floor(quality / 10))}{'░'.repeat(10 - Math.floor(quality / 10))}</Text> {quality}%
          </Text>
        </Box>
      )}
    </Box>
  </Box>
);

export default PlanBox;
