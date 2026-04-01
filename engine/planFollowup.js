/**
 * PlanFollowup — KiloCode-style plan follow-up mechanism
 * After plan_exit, asks the user what to do next:
 * 1. Implement in current session
 * 2. Start fresh session with plan + handover
 * 3. Revise plan
 * 4. Save and exit
 */

const HANDOVER_PROMPT = `You are summarizing a planning session to hand off to an implementation session.

The plan itself will be provided separately — do NOT repeat it. Instead, focus on information discovered during planning that would help the implementing agent but is NOT already in the plan text.

Produce a concise summary using this template:
---
## Discoveries

[Key findings from code exploration — architecture patterns, gotchas, edge cases, relevant existing code that the plan references but doesn't fully explain]

## Relevant Files

[Structured list of files/directories that were read or discussed, with brief notes on what's relevant in each]

## Implementation Notes

[Any important context: conventions to follow, potential pitfalls, dependencies between steps, things the implementing agent should watch out for]
---

If there is nothing useful to add beyond what the plan already says, respond with an empty string.
Keep the summary concise — focus on high-entropy information that would save the implementing agent time.`;

export async function generateHandover(messages, callAI, modelConfig) {
  try {
    const handoverMessages = [
      ...messages.filter(m => m.role === 'assistant' || m.role === 'user').slice(-20),
      { role: 'user', content: HANDOVER_PROMPT }
    ];

    const response = await callAI(handoverMessages);
    return (response?.content || '').trim();
  } catch (error) {
    return '';
  }
}

export async function askPlanFollowup(planText, planFile, reporter) {
  if (typeof reporter?.askUser !== 'function') {
    return 'continue';
  }

  const answer = await reporter.askUser({
    question: `Plan saved: ${planFile}\n\nWhat would you like to do next?`,
    options: [
      'Implement in this session',
      'Start fresh session with plan',
      'Revise plan',
      'Save and exit'
    ]
  });

  if (!answer) return 'dismissed';

  const lower = answer.toLowerCase().trim();
  if (lower.includes('implement') || lower.includes('this session')) return 'continue';
  if (lower.includes('fresh') || lower.includes('new session')) return 'new_session';
  if (lower.includes('revise')) return 'revise';
  return 'dismissed';
}

export async function handlePlanFollowup(action, planText, planFile, runtime, messages, reporter) {
  switch (action) {
    case 'continue': {
      return {
        type: 'implement',
        text: 'Implement the plan above.',
        planFile,
        planText,
      };
    }

    case 'new_session': {
      const handover = await generateHandover(messages, runtime.callAI, runtime.modelConfig);
      const sections = [`Implement the following plan:\n\n${planText}`];
      if (handover) {
        sections.push(`## Handover from Planning Session\n\n${handover}`);
      }
      return {
        type: 'new_session',
        text: sections.join('\n\n'),
        planFile,
        planText,
        handover,
      };
    }

    case 'revise': {
      const feedback = await reporter.askUser({
        question: 'What changes would you like to make to the plan?',
        options: []
      });
      return {
        type: 'revise',
        text: feedback || 'Please revise the plan based on my feedback.',
        planFile,
        planText,
      };
    }

    case 'dismissed':
    default:
      return {
        type: 'dismissed',
        text: `Plan saved to ${planFile}.`,
        planFile,
        planText,
      };
  }
}
