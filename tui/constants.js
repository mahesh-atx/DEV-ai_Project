export const THEME = {
  accent: '#D97757',
  text: '#EDEDED',
  dim: '#777777',
  border: '#2A2A2A',
  success: '#55CC55',
  error: '#CC5555',
  warning: '#CCAA55',
};

export const LOGO = `
 ██████╗  ██████╗  ██████╗ ████████╗██╗  ██╗
 ██╔══██╗██╔═══██╗██╔═══██╗╚══██╔══╝╚██╗██╔╝
 ██████╔╝██║   ██║██║   ██║   ██║    ╚███╔╝ 
 ██╔══██╗██║   ██║██║   ██║   ██║    ██╔██╗ 
 ██║  ██║╚██████╔╝╚██████╔╝   ██║   ██╔╝ ██╗
 ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚═╝  ╚═╝
`;

export const MODES = [
  { value: 'standard', label: 'Standard', desc: 'Single pass generation and apply flow' },
  { value: 'agent', label: 'Agent', desc: 'Builder to debug pipeline' },
  { value: 'polish', label: 'Polish', desc: 'Pipeline plus refinement pass' },
  { value: 'orchestrator', label: 'Orchestrator', desc: 'Parallel multi-agent execution pipeline' },
  { value: 'planner', label: 'Planner', desc: 'Read-only exploration and plan creation' },
  { value: 'ask', label: 'Ask Only', desc: 'Conversation-only mode — no changes' },
];
