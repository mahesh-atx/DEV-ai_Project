import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { listModels } from '../../config/models.js';
import { THEME } from '../constants.js';

const PROVIDER_ORDER = ['nvidia', 'openrouter'];
const ROLE_ORDER = ['agent', 'coding', 'reasoning', 'general'];

function compareModels(left, right) {
  const providerDelta = PROVIDER_ORDER.indexOf(left.provider) - PROVIDER_ORDER.indexOf(right.provider);
  if (providerDelta !== 0) return providerDelta;

  if (left.configured !== right.configured) return left.configured ? -1 : 1;

  const roleDelta = ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role);
  if (roleDelta !== 0) return roleDelta;

  return left.name.localeCompare(right.name);
}

function formatCount(value) {
  if (!value && value !== 0) return 'n/a';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function clampLabel(text, width) {
  if (!text) return '';
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function wrapText(text, width) {
  if (!text) return [''];
  if (width <= 0) return [text];

  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current) lines.push(current);

    if (word.length <= width) {
      current = word;
      continue;
    }

    let remainder = word;
    while (remainder.length > width) {
      lines.push(remainder.slice(0, width - 1) + '…');
      remainder = remainder.slice(width - 1);
    }
    current = remainder;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function moveSelection(rows, startIndex, direction) {
  let index = startIndex;
  while (index >= 0 && index < rows.length) {
    if (rows[index]?.type === 'model' || rows[index]?.type === 'action') {
      return index;
    }
    index += direction;
  }
  return startIndex;
}

const ModelSelect = ({ onSelect, onBack }) => {
  const { stdout } = useStdout();
  const availableModels = useMemo(() => [...listModels()].sort(compareModels), []);

  const rows = useMemo(() => {
    const grouped = [];

    for (const provider of PROVIDER_ORDER) {
      const models = availableModels.filter((entry) => entry.provider === provider);
      if (models.length === 0) continue;

      grouped.push({
        type: 'header',
        key: `header-${provider}`,
        label: provider === 'nvidia' ? 'NVIDIA Build' : 'OpenRouter',
      });

      for (const model of models) {
        grouped.push({
          type: 'model',
          key: model.key,
          model,
        });
      }
    }

    grouped.push({
      type: 'action',
      key: 'back',
      label: 'Back to Menu',
    });

    return grouped;
  }, [availableModels]);

  const firstSelectableIndex = rows.findIndex((row) => row.type === 'model' || row.type === 'action');
  const [selectedIndex, setSelectedIndex] = useState(firstSelectableIndex >= 0 ? firstSelectableIndex : 0);

  const selectedRow = rows[selectedIndex];
  const selectedModel = selectedRow?.type === 'model' ? selectedRow.model : null;

  const visibleCount = Math.max(8, Math.min(14, (stdout?.rows || 24) - 12));
  const maxStart = Math.max(0, rows.length - visibleCount);
  const scrollStart = Math.min(
    maxStart,
    Math.max(0, selectedIndex - Math.floor(visibleCount / 2))
  );
  const visibleRows = rows.slice(scrollStart, scrollStart + visibleCount);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((current) => moveSelection(rows, current - 1, -1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((current) => moveSelection(rows, current + 1, 1));
      return;
    }

    if (key.pageUp) {
      setSelectedIndex((current) => moveSelection(rows, Math.max(0, current - visibleCount), -1));
      return;
    }

    if (key.pageDown) {
      setSelectedIndex((current) => moveSelection(rows, Math.min(rows.length - 1, current + visibleCount), 1));
      return;
    }

    if (key.home) {
      setSelectedIndex(moveSelection(rows, 0, 1));
      return;
    }

    if (key.end) {
      setSelectedIndex(moveSelection(rows, rows.length - 1, -1));
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }

    if (key.return) {
      if (selectedRow?.type === 'action') {
        onBack();
        return;
      }

      if (selectedRow?.type === 'model') {
        onSelect({
          key: selectedRow.model.key,
          name: selectedRow.model.name,
          description: selectedRow.model.description,
        });
      }
    }
  });

  const detailWidth = 48;
  const descriptionLines = wrapText(selectedModel?.description || 'Select a model to view details.', detailWidth);
  const idLines = wrapText(selectedModel?.id || '', detailWidth);

  return (
    <Box flexDirection="column" padding={2} width="100%" alignItems="center">
      <Box borderStyle="round" borderColor={THEME.border} padding={2} flexDirection="column" width={110}>
        <Text color={THEME.accent} bold marginBottom={1}>Select AI Model</Text>

        <Box flexDirection="row" gap={3}>
          <Box flexDirection="column" width={42}>
            <Text color={THEME.dim}>Models</Text>
            <Box
              marginTop={1}
              paddingX={1}
              paddingY={1}
              borderStyle="single"
              borderColor={THEME.border}
              flexDirection="column"
              minHeight={visibleCount + 2}
            >
              {visibleRows.map((row, offset) => {
                const actualIndex = scrollStart + offset;

                if (row.type === 'header') {
                  return (
                    <Box key={row.key} marginTop={offset === 0 ? 0 : 1}>
                      <Text color={THEME.warning} bold>{row.label}</Text>
                    </Box>
                  );
                }

                if (row.type === 'action') {
                  const isSelected = actualIndex === selectedIndex;
                  return (
                    <Text key={row.key} color={isSelected ? THEME.accent : THEME.dim} bold={isSelected}>
                      {isSelected ? '> ' : '  '}Back to Menu
                    </Text>
                  );
                }

                const isSelected = actualIndex === selectedIndex;
                const statusColor = row.model.configured ? THEME.success : THEME.dim;
                const statusText = row.model.configured ? 'ready' : 'setup';
                const label = clampLabel(row.model.name, 28);

                return (
                  <Box key={row.key} flexDirection="row" justifyContent="space-between">
                    <Text color={isSelected ? THEME.accent : THEME.text} bold={isSelected}>
                      {isSelected ? '> ' : '  '}{label}
                    </Text>
                    <Text color={statusColor}>{statusText}</Text>
                  </Box>
                );
              })}
            </Box>

            <Box marginTop={1}>
              <Text color={THEME.dim}>
                {rows.length > visibleCount ? `Showing ${scrollStart + 1}-${Math.min(rows.length, scrollStart + visibleCount)} of ${rows.length}` : `${rows.length} items`}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" width={56}>
            <Text color={THEME.dim}>Details</Text>
            <Box
              marginTop={1}
              paddingX={2}
              paddingY={1}
              borderStyle="single"
              borderColor={THEME.border}
              flexDirection="column"
              minHeight={visibleCount + 2}
            >
              {selectedModel ? (
                <>
                  <Text color={THEME.accent} bold>{selectedModel.name}</Text>
                  <Box marginTop={1}>
                    <Text color={THEME.text}>Provider: </Text>
                    <Text color={THEME.dim}>{selectedModel.providerName}</Text>
                  </Box>
                  <Box>
                    <Text color={THEME.text}>Status: </Text>
                    <Text color={selectedModel.configured ? THEME.success : THEME.warning}>
                      {selectedModel.configured ? 'Configured' : 'Needs API key setup'}
                    </Text>
                  </Box>
                  <Box>
                    <Text color={THEME.text}>Role: </Text>
                    <Text color={THEME.dim}>{selectedModel.role}</Text>
                    <Text color={THEME.text}>  Speed: </Text>
                    <Text color={THEME.dim}>{selectedModel.speed}</Text>
                  </Box>
                  <Box>
                    <Text color={THEME.text}>Context: </Text>
                    <Text color={THEME.dim}>{formatCount(selectedModel.contextLimit)}</Text>
                    <Text color={THEME.text}>  Max output: </Text>
                    <Text color={THEME.dim}>{formatCount(selectedModel.maxTokens)}</Text>
                  </Box>
                  <Box>
                    <Text color={THEME.text}>Thinking: </Text>
                    <Text color={THEME.dim}>{selectedModel.supportsThinking ? 'Yes' : 'No'}</Text>
                    <Text color={THEME.text}>  Vision: </Text>
                    <Text color={THEME.dim}>{selectedModel.isMultimodal ? 'Yes' : 'No'}</Text>
                  </Box>

                  <Box marginTop={1} flexDirection="column">
                    <Text color={THEME.text}>Model ID</Text>
                    {idLines.map((line, index) => (
                      <Text key={`id-${index}`} color={THEME.dim}>{line}</Text>
                    ))}
                  </Box>

                  <Box marginTop={1} flexDirection="column">
                    <Text color={THEME.text}>Description</Text>
                    {descriptionLines.map((line, index) => (
                      <Text key={`desc-${index}`} color={THEME.dim}>{line}</Text>
                    ))}
                  </Box>
                </>
              ) : (
                <Text color={THEME.dim}>Press Enter to go back.</Text>
              )}
            </Box>
          </Box>
        </Box>

        <Box
          marginTop={2}
          paddingTop={1}
          borderTop
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderStyle="single"
          borderColor={THEME.border}
          flexDirection="column"
          alignItems="center"
        >
          <Text color={THEME.dim}>Use arrows, PgUp/PgDn, Home/End to scroll. Press Enter to select.</Text>
          <Text color={THEME.dim}>Configured models are marked `ready`. Press Esc to go back.</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default ModelSelect;
