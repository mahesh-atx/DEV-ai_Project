import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import PlanFollowupSelect from './PlanFollowupSelect.jsx';
import { useChatState } from './useChatState.js';
import { renderActivityClusters } from './chatRenderers.js';
import {
  COLORS,
  SPINNER_FRAMES,
  truncate,
  wrapText,
  ensureSpacer,
  findLatestLiveToolEntryId,
  findLatestVisibleCollapsibleId,
} from './chatUtils.js';

const ChatScreen = ({ mode, model, availableModes = [], availableModels = [], onModeChange, onModelChange, onExit }) => {
  const {
    dims,
    messages,
    input, setInput,
    isThinking,
    elapsedTime,
    showQuestions,
    showShortcuts,
    pickerState,
    handlePickerSelect,
    followLive,
    scrollOffset,
    setScrollOffset,
    expandedBlocks,
    streamLabel,
    streamResponseContent,
    activityLog,
    liveTick,
    liveStatus,
    pendingQuestion,
    pendingQuestionIndex,
    pendingQuestionManualEntry,
    planFollowup, setPlanFollowup, planFollowupResolverRef,
    currentActivityRef,
    visibleCollapsibleIdRef,
    handleSubmit,
    toggleLatestCollapsible,
    setShowQuestions,
    pushActivity,
  } = useChatState({ mode, model, availableModes, availableModels, onModeChange, onModelChange, onExit });

  const handleQuestionSelect = useCallback((item) => {
    setShowQuestions(false);
    if (item.value === 'CANCEL' || item.value === 'NONE') return;
    handleSubmit(item.value);
  }, [handleSubmit, setShowQuestions]);

  const questionItems = useMemo(() => {
    const items = [];
    [...new Set(messages.reduce((acc, msg) => {
      if (msg.type === 'user') acc.push(msg.text);
      return acc;
    }, []))].reverse().forEach((h, i) => items.push({ label: `[History]  ${truncate(h, 60)}`, value: h, key: `hist-${i}` }));
    if (items.length === 0) items.push({ label: 'No history available.', value: 'NONE', key: 'none' });
    items.push({ label: '<- Back to typing (Esc)', value: 'CANCEL', key: 'cancel' });
    return items;
  }, [messages]);

  const pickerItems = useMemo(() => {
    if (!pickerState) return [];
    const items = (pickerState.items || []).map((item, index) => ({
      label: item.label,
      value: item.value,
      key: item.key || `${pickerState.type}-${index}`,
      payload: item.payload,
    }));
    items.push({ label: '<- Back to chat (Esc)', value: 'CANCEL', key: `${pickerState.type}-cancel` });
    return items;
  }, [pickerState]);

  const spinnerFrame = SPINNER_FRAMES[liveTick % SPINNER_FRAMES.length];
  const showStreamingCursor = liveTick % 2 === 0;
  const modeIcon = mode?.value === 'ask'
    ? '?'
    : mode?.value === 'planner'
      ? '#'
      : mode?.value === 'polish'
        ? '+'
        : mode?.value === 'orchestrator'
          ? '@'
          : '>';
  const modelLabel = truncate(model?.name || model?.id || 'Unknown model', 28);
  const shortcuts = [
    '?: shortcuts',
    'Esc: stop run or close shortcuts',
    'Up/Down: scroll',
    'PgUp/PgDn: faster scroll',
    'Home/End: oldest or live tail',
    'Ctrl+Q: history',
    '/mode, /model, /build',
    '/git <msg>, undo',
  ];
  const activeToolEntryId = useMemo(() => (
    isThinking ? findLatestLiveToolEntryId(activityLog) : null
  ), [activityLog, isThinking]);
  const visibleLiveStatus = isThinking ? { kind: 'thinking', label: streamLabel } : liveStatus;
  const liveStatusColor = visibleLiveStatus?.kind === 'error'
    ? COLORS.red
    : visibleLiveStatus?.kind === 'success'
      ? COLORS.green
      : COLORS.orange;
  const liveStatusIcon = visibleLiveStatus?.kind === 'error'
    ? 'x'
    : visibleLiveStatus?.kind === 'success'
      ? 'ok'
      : spinnerFrame;

  const maxLineWidth = Math.max(20, dims.columns - 4);
  const previousLineCountRef = useRef(0);
  const allLines = useMemo(() => {
    let lines = [];

    const addTextWrapped = (text, defaultColor = COLORS.white, isBold = false) => {
      wrapText(text, maxLineWidth).forEach((line) => {
        lines.push({ segments: [{ text: line, color: defaultColor, bold: isBold }] });
      });
    };

    messages.forEach((msg) => {
      if (msg.type === 'system') {
        if (msg.id !== 'init') {
          addTextWrapped(msg.text, COLORS.dim);
          lines.push({ segments: [], empty: true });
        }
      } else if (msg.type === 'user') {
        wrapText(msg.text, maxLineWidth - 2).forEach((line, index) => {
          if (index === 0) {
            lines.push({ segments: [{ text: '> ', color: COLORS.orange, bold: true }, { text: line, color: COLORS.white, bold: true }] });
          } else {
            lines.push({ segments: [{ text: '  ' }, { text: line, color: COLORS.white, bold: true }] });
          }
        });
        lines.push({ segments: [], empty: true });
      } else {
        if (msg.activityLog && msg.activityLog.length > 0) {
          renderActivityClusters(msg.activityLog, lines, maxLineWidth, {}, expandedBlocks);
          ensureSpacer(lines);
        }

        if (msg.planFollowup && msg.planFollowup !== 'none') {
          const planContent = msg.text.replace(/^## Plan: .*\n\n/, '').replace(/\n\n---\n\n[\s\S]*$/, '').trim();
          lines.push({ segments: [{ text: 'PLAN COMPLETE', color: COLORS.orange, bold: true }] });
          addTextWrapped(planContent, COLORS.white);
          if (msg.planFollowup === 'implement') lines.push({ segments: [{ text: '-> Implementing in this session...', color: COLORS.green }] });
          else if (msg.planFollowup === 'new_session') lines.push({ segments: [{ text: '* Plan saved for next session.', color: COLORS.dim }] });
          lines.push({ segments: [], empty: true });
        } else if (msg.text) {
          let isDuplicate = false;
          if (msg.activityLog && msg.activityLog.length > 0) {
            const lastChat = msg.activityLog.slice().reverse().find((activity) => activity.kind === 'chat');
            if (lastChat && lastChat.text === msg.text) isDuplicate = true;
          }
          if (!isDuplicate && msg.text !== 'Agent completed.') {
            let inCodeBlock = false;
            const wrappedLines = [];

            wrapText(msg.text, maxLineWidth - 2).forEach((line) => {
              if (line.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
              wrappedLines.push({ text: line, color: inCodeBlock ? COLORS.code : COLORS.white });
            });

            wrappedLines.forEach((wrappedLine, index) => {
              if (index === 0) {
                lines.push({ segments: [{ text: '* ', color: COLORS.white }, { text: wrappedLine.text, color: wrappedLine.color }] });
              } else {
                lines.push({ segments: [{ text: '  ' }, { text: wrappedLine.text, color: wrappedLine.color }] });
              }
            });
            lines.push({ segments: [], empty: true });
          }
        }
      }
    });

    if (isThinking) {
      renderActivityClusters(activityLog, lines, maxLineWidth, { activeToolEntryId, spinnerFrame }, expandedBlocks);

      if (streamResponseContent) {
        lines.push({ segments: [], empty: true });
        let inCodeBlock = false;
        const wrappedLines = [];

        wrapText(streamResponseContent, maxLineWidth - 2).forEach((line) => {
          if (line.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
          wrappedLines.push({ text: line, color: inCodeBlock ? COLORS.code : COLORS.white });
        });

        wrappedLines.forEach((wrappedLine, index) => {
          if (index === 0) {
            lines.push({ segments: [{ text: '* ', color: COLORS.white }, { text: wrappedLine.text, color: wrappedLine.color }] });
          } else {
            lines.push({ segments: [{ text: '  ' }, { text: wrappedLine.text, color: wrappedLine.color }] });
          }
        });
        if (wrappedLines.length > 0 && lines.length > 0) {
          const lastStreamingLine = lines[lines.length - 1];
          if (lastStreamingLine?.segments) {
            lastStreamingLine.segments.push({ text: showStreamingCursor ? '_' : ' ', color: COLORS.dim });
          }
        }
      }
    }

    while (lines.length > 0 && lines[lines.length - 1].empty) {
      lines.pop();
    }
    return lines;
  }, [messages, isThinking, activityLog, streamResponseContent, maxLineWidth, expandedBlocks, activeToolEntryId, showStreamingCursor, spinnerFrame]);

  useEffect(() => {
    const previousCount = previousLineCountRef.current;
    if (!followLive && allLines.length > previousCount) {
      setScrollOffset((prev) => prev + (allLines.length - previousCount));
    }
    previousLineCountRef.current = allLines.length;
  }, [allLines.length, followLive, setScrollOffset]);

  let uiReservedLines = 4;
  if (visibleLiveStatus) uiReservedLines += 2;
  if (showShortcuts) uiReservedLines += shortcuts.length + 4;

  if (pendingQuestion) {
    const questionText = typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question;
    let questionLineCount = 0;
    questionText.split('\n').forEach((line) => {
      questionLineCount += wrapText(line, dims.columns - 4).length;
    });
    if (pendingQuestion.options?.length > 0) {
      questionLineCount += pendingQuestion.options.length + 2;
    }
    uiReservedLines += 3 + questionLineCount;
  }
  if (planFollowup) uiReservedLines += 5;

  const chatLinesAvailable = Math.max(5, dims.rows - uiReservedLines);
  const maxScroll = Math.max(0, allLines.length - chatLinesAvailable);
  const clampedScroll = Math.min(Math.max(0, scrollOffset), maxScroll);
  const startIndex = Math.max(0, allLines.length - chatLinesAvailable - clampedScroll);
  const visibleLines = allLines.slice(startIndex, startIndex + chatLinesAvailable);
  visibleCollapsibleIdRef.current = findLatestVisibleCollapsibleId(visibleLines);

  if (showQuestions) {
    return (
      <Box flexDirection="column" height={dims.rows} width="100%" alignItems="center" justifyContent="center" paddingX={1}>
        <Box borderStyle="round" borderColor={COLORS.dim} padding={2} flexDirection="column" width={72}>
          <Text color={COLORS.blue} bold marginBottom={1}>Select a Question</Text>
          <Box flexDirection="column" paddingX={2}>
            <SelectInput
              items={questionItems}
              onSelect={handleQuestionSelect}
              indicatorComponent={({ isSelected }) => <Text color={isSelected ? COLORS.blue : COLORS.dim}>{isSelected ? '> ' : '  '}</Text>}
              itemComponent={({ isSelected, label }) => <Text color={isSelected ? COLORS.white : COLORS.dim} bold={isSelected}>{label}</Text>}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  if (pickerState) {
    return (
      <Box flexDirection="column" height={dims.rows} width="100%" alignItems="center" justifyContent="center" paddingX={1}>
        <Box borderStyle="round" borderColor={COLORS.dim} padding={2} flexDirection="column" width={72}>
          <Text color={COLORS.blue} bold marginBottom={1}>{pickerState.title || 'Select an option'}</Text>
          <Box flexDirection="column" paddingX={2}>
            <SelectInput
              items={pickerItems}
              onSelect={handlePickerSelect}
              indicatorComponent={({ isSelected }) => <Text color={isSelected ? COLORS.blue : COLORS.dim}>{isSelected ? '> ' : '  '}</Text>}
              itemComponent={({ isSelected, label }) => <Text color={isSelected ? COLORS.white : COLORS.dim} bold={isSelected}>{label}</Text>}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={dims.rows} width="100%" paddingX={1}>
      {scrollOffset > 0 && (
        <Box flexDirection="row" paddingX={1} paddingBottom={1} justifyContent="flex-end">
          <Text color={COLORS.dim} bold>^ Scrolled {clampedScroll} ^</Text>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="column" overflowY="hidden" paddingX={1} paddingTop={0}>
        {visibleLines.map((line, index) => (
          <Box key={index} flexDirection="row">
            {line.empty ? (
              <Text> </Text>
            ) : null}
            {line.segments?.map((seg, segmentIndex) => (
              <Text
                key={segmentIndex}
                color={seg.color}
                backgroundColor={seg.backgroundColor}
                bold={seg.bold}
              >
                {seg.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>

      {visibleLiveStatus && (
        <Box flexDirection="row" paddingX={1} marginBottom={1} marginTop={1}>
          <Text color={liveStatusColor}>{liveStatusIcon} {visibleLiveStatus.label}... </Text>
          {isThinking ? <Text color={COLORS.dim}>({elapsedTime}s | esc to interrupt)</Text> : null}
        </Box>
      )}

      {pendingQuestion && (
        <Box flexDirection="column" borderStyle="round" borderColor={pendingQuestion.title?.includes('Warning') ? COLORS.red : COLORS.blue} paddingX={1} marginX={1} marginBottom={1}>
          <Text color={pendingQuestion.title?.includes('Warning') ? COLORS.red : COLORS.blue} bold>{pendingQuestion.title || 'Action Required'}</Text>
          <Box flexDirection="column" marginTop={1} marginBottom={0}>
            {(typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question).split('\n').map((line, index) => (
              <Text key={index} color={COLORS.dim}>{line}</Text>
            ))}
            {pendingQuestion.options?.length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
                {pendingQuestion.options.map((option, index) => (
                  <Text
                    key={option}
                    color={index === pendingQuestionIndex && !pendingQuestionManualEntry ? COLORS.white : COLORS.dim}
                    bold={index === pendingQuestionIndex && !pendingQuestionManualEntry}
                  >
                    {index === pendingQuestionIndex && !pendingQuestionManualEntry ? '> ' : '  '}{option}
                  </Text>
                ))}
                <Text
                  color={pendingQuestionIndex === pendingQuestion.options.length && !pendingQuestionManualEntry ? COLORS.white : COLORS.dim}
                  bold={pendingQuestionIndex === pendingQuestion.options.length && !pendingQuestionManualEntry}
                >
                  {pendingQuestionIndex === pendingQuestion.options.length && !pendingQuestionManualEntry ? '> ' : '  '}Type your answer
                </Text>
                <Text color={COLORS.dim}>
                  {pendingQuestionManualEntry ? 'Type below and press Enter. Esc returns to choices.' : 'Use arrows and Enter'}
                </Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      )}

      {planFollowup && !isThinking && (
        <Box flexDirection="column" marginX={1} marginBottom={1}>
          <PlanFollowupSelect
            planFile={planFollowup.planFile}
            onSelect={(action) => {
              if (planFollowupResolverRef.current) {
                const resolver = planFollowupResolverRef.current;
                planFollowupResolverRef.current = null;
                resolver(action);
              }
            }}
          />
        </Box>
      )}

      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor={COLORS.dim} paddingX={1} flexDirection="row">
          <Box marginRight={1}>
            <Text color={COLORS.white} bold>{'>'}</Text>
          </Box>
          <Box flexGrow={1}>
            <TextInput
              value={input}
              onChange={(val) => {
                if (!isThinking || pendingQuestion) setInput(val);
              }}
              onSubmit={handleSubmit}
              placeholder={pendingQuestion ? (pendingQuestion.options?.length > 0 ? (pendingQuestionManualEntry ? 'Type your answer...' : '') : 'Type your answer...') : ''}
              focus={!isThinking || (pendingQuestion && (pendingQuestionManualEntry || !pendingQuestion.options?.length))}
              showCursor
            />
          </Box>
        </Box>
      </Box>

      {showShortcuts && (
        <Box flexDirection="column" borderStyle="round" borderColor={COLORS.dim} paddingX={1} marginX={1} marginTop={1} marginBottom={1}>
          <Text color={COLORS.white} bold>Shortcuts</Text>
          {shortcuts.map((shortcut) => (
            <Text key={shortcut} color={COLORS.dim}>{shortcut}</Text>
          ))}
        </Box>
      )}

      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row">
          {showShortcuts ? (
            <Text color={COLORS.dim}>Esc to close shortcuts</Text>
          ) : (
            <>
              <Text color={COLORS.orange}>?</Text>
              <Text color={COLORS.dim}> for shortcuts</Text>
            </>
          )}
        </Box>
        <Box flexDirection="row">
          <Text color={COLORS.orange}>{modeIcon}</Text>
          <Text color={COLORS.dim}>{` ${mode?.label || 'Mode'}   `}</Text>
          <Text color={COLORS.orange}>*</Text>
          <Text color={COLORS.dim}>{` ${modelLabel}`}</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default ChatScreen;
