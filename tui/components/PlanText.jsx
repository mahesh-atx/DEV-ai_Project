import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../constants.js';

function getTerminalWidth() {
  try { return process.stdout.columns || 100; } catch { return 100; }
}

function wrapLine(text, maxWidth) {
  if (text.length <= maxWidth) return [text];
  const lines = [];
  let current = '';
  const words = text.split(' ');
  for (const word of words) {
    if ((current + word).length > maxWidth && current) {
      lines.push(current.trim());
      current = word + ' ';
    } else {
      current += word + ' ';
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.length ? lines : [text];
}

function parseMarkdownLines(text) {
  const lines = text.split('\n');
  const elements = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { elements.push({ type: 'blank' }); continue; }
    if (trimmed.startsWith('# ')) { elements.push({ type: 'h1', text: trimmed.slice(2) }); continue; }
    if (trimmed.startsWith('## ')) { elements.push({ type: 'h2', text: trimmed.slice(3) }); continue; }
    if (trimmed.startsWith('### ')) { elements.push({ type: 'h3', text: trimmed.slice(4) }); continue; }
    if (trimmed.startsWith('#### ')) { elements.push({ type: 'h4', text: trimmed.slice(5) }); continue; }
    if (/^[-*_]{3,}$/.test(trimmed)) { elements.push({ type: 'hr' }); continue; }
    if (/^[-*]\s/.test(trimmed)) { elements.push({ type: 'li', text: trimmed.replace(/^[-*]\s/, '') }); continue; }
    if (/^\d+\.\s/.test(trimmed)) { elements.push({ type: 'li', text: trimmed.replace(/^\d+\.\s/, '') }); continue; }
    if (trimmed.includes('|') && trimmed.startsWith('|')) {
      if (/^\|[\s-:|]+\|$/.test(trimmed)) continue;
      const cells = trimmed.split('|').filter(c => c.trim());
      elements.push({ type: 'table-row', cells: cells.map(c => c.trim()) });
      continue;
    }
    if (trimmed.startsWith('> ')) { elements.push({ type: 'quote', text: trimmed.slice(2) }); continue; }
    if (trimmed.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++; }
      elements.push({ type: 'code', lines: codeLines });
      continue;
    }
    if (/\*\*.*\*\*/.test(trimmed)) { elements.push({ type: 'text-bold', text: trimmed }); continue; }
    elements.push({ type: 'text', text: trimmed });
  }
  return elements;
}

function renderInlineParts(text) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push({ type: 'normal', text: text.slice(lastIdx, match.index) });
    if (match[1]) parts.push({ type: 'bold', text: match[1].replace(/\*\*/g, '') });
    else if (match[2]) parts.push({ type: 'code', text: match[2].replace(/`/g, '') });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push({ type: 'normal', text: text.slice(lastIdx) });
  return parts.length ? parts : [{ type: 'normal', text }];
}

const PlanText = ({ text, maxWidth }) => {
  const width = maxWidth || Math.min(getTerminalWidth() - 6, 120);
  const elements = parseMarkdownLines(text);

  return (
    <Box flexDirection="column">
      {elements.map((el, i) => {
        switch (el.type) {
          case 'blank':
            return <Text key={i}> </Text>;
          case 'h1':
            return (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text color={THEME.accent} bold>{el.text}</Text>
                <Text color={THEME.accent}>{'═'.repeat(Math.min(el.text.length, width))}</Text>
              </Box>
            );
          case 'h2':
            return (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text color={THEME.text} bold>{el.text}</Text>
                <Text color={THEME.dim}>{'─'.repeat(Math.min(el.text.length, width))}</Text>
              </Box>
            );
          case 'h3':
            return <Text key={i} color={THEME.text} bold marginTop={1}>  {el.text}</Text>;
          case 'h4':
            return <Text key={i} color={THEME.dim} bold>    {el.text}</Text>;
          case 'hr':
            return <Text key={i} color={THEME.border}>{'─'.repeat(Math.min(width, 80))}</Text>;
          case 'li':
            return <Text key={i} color={THEME.text}>  • {el.text}</Text>;
          case 'table-row':
            return (
              <Box key={i} flexDirection="row">
                {el.cells.map((cell, ci) => (
                  <Text key={ci} color={THEME.text}>{ci === 0 ? '│ ' : ' │ '}{cell.padEnd(Math.min(cell.length + 4, 25))}</Text>
                ))}
                <Text>│</Text>
              </Box>
            );
          case 'quote':
            return <Text key={i} color={THEME.dim}>  ▎ {el.text}</Text>;
          case 'code':
            return (
              <Box key={i} flexDirection="column" marginX={1}>
                {el.lines.map((codeLine, ci) => (
                  <Text key={ci} color={THEME.warning}>  {codeLine}</Text>
                ))}
              </Box>
            );
          case 'text-bold': {
            const parts = renderInlineParts(el.text);
            return (
              <Text key={i}>
                {parts.map((p, pi) => (
                  p.type === 'bold' ? <Text key={pi} bold>{p.text}</Text> :
                  p.type === 'code' ? <Text key={pi} color={THEME.warning}>{p.text}</Text> :
                  <Text key={pi}>{p.text}</Text>
                ))}
              </Text>
            );
          }
          case 'text': {
            const wrapped = wrapLine(el.text, width);
            return (
              <React.Fragment key={i}>
                {wrapped.map((w, wi) => <Text key={wi}>{w}</Text>)}
              </React.Fragment>
            );
          }
          default:
            return <Text key={i}>{el.text || ''}</Text>;
        }
      })}
    </Box>
  );
};

export default PlanText;
