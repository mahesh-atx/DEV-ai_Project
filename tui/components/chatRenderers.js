import {
  COLORS,
  wrapText,
  ensureSpacer,
  isTopLevelActivity,
} from './chatUtils.js';

export function renderActivityEntry(entry, linesArray, maxW, liveRenderState = {}, expandedBlocks) {
    if (entry.kind === 'chat') {
        let inCodeBlock = false;
        wrapText(entry.text, maxW - 2).forEach((l, i) => {
            if (l.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
            let color = inCodeBlock ? COLORS.code : COLORS.white;
            if (i === 0) {
                linesArray.push({ segments: [{ text: '● ', color: COLORS.white }, { text: l, color }] });
            } else {
                linesArray.push({ segments: [{ text: '  ' }, { text: l, color }] });
            }
        });
        return;
    }

    const isSub = entry.kind === 'status' || entry.kind === 'success' || entry.kind === 'error';
    const isTool = entry.kind === 'tool' || entry.kind === 'command';
    const isExpanded = expandedBlocks.has(entry.id);
    const isActiveTool = isTool && liveRenderState.activeToolEntryId === entry.id;
    const icon = isSub ? '  └ ' : '● ';

    let mainText = entry.text;
    let hintText = null;
    const pushEntryLine = (line) => {
        if (entry.metadata?.isCollapsible) {
            linesArray.push({ ...line, collapsibleId: entry.id });
        } else {
            linesArray.push(line);
        }
    };
    const renderTodoItems = (todoItems = []) => {
        if (!Array.isArray(todoItems) || todoItems.length === 0) {
            pushEntryLine({
                segments: [
                    { text: '  └ ', color: COLORS.dim },
                    { text: 'No todos yet', color: COLORS.dim }
                ]
            });
            return;
        }

        todoItems.forEach((todo, index) => {
            const prefix = index === 0 ? '  └ ' : '    ';
            const marker = todo.status === 'completed' || todo.status === 'cancelled' ? '☒' : '□';
            const markerColor = todo.status === 'completed'
                ? COLORS.green
                : todo.status === 'cancelled'
                    ? COLORS.dim
                    : todo.status === 'in_progress'
                        ? COLORS.blue
                        : COLORS.white;
            const textColor = todo.status === 'completed'
                ? COLORS.green
                : todo.status === 'cancelled'
                    ? COLORS.dim
                    : todo.status === 'in_progress'
                        ? '#C4B5FD'
                        : COLORS.white;
            const backgroundColor = todo.status === 'in_progress' ? '#1E1B4B' : undefined;
            const isStruck = todo.status === 'completed' || todo.status === 'cancelled';
            const wrappedLines = wrapText(todo.content, Math.max(12, maxW - 8));

            wrappedLines.forEach((lineText, lineIndex) => {
                if (lineIndex === 0) {
                    pushEntryLine({
                        segments: [
                            { text: prefix, color: COLORS.dim },
                            { text: `${marker} `, color: markerColor },
                            {
                                text: lineText,
                                color: textColor,
                                backgroundColor,
                                bold: todo.status === 'in_progress',
                                strikethrough: isStruck
                            }
                        ]
                    });
                } else {
                    pushEntryLine({
                        segments: [
                            { text: '      ', color: COLORS.dim },
                            {
                                text: lineText,
                                color: textColor,
                                backgroundColor,
                                bold: todo.status === 'in_progress',
                                strikethrough: isStruck
                            }
                        ]
                    });
                }
            });
        });
    };

    if (entry.metadata?.isCollapsible && !entry.metadata?.inlineDetails && !isExpanded) {
        hintText = { text: ' (ctrl+r / alt+r / /expand)', color: COLORS.dim };
    }

    wrapText(`${icon}${mainText}`, maxW).forEach((l, i) => {
        if (i === 0) {
            if (isTool) {
                const rawText = l.slice(2);
                const match = rawText.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
                const toolIcon = isActiveTool
                  ? { text: `${liveRenderState.spinnerFrame || '*'} `, color: COLORS.orange }
                  : null;
                if (isActiveTool) {
                    if (match) {
                        pushEntryLine({ segments: [
                            toolIcon,
                            { text: match[1], bold: true, color: COLORS.white },
                            { text: '(', color: COLORS.dim },
                            { text: match[2], color: COLORS.dim },
                            { text: ')', color: COLORS.dim }
                        ]});
                    } else {
                        pushEntryLine({ segments: [toolIcon, { text: rawText, bold: true, color: COLORS.white }] });
                    }
                    return;
                }
                if (match) {
                    pushEntryLine({ segments: [
                        { text: '● ', color: COLORS.green },
                        { text: match[1], bold: true, color: COLORS.white },
                        { text: '(', color: COLORS.dim },
                        { text: match[2], color: COLORS.dim },
                        { text: ')', color: COLORS.dim }
                    ]});
                } else {
                    pushEntryLine({ segments: [{ text: '● ', color: COLORS.green }, { text: rawText, bold: true, color: COLORS.white }] });
                }
            } else if (isSub) {
                const textColor = entry.kind === 'error' ? COLORS.red : COLORS.white;
                const segs = [
                    { text: '  └ ', color: COLORS.dim },
                    { text: l.slice(4), color: textColor }
                ];
                if (hintText) segs.push(hintText);
                pushEntryLine({ segments: segs });
            } else {
                pushEntryLine({ segments: [{ text: l, color: COLORS.dim }] });
            }
        } else {
            pushEntryLine({ segments: [{ text: isSub ? `    ${l.trimStart()}` : `  ${l.trimStart()}`, color: COLORS.dim }] });
        }
    });

    if (entry.metadata?.inlineDetails && entry.metadata.fullText) {
        wrapText(entry.metadata.fullText, maxW - 6).forEach(el => {
            pushEntryLine({ segments: [
                { text: '      ', color: COLORS.dim },
                { text: el, color: COLORS.dim }
            ]});
        });
    } else if (entry.metadata?.todoItems) {
        renderTodoItems(entry.metadata.todoItems);
    } else if (entry.metadata?.isCollapsible && isExpanded && entry.metadata.fullText) {
        wrapText(entry.metadata.fullText, maxW - 4).forEach(el => {
            pushEntryLine({ segments: [
                { text: '      ', color: COLORS.dim },
                { text: el, color: COLORS.dim }
            ]});
        });
    }

    if (entry.metadata?.diffPreview && entry.metadata.diffPreview.length > 0) {
        entry.metadata.diffPreview.forEach(diff => {
            let bgColor = undefined;
            let fgColor = COLORS.dim;

            if (diff.type === 'removed') {
                bgColor = COLORS.darkRed;
                fgColor = COLORS.red;
            } else if (diff.type === 'added') {
                bgColor = COLORS.darkGreen;
                fgColor = COLORS.green;
            }

            const lineNumStr = (diff.lineNum || ' ').padEnd(5, ' ');

            pushEntryLine({ segments: [
                { text: '      ' },
                { text: lineNumStr, color: COLORS.dim },
                { text: diff.text, color: fgColor, backgroundColor: bgColor }
            ]});
        });
    }
}

export function renderActivityClusters(entries, linesArray, maxW, liveRenderState = {}, expandedBlocks) {
    if (!entries || entries.length === 0) return;

    const clusters = [];
    let currentCluster = [];

    entries.forEach((entry) => {
        if (isTopLevelActivity(entry)) {
            if (currentCluster.length > 0) clusters.push(currentCluster);
            currentCluster = [entry];
        } else if (currentCluster.length > 0) {
            currentCluster.push(entry);
        } else {
            currentCluster = [entry];
        }
    });

    if (currentCluster.length > 0) clusters.push(currentCluster);

    clusters.forEach((cluster, index) => {
        if (index > 0) ensureSpacer(linesArray);
        cluster.forEach((entry) => renderActivityEntry(entry, linesArray, maxW, liveRenderState, expandedBlocks));
    });
}
