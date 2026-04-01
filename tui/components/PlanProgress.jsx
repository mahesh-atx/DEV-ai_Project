import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../constants.js';

const PHASES = [
  { key: 'explore', label: 'Explore' },
  { key: 'design', label: 'Design' },
  { key: 'review', label: 'Review' },
  { key: 'write', label: 'Write' },
  { key: 'done', label: 'Done' },
];

const PlanProgress = ({
  currentPhase = 'explore',
  percent = 0,
  filesExplored = 0,
  questionsAsked = 0,
  toolsUsed = 0,
  elapsed = '0.0',
  phaseStatus = '',
}) => {
  const currentIdx = PHASES.findIndex(p => p.key === currentPhase);
  const barWidth = 28;
  const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth));
  const bar = '#'.repeat(filled) + '-'.repeat(barWidth - filled);

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={1}>
      {/* Phase Tracker */}
      <Box flexDirection="row" marginBottom={1} flexWrap="wrap">
        {PHASES.map((phase, i) => (
          <React.Fragment key={phase.key}>
            <Text
              color={i < currentIdx ? THEME.success : i === currentIdx ? THEME.accent : THEME.dim}
              bold={i === currentIdx}
            >
              {i < currentIdx ? '✓' : i === currentIdx ? '●' : '○'} {phase.label}
            </Text>
            {i < PHASES.length - 1 && (
              <Text color={i < currentIdx ? THEME.success : THEME.dim}> → </Text>
            )}
          </React.Fragment>
        ))}
      </Box>

      {/* Phase Status */}
      {phaseStatus && (
        <Box marginBottom={1}>
          <Text color={THEME.dim}>  {phaseStatus}</Text>
        </Box>
      )}

      {/* Progress Bar */}
      <Box flexDirection="row">
        <Text color={THEME.accent}>{bar} </Text>
        <Text color={THEME.text}>{Math.floor(percent)}%</Text>
      </Box>

      {/* Stats */}
      <Box>
        <Text color={THEME.dim}>
          Files: {filesExplored}  |  Questions: {questionsAsked}  |  Tools: {toolsUsed}  |  Time: {elapsed}s
        </Text>
      </Box>
    </Box>
  );
};

export default PlanProgress;
