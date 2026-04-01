import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../constants.js';

function truncateRight(text, max = 200) {
  const str = String(text || '');
  if (str.length <= max) return str;
  return '...' + str.slice(-max);
}

const StreamingPanel = ({ label = 'Generating', percent = 0, chars = 0, thinkingChars = 0, thinkingContent = '', responseContent = '', files = [], elapsed = '0.0' }) => {
  const barWidth = 24;
  const filled = Math.min(barWidth, Math.round((percent / 100) * barWidth));
  const bar = '#'.repeat(filled) + '-'.repeat(barWidth - filled);

  const thinkingPreview = truncateRight(thinkingContent, 250);
  const responsePreview = truncateRight(responseContent, 300);

  return (
    <Box flexDirection="column" paddingX={2} marginBottom={1}>
      {percent < 60 && thinkingPreview && (
        <Box
          flexDirection="column"
          marginBottom={1}
          borderStyle="round"
          borderColor={THEME.dim}
          paddingX={1}
        >
          <Text color={THEME.accent} bold>Thinking & Orchestrating</Text>
          <Text color={THEME.dim}>{thinkingPreview}</Text>
        </Box>
      )}

      {percent >= 60 && responsePreview && (
        <Box
          flexDirection="column"
          marginBottom={1}
          borderStyle="round"
          borderColor={THEME.dim}
          paddingX={1}
        >
          <Text color={THEME.accent} bold>Response</Text>
          <Text color={THEME.dim}>{responsePreview}</Text>
        </Box>
      )}

      <Box flexDirection="row">
        <Text color={THEME.accent}>{label} </Text>
        <Text color={THEME.accent}>{bar} </Text>
        <Text color={THEME.text}>{Math.floor(percent)}%</Text>
      </Box>

      <Box>
        <Text color={THEME.dim}>
          chars {chars.toLocaleString()}  |  thinking {thinkingChars.toLocaleString()}  |  files {files.length}  |  time {elapsed}s
        </Text>
      </Box>

      {files.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={THEME.accent} bold>Files detected</Text>
          {files.map((file) => (
            <Text key={file} color={THEME.dim}>  {file}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default StreamingPanel;
