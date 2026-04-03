import { loadToolPrompt } from './loader.js';

export const TOOL_NAME_ALIASES = {
  bash: 'run_command',
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  list: 'list_files',
  glob: 'search_files',
  grep: 'search_content',
  question: 'ask_user',
  brief: 'send_user_message',
};

const TOOL_DEFINITIONS = {
  run_command: {
    promptKey: 'bash',
    parameters: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Optional working directory relative to the project root' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
    },
    required: ['command'],
    roles: ['general', 'debugger', 'orchestrator'],
  },
  bash: {
    promptKey: 'bash',
    parameters: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
      workdir: { type: 'string', description: 'The working directory to run the command in' },
      description: { type: 'string', description: 'Clear, concise description of what this command does in 5-10 words' },
    },
    required: ['command'],
    roles: ['general', 'debugger', 'orchestrator'],
  },
  read_file: {
    promptKey: 'read',
    parameters: {
      path: { type: 'string', description: 'The path to the file to read' },
      offset: { type: 'number', description: 'Optional starting line number (1-based)' },
      limit: { type: 'number', description: 'Optional maximum number of lines to return' },
    },
    required: ['path'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  read: {
    promptKey: 'read',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file or directory to read' },
      offset: { type: 'number', description: 'The line number to start from (1-indexed)' },
      limit: { type: 'number', description: 'The maximum number of lines to read' },
    },
    required: ['filePath'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  write_file: {
    promptKey: 'write',
    parameters: {
      path: { type: 'string', description: 'The path to the file to write' },
      content: { type: 'string', description: 'The content to write to the file' },
    },
    required: ['path', 'content'],
    roles: ['general', 'coder', 'plan'],
  },
  write: {
    promptKey: 'write',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file to write' },
      content: { type: 'string', description: 'The content to write to the file' },
    },
    required: ['filePath', 'content'],
    roles: ['general', 'coder'],
  },
  edit_file: {
    promptKey: 'edit',
    parameters: {
      path: { type: 'string', description: 'The path to the file to modify' },
      edits: {
        type: 'array',
        description: 'Array of edit operations to perform sequentially',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'The text to replace' },
            replace: { type: 'string', description: 'The replacement text' },
            replaceAll: { type: 'boolean', description: 'Replace all occurrences of search' },
          },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['path', 'edits'],
    roles: ['general', 'coder'],
  },
  edit: {
    promptKey: 'edit',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file to modify' },
      oldString: { type: 'string', description: 'The text to replace' },
      newString: { type: 'string', description: 'The text to replace it with' },
      replaceAll: { type: 'boolean', description: 'Replace all occurrences of oldString' },
    },
    required: ['filePath', 'oldString', 'newString'],
    roles: ['general', 'coder'],
  },
  multiedit: {
    promptKey: 'multiedit',
    parameters: {
      path: { type: 'string', description: 'The path to the file to modify' },
      edits: {
        type: 'array',
        description: 'Array of edit operations to perform sequentially',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'The text to replace' },
            replace: { type: 'string', description: 'The text to replace it with' },
            replaceAll: { type: 'boolean', description: 'Replace all occurrences' },
          },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['path', 'edits'],
    roles: ['general', 'coder'],
  },
  list_files: {
    promptKey: 'list',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the directory to list' },
      depth: { type: 'number', description: 'Optional recursion depth' },
      includeHidden: { type: 'boolean', description: 'Whether to include hidden files and directories' },
    },
    required: [],
    roles: ['general', 'explorer', 'orchestrator', 'plan'],
  },
  list: {
    promptKey: 'list',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the directory to list' },
    },
    required: [],
    roles: ['general', 'explorer', 'orchestrator', 'plan'],
  },
  search_files: {
    promptKey: 'glob',
    parameters: {
      pattern: { type: 'string', description: 'The glob pattern to match files against' },
      path: { type: 'string', description: 'The directory to search in' },
    },
    required: ['pattern'],
    roles: ['general', 'explorer', 'orchestrator', 'plan'],
  },
  glob: {
    promptKey: 'glob',
    parameters: {
      pattern: { type: 'string', description: 'The glob pattern to match files against' },
      path: { type: 'string', description: 'The directory to search in' },
    },
    required: ['pattern'],
    roles: ['general', 'explorer', 'orchestrator', 'plan'],
  },
  search_content: {
    promptKey: 'grep',
    parameters: {
      query: { type: 'string', description: 'The regex pattern to search for' },
      path: { type: 'string', description: 'The directory to search in' },
      include: { type: 'string', description: 'File pattern to include in the search' },
    },
    required: ['query'],
    roles: ['general', 'explorer', 'orchestrator', 'plan'],
  },
  grep: {
    promptKey: 'grep',
    parameters: {
      pattern: { type: 'string', description: 'The regex pattern to search for' },
      path: { type: 'string', description: 'The directory to search in' },
      include: { type: 'string', description: 'File pattern to include in the search' },
    },
    required: ['pattern'],
    roles: ['general', 'explorer', 'orchestrator', 'plan'],
  },
  finish_task: {
    description: 'Call this tool when the task is fully completed or no further progress can be made.',
    parameters: {
      message: { type: 'string', description: 'A summary message for the user explaining what was accomplished' },
    },
    required: ['message'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator'],
  },
  plan_exit: {
    promptKey: 'plan_exit',
    description: 'Signals that the planning phase is complete.',
    parameters: {},
    required: [],
    roles: ['plan'],
  },
  ask_user: {
    promptKey: 'question',
    description: 'Pause execution and explicitly ask the user a clarifying question before proceeding.',
    parameters: {
      question: { type: 'string', description: 'The specific question to ask the user' },
      options: {
        type: 'array',
        description: 'Optional list of predefined answer options',
        items: { type: 'string' },
      },
    },
    required: ['question'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  question: {
    promptKey: 'question',
    parameters: {
      questions: {
        type: 'array',
        description: 'Questions to ask',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Complete question' },
            header: { type: 'string', description: 'Very short label (max 30 chars)' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Display text' },
                  description: { type: 'string', description: 'Explanation of choice' },
                },
                required: ['label', 'description'],
              },
            },
            multiple: { type: 'boolean', description: 'Allow selecting multiple choices' },
          },
          required: ['question', 'header', 'options'],
        },
      },
    },
    required: ['questions'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  send_user_message: {
    promptKey: 'send_user_message',
    parameters: {
      message: { type: 'string', description: 'The message to send to the user' },
      attachments: {
        type: 'array',
        description: 'Optional file paths to attach to the message',
        items: { type: 'string', description: 'File path to attach' },
      },
      status: {
        type: 'string',
        description: 'Message priority level',
        enum: ['normal', 'proactive'],
      },
    },
    required: ['message', 'status'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  brief: {
    promptKey: 'send_user_message',
    parameters: {
      message: { type: 'string', description: 'The message to send to the user' },
      attachments: {
        type: 'array',
        description: 'Optional file paths to attach to the message',
        items: { type: 'string', description: 'File path to attach' },
      },
      status: {
        type: 'string',
        description: 'Message priority level',
        enum: ['normal', 'proactive'],
      },
    },
    required: ['message', 'status'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  structured_output: {
    promptKey: 'structured_output',
    parameterSchema: {
      type: 'object',
      additionalProperties: true,
    },
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  delegate_task: {
    description: 'Delegate a pure exploration or read task to a sub-agent.',
    parameters: {
      task: { type: 'string', description: 'Detailed instruction for the sub-agent to explore or read' },
    },
    required: ['task'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan'],
  },
  task: {
    promptKey: 'task',
    parameters: {
      description: { type: 'string', description: 'A short (3-5 words) description of the task' },
      prompt: { type: 'string', description: 'The task for the agent to perform' },
      subagent_type: { type: 'string', description: 'The type of specialized agent to use', enum: ['general', 'explore', 'explorer', 'coder', 'debugger'] },
      task_id: { type: 'string', description: 'Optional unique task ID' },
    },
    required: ['description', 'prompt', 'subagent_type'],
    roles: ['general', 'orchestrator'],
  },
  webfetch: {
    promptKey: 'webfetch',
    parameters: {
      url: { type: 'string', description: 'The URL to fetch content from' },
      format: { type: 'string', description: 'The format to return (text, markdown, html)', enum: ['text', 'markdown', 'html'] },
    },
    required: ['url'],
    roles: ['general', 'orchestrator'],
  },
  websearch: {
    promptKey: 'websearch',
    parameters: {
      query: { type: 'string', description: 'Websearch query' },
      numResults: { type: 'number', description: 'Number of search results to return' },
      type: { type: 'string', description: 'Search type', enum: ['auto', 'fast', 'deep'] },
    },
    required: ['query'],
    roles: ['general', 'orchestrator'],
  },
  apply_patch: {
    promptKey: 'apply_patch',
    parameters: {
      patchText: { type: 'string', description: 'The full patch text that describes all changes' },
    },
    required: ['patchText'],
    roles: ['general', 'coder'],
  },
  batch: {
    promptKey: 'batch',
    parameters: {
      tool_calls: {
        type: 'array',
        description: 'Array of tool calls to execute in parallel',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'The name of the tool to execute' },
            parameters: { type: 'object', description: 'Parameters for the tool' },
          },
          required: ['tool', 'parameters'],
        },
      },
    },
    required: ['tool_calls'],
    roles: ['general', 'orchestrator'],
  },
  codesearch: {
    promptKey: 'codesearch',
    parameters: {
      query: { type: 'string', description: 'Search query for APIs, libraries, SDKs' },
      tokensNum: { type: 'number', description: 'Number of tokens to return (1000-50000)' },
    },
    required: ['query'],
    roles: ['general', 'explorer', 'coder'],
  },
  todowrite: {
    promptKey: 'todowrite',
    parameters: {
      todos: {
        type: 'array',
        description: 'The updated todo list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Brief description of the task' },
            status: { type: 'string', description: 'Current status', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            priority: { type: 'string', description: 'Priority level', enum: ['high', 'medium', 'low'] },
          },
          required: ['content', 'status', 'priority'],
        },
      },
    },
    required: ['todos'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator'],
  },
  todoread: {
    promptKey: 'todoread',
    parameters: {},
    required: [],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator'],
  },
  codebase_search: {
    promptKey: 'codebase_search',
    parameters: {
      query: { type: 'string', description: 'Natural language search query describing what code you are looking for' },
    },
    required: ['query'],
    roles: ['general', 'explorer'],
  },
  lsp: {
    promptKey: 'lsp',
    parameters: {
      operation: { type: 'string', description: 'The LSP operation to perform', enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol', 'workspaceSymbol', 'goToImplementation', 'prepareCallHierarchy', 'incomingCalls', 'outgoingCalls'] },
      filePath: { type: 'string', description: 'The absolute or relative path to the file' },
      line: { type: 'number', description: 'The line number (1-based)' },
      character: { type: 'number', description: 'The character offset (1-based)' },
    },
    required: ['operation', 'filePath', 'line', 'character'],
    roles: ['general', 'explorer', 'coder'],
  },
};

function resolveToolDescription(definition) {
  if (definition.promptKey) {
    const prompt = loadToolPrompt(definition.promptKey);
    if (prompt) return prompt;
  }

  return definition.description || definition.promptKey || 'Use this tool to help complete the task.';
}

function buildSchemaType(paramDef) {
  if (paramDef.type === 'array' && paramDef.items) {
    return {
      type: 'array',
      description: paramDef.description || '',
      items: paramDef.items.type === 'object'
        ? {
            type: 'object',
            properties: Object.fromEntries(
              Object.entries(paramDef.items.properties || {}).map(([key, value]) => [key, buildSchemaType(value)])
            ),
            required: paramDef.items.required || [],
          }
        : buildSchemaType(paramDef.items),
    };
  }

  if (paramDef.type === 'object' && paramDef.properties) {
    return {
      type: 'object',
      description: paramDef.description || '',
      properties: Object.fromEntries(
        Object.entries(paramDef.properties).map(([key, value]) => [key, buildSchemaType(value)])
      ),
      required: paramDef.required || [],
    };
  }

  const result = { type: paramDef.type, description: paramDef.description || '' };
  if (paramDef.enum) result.enum = paramDef.enum;
  return result;
}

function buildToolSchema(id, definition) {
  const parameterSchema = definition.parameterSchema || {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(definition.parameters || {}).map(([paramName, paramDef]) => [paramName, buildSchemaType(paramDef)])
    ),
    required: definition.required || [],
  };

  return {
    type: 'function',
    function: {
      name: id,
      description: resolveToolDescription(definition),
      parameters: parameterSchema,
    },
  };
}

export function normalizeToolName(toolName) {
  return TOOL_NAME_ALIASES[toolName] || toolName;
}

export function normalizeToolArgs(toolName, toolArgs = {}) {
  if (toolName === 'bash') {
    return { command: toolArgs.command, cwd: toolArgs.workdir, timeout: toolArgs.timeout };
  }
  if (toolName === 'read') {
    return { path: toolArgs.filePath, offset: toolArgs.offset, limit: toolArgs.limit };
  }
  if (toolName === 'write') {
    return { path: toolArgs.filePath, content: toolArgs.content };
  }
  if (toolName === 'edit') {
    return {
      path: toolArgs.filePath,
      search: toolArgs.oldString,
      replace: toolArgs.newString,
      replaceAll: toolArgs.replaceAll === true,
      edits: [{ search: toolArgs.oldString, replace: toolArgs.newString }],
    };
  }
  if (toolName === 'list') {
    return { path: toolArgs.path };
  }
  if (toolName === 'glob') {
    return { pattern: toolArgs.pattern, path: toolArgs.path };
  }
  if (toolName === 'grep') {
    return { query: toolArgs.pattern, path: toolArgs.path, include: toolArgs.include };
  }
  return toolArgs;
}

export function getToolsForRole(role) {
  return Object.entries(TOOL_DEFINITIONS)
    .filter(([, definition]) => definition.roles.includes(role))
    .map(([id, definition]) => buildToolSchema(id, definition));
}

export function getAllToolNames() {
  return Object.keys(TOOL_DEFINITIONS);
}

export function getToolDefinition(name) {
  return TOOL_DEFINITIONS[name] || null;
}
