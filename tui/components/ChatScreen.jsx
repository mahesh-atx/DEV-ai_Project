import React, { useCallback, useMemo } from 'react';
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

const ChatScreen = ({ mode, model, onExit }) => {
  const {
    dims,
    messages,
    input, setInput,
    isThinking,
    elapsedTime,
    showQuestions,
    scrollOffset,
    expandedBlocks,
    streamLabel,
    streamResponseContent,
    activityLog,
    liveTick,
    liveStatus,
    pendingQuestion,
    planFollowup, setPlanFollowup, planFollowupResolverRef,
    currentActivityRef,
    visibleCollapsibleIdRef,
    handleSubmit,
    toggleLatestCollapsible,
    setShowQuestions,
    pushActivity,
  } = useChatState({ mode, model, onExit });

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
    items.push({ label: '← Back to typing (Esc)', value: 'CANCEL', key: 'cancel' });
    return items;
  }, [messages]);

  const spinnerFrame = SPINNER_FRAMES[liveTick % SPINNER_FRAMES.length];
  const showStreamingCursor = liveTick % 2 === 0;
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
    ? '×'
    : visibleLiveStatus?.kind === 'success'
      ? '✓'
      : spinnerFrame;

  const maxLineWidth = Math.max(20, dims.columns - 4);
  const allLines = useMemo(() => {
    let lines = [];

    const addTextWrapped = (text, defaultColor = COLORS.white, isBold = false) => {
       wrapText(text, maxLineWidth).forEach(l => {
           lines.push({ segments: [{ text: l, color: defaultColor, bold: isBold }] });
       });
    };

    messages.forEach((msg) => {
      if (msg.type === 'system') {
         if (msg.id !== 'init') {
            addTextWrapped(msg.text, COLORS.dim);
            lines.push({ segments: [], empty: true });
         }
      } else if (msg.type === 'user') {
         addTextWrapped(`> ${msg.text}`, COLORS.white, true);
         lines.push({ segments: [], empty: true });
      } else {
         if (msg.activityLog && msg.activityLog.length > 0) {
             renderActivityClusters(msg.activityLog, lines, maxLineWidth, {}, expandedBlocks);
             ensureSpacer(lines);
         }

         if (msg.planFollowup && msg.planFollowup !== 'none') {
             const planContent = msg.text.replace(/^## Plan: .*\n\n/, '').replace(/\n\n---\n\n[\s\S]*$/, '').trim();
             lines.push({ segments: [{ text: '✓ PLAN COMPLETE', color: COLORS.orange, bold: true }] });
             addTextWrapped(planContent, COLORS.white);
             if (msg.planFollowup === 'implement') lines.push({ segments: [{ text: '→ Implementing in this session...', color: COLORS.green }] });
             else if (msg.planFollowup === 'new_session') lines.push({ segments: [{ text: '✦ Plan saved for next session.', color: COLORS.dim }] });
             lines.push({ segments: [], empty: true });
         } else if (msg.text) {
             let isDuplicate = false;
             if (msg.activityLog && msg.activityLog.length > 0) {
                 const lastChat = msg.activityLog.slice().reverse().find(a => a.kind === 'chat');
                 if (lastChat && lastChat.text === msg.text) isDuplicate = true;
             }
             if (!isDuplicate && msg.text !== 'Agent completed.') {
                 let inCodeBlock = false;
                 const wrappedLines = [];

                 wrapText(msg.text, maxLineWidth - 2).forEach(l => {
                     if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
                     let color = inCodeBlock ? COLORS.code : COLORS.white;
                     wrappedLines.push({ text: l, color });
                 });

                 wrappedLines.forEach((wl, i) => {
                     if (i === 0) {
                         lines.push({ segments: [
                             { text: '● ', color: COLORS.white },
                             { text: wl.text, color: wl.color }
                         ]});
                     } else {
                         lines.push({ segments: [
                             { text: '  ' },
                             { text: wl.text, color: wl.color }
                         ]});
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

           wrapText(streamResponseContent, maxLineWidth - 2).forEach(l => {
               if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
               wrappedLines.push({ text: l, color: inCodeBlock ? COLORS.code : COLORS.white });
           });

           wrappedLines.forEach((wl, i) => {
               if (i === 0) {
                   lines.push({ segments: [{ text: '● ', color: COLORS.white }, { text: wl.text, color: wl.color }] });
               } else {
                   lines.push({ segments: [{ text: '  ' }, { text: wl.text, color: wl.color }] });
               }
            });
            if (wrappedLines.length > 0 && lines.length > 0) {
                const lastStreamingLine = lines[lines.length - 1];
                if (lastStreamingLine?.segments) {
                    lastStreamingLine.segments.push({ text: showStreamingCursor ? '▋' : ' ', color: COLORS.dim });
                }
            }
        }
    }

    while (lines.length > 0 && lines[lines.length - 1].empty) {
        lines.pop();
    }
    return lines;
  }, [messages, isThinking, activityLog, streamResponseContent, maxLineWidth, expandedBlocks, activeToolEntryId, showStreamingCursor, spinnerFrame]);

  let uiReservedLines = 4;
  if (visibleLiveStatus) uiReservedLines += 2;

  if (pendingQuestion) {
      const qStr = typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question;
      let qLinesCount = 0;
      qStr.split('\n').forEach(line => {
        qLinesCount += wrapText(line, dims.columns - 4).length;
      });
      uiReservedLines += 3 + qLinesCount;
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
              indicatorComponent={({ isSelected }) => <Text color={isSelected ? COLORS.blue : COLORS.dim}>{isSelected ? '❯ ' : '  '}</Text>}
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
           <Text color={COLORS.dim} bold>↑ Scrolled {clampedScroll} ↑</Text>
        </Box>
      )}

      {/* Scrollable Log History Area */}
      <Box flexGrow={1} flexDirection="column" overflowY="hidden" paddingX={1} paddingTop={0}>
        {visibleLines.map((line, index) => (
          <Box key={index} flexDirection="row">
             {line.empty ? (
               <Text> </Text>
             ) : null}
             {line.segments?.map((seg, sIdx) => (
                <Text
                  key={sIdx}
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

      {/* Live Status Tracker */}
      {visibleLiveStatus && (
        <Box flexDirection="row" paddingX={1} marginBottom={1} marginTop={1}>
           <Text color={liveStatusColor}>{liveStatusIcon} {visibleLiveStatus.label}... </Text>
           {isThinking ? <Text color={COLORS.dim}>({elapsedTime}s · esc to interrupt)</Text> : null}
        </Box>
      )}

      {/* Permission Box overlay */}
      {pendingQuestion && (
        <Box flexDirection="column" borderStyle="round" borderColor={pendingQuestion.title?.includes('Warning') ? COLORS.red : COLORS.blue} paddingX={1} marginX={1} marginBottom={1}>
          <Text color={pendingQuestion.title?.includes('Warning') ? COLORS.red : COLORS.blue} bold>{pendingQuestion.title || 'Action Required'}</Text>
          <Box flexDirection="column" marginTop={1} marginBottom={0}>
            {(typeof pendingQuestion === 'string' ? pendingQuestion : pendingQuestion.question).split('\n').map((line, i) => {
              const isOption = line.trim().startsWith('>');
              return <Text key={i} color={isOption ? COLORS.white : COLORS.dim} bold={isOption}>{line}</Text>;
            })}
          </Box>
        </Box>
      )}

      {/* Plan Selection Overlay */}
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

      {/* Main Input Box */}
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
              placeholder={pendingQuestion ? (pendingQuestion.options?.length > 0 ? 'Type a number or your answer...' : 'Type your answer...') : ''}
              focus={!isThinking || pendingQuestion}
              showCursor
            />
          </Box>
        </Box>
      </Box>

      {/* Footer */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text color={COLORS.dim}>? for shortcuts</Text>
      </Box>

    </Box>
  );
};

export default ChatScreen;
