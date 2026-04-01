# Fix TUI Streaming Display and Ask User Tool

## Problem Summary

Two issues in the TUI (Terminal User Interface) built with React + Ink:

### Issue 1: Response and thinking content not displayed during streaming
- The `StreamingPanel` component only shows static text "Thinking & Orchestrating" and metadata (chars count, thinking count, files, time)
- The actual thinking content from `delta.reasoning_content` is tracked via `streamThinkingChars` counter but the **content itself is never displayed**
- The response content is tracked via `streamChars` counter but the **content itself is never displayed**
- Users only see counters incrementing, not the actual AI response

### Issue 2: `ask_user` tool doesn't work in TUI
- The `ask_user` tool in `agentController.js` uses `inquirer.prompt()` to get user input
- In TUI mode, `reporter.silent` is `true`, so the `console.log` is skipped
- `inquirer.prompt()` conflicts with Ink's terminal control (both try to control stdin)
- The TUI has no handler for the `ask_user` tool - `uiReporter.js` lacks an `askUser` handler
- Result: Agent asks a question but user has no way to respond

---

## Solution Plan

### Fix 1: Show thinking content and response preview in StreamingPanel

**Files to modify:**
- `tui/components/ChatScreen.jsx`
- `tui/components/StreamingPanel.jsx`

**Changes:**

1. **Add state variables in `ChatScreen.jsx`** (around line 131):
   ```javascript
   const [streamThinkingContent, setStreamThinkingContent] = useState('');
   const [streamResponseContent, setStreamResponseContent] = useState('');
   ```

2. **Update `resetRunState` function** (around line 270) to reset the new state:
   ```javascript
   setStreamThinkingContent('');
   setStreamResponseContent('');
   ```

3. **Update streaming loops** to capture actual content:
   - In `runAskMode` (line 376-378): Append `delta.reasoning_content` to `streamThinkingContent`
   - In `runAskMode` (line 381-386): Append `delta.content` to `streamResponseContent`
   - In `runStandardMode` (line 468-471): Same for thinking content
   - In `runStandardMode` (line 474-477): Same for response content
   - In `runAgentMode` `callAI` (line 635-638): Same for thinking content
   - In `runAgentMode` `callAI` (line 641-644): Same for response content

4. **Pass new props to `StreamingPanel`** (around line 1030-1037):
   ```jsx
   <StreamingPanel
     label={streamLabel}
     percent={streamPercent}
     chars={streamChars}
     thinkingChars={streamThinkingChars}
     thinkingContent={streamThinkingContent}  // NEW
     responseContent={streamResponseContent}  // NEW
     files={streamFiles}
     elapsed={streamElapsed}
   />
   ```

5. **Update `StreamingPanel.jsx`** to display content:
   - Add `thinkingContent` and `responseContent` props
   - Show last 200 chars of thinking content in the thinking block (when `percent < 60`)
   - Show last 300 chars of response content below the metadata

### Fix 2: Implement `ask_user` tool in TUI

**Files to modify:**
- `tui/uiReporter.js`
- `engine/agentController.js`
- `tui/components/ChatScreen.jsx`

**Changes:**

1. **Add `askUser` handler to `uiReporter.js`**:
   ```javascript
   askUser(payload) {
     return callHandler(handlers, 'askUser', payload);
   },
   ```
   Note: This needs to return a Promise that resolves with the user's answer.

2. **Modify `agentController.js` `ask_user` handler** (lines 496-506):
   ```javascript
   else if (tc.function.name === "ask_user") {
     if (reporter?.silent && typeof reporter.askUser === 'function') {
       // TUI mode: use reporter's askUser handler
       toolResultStr = await reporter.askUser({ question: args.question });
     } else {
       // CLI mode: use inquirer
       const inquirer = (await import("inquirer")).default;
       emitReporter(reporter, "log", { level: "info", message: `Agent asks: ${args.question}` });
       if (!reporter?.silent) console.log(`\n🤖 ` + chalk.cyan.bold("Agent asks:") + ` ${args.question}`);
       const ans = await inquirer.prompt([{
          type: 'input',
          name: 'reply',
          message: chalk.yellow("Your reply:")
       }]);
       toolResultStr = ans.reply;
     }
   }
   ```

3. **Add ask_user UI state in `ChatScreen.jsx`**:
   ```javascript
   const [pendingQuestion, setPendingQuestion] = useState(null);
   const [questionResolver, setQuestionResolver] = useState(null);
   ```

4. **Add `askUser` handler in `buildReporter`** (around line 306):
   ```javascript
   askUser: ({ question }) => {
     return new Promise((resolve) => {
       setPendingQuestion(question);
       setQuestionResolver(() => resolve);
     });
   },
   ```

5. **Add question UI in chat area** (around line 1039, before the trace section):
   ```jsx
   {pendingQuestion && (
     <Box flexDirection="column" borderStyle="round" borderColor={THEME.warning} paddingX={1} marginBottom={1}>
       <Text color={THEME.warning} bold>Agent asks:</Text>
       <Text color={THEME.text}>{pendingQuestion}</Text>
       <Text color={THEME.dim}>Type your answer and press Enter...</Text>
     </Box>
   )}
   ```

6. **Modify `handleSubmit`** to handle question responses:
   - Check if `pendingQuestion` is set
   - If yes, resolve the promise with the input and clear `pendingQuestion`
   - Don't execute the normal handler

---

## Implementation Order

1. Fix 1 first (streaming content display) - simpler, no async coordination needed
2. Fix 2 second (ask_user tool) - requires async coordination between reporter and UI

## Testing

1. Start TUI in Agent mode
2. Send a request that triggers thinking (e.g., "create a website")
3. Verify thinking content appears in the streaming panel
4. Verify response preview appears as it streams
5. Send a request that triggers `ask_user` tool
6. Verify question appears in the chat area
7. Verify typing an answer and pressing Enter returns it to the agent

## Risk Assessment

- **Low risk**: Changes are isolated to TUI components and don't affect CLI mode
- **Backward compatible**: CLI mode uses existing `inquirer` flow
- **No breaking changes**: New props have default values, new handlers are optional
