import { loadToolPrompt } from './loader.js';

const TOOL_DEFINITIONS = {
  bash: {
    description: 'bash',
    parameters: {
      command: { type: 'string', description: 'The command to execute' },
      timeout: { type: 'number', description: 'Optional timeout in milliseconds' },
      workdir: { type: 'string', description: 'The working directory to run the command in' },
      description: { type: 'string', description: 'Clear, concise description of what this command does in 5-10 words' }
    },
    required: ['command'],
    roles: ['general', 'debugger', 'orchestrator']
  },
  read: {
    description: 'read',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file or directory to read' },
      offset: { type: 'number', description: 'The line number to start from (1-indexed)' },
      limit: { type: 'number', description: 'The maximum number of lines to read' }
    },
    required: ['filePath'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan']
  },
  write: {
    description: 'write',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file to write' },
      content: { type: 'string', description: 'The content to write to the file' }
    },
    required: ['filePath', 'content'],
    roles: ['general', 'coder']
  },
  edit: {
    description: 'edit',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file to modify' },
      oldString: { type: 'string', description: 'The text to replace' },
      newString: { type: 'string', description: 'The text to replace it with' },
      replaceAll: { type: 'boolean', description: 'Replace all occurrences of oldString' }
    },
    required: ['filePath', 'oldString', 'newString'],
    roles: ['general', 'coder']
  },
  multiedit: {
    description: 'multiedit',
    parameters: {
      filePath: { type: 'string', description: 'The absolute path to the file to modify' },
      edits: {
        type: 'array',
        description: 'Array of edit operations to perform sequentially',
        items: {
          type: 'object',
          properties: {
            oldString: { type: 'string', description: 'The text to replace' },
            newString: { type: 'string', description: 'The text to replace it with' },
            replaceAll: { type: 'boolean', description: 'Replace all occurrences' }
          },
          required: ['oldString', 'newString']
        }
      }
    },
    required: ['filePath', 'edits'],
    roles: ['general', 'coder']
  },
  glob: {
    description: 'glob',
    parameters: {
      pattern: { type: 'string', description: 'The glob pattern to match files against' },
      path: { type: 'string', description: 'The directory to search in' }
    },
    required: ['pattern'],
    roles: ['general', 'explorer', 'orchestrator', 'plan']
  },
  grep: {
    description: 'grep',
    parameters: {
      pattern: { type: 'string', description: 'The regex pattern to search for' },
      path: { type: 'string', description: 'The directory to search in' },
      include: { type: 'string', description: 'File pattern to include in the search' }
    },
    required: ['pattern'],
    roles: ['general', 'explorer', 'orchestrator']
  },
  list: {
    description: 'list',
    parameters: {
      path: { type: 'string', description: 'The absolute path to the directory to list' }
    },
    required: [],
    roles: ['general', 'explorer', 'orchestrator', 'plan']
  },
  task: {
    description: 'task',
    parameters: {
      description: { type: 'string', description: 'A short (3-5 words) description of the task' },
      prompt: { type: 'string', description: 'The task for the agent to perform' },
      subagent_type: { type: 'string', description: 'The type of specialized agent to use', enum: ['general', 'explore'] }
    },
    required: ['description', 'prompt', 'subagent_type'],
    roles: ['general', 'orchestrator']
  },
  question: {
    description: 'question',
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
                  description: { type: 'string', description: 'Explanation of choice' }
                },
                required: ['label', 'description']
              }
            },
            multiple: { type: 'boolean', description: 'Allow selecting multiple choices' }
          },
          required: ['question', 'header', 'options']
        }
      }
    },
    required: ['questions'],
    roles: ['general', 'explorer', 'coder', 'debugger', 'orchestrator', 'plan']
  },
  webfetch: {
    description: 'webfetch',
    parameters: {
      url: { type: 'string', description: 'The URL to fetch content from' },
      format: { type: 'string', description: 'The format to return (text, markdown, html)', enum: ['text', 'markdown', 'html'] }
    },
    required: ['url'],
    roles: ['general', 'orchestrator']
  },
  websearch: {
    description: 'websearch',
    parameters: {
      query: { type: 'string', description: 'Websearch query' },
      numResults: { type: 'number', description: 'Number of search results to return' },
      type: { type: 'string', description: 'Search type', enum: ['auto', 'fast', 'deep'] }
    },
    required: ['query'],
    roles: ['general', 'orchestrator']
  },
  apply_patch: {
    description: 'apply_patch',
    parameters: {
      patchText: { type: 'string', description: 'The full patch text that describes all changes' }
    },
    required: ['patchText'],
    roles: ['general', 'coder']
  },
  batch: {
    description: 'batch',
    parameters: {
      tool_calls: {
        type: 'array',
        description: 'Array of tool calls to execute in parallel',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'The name of the tool to execute' },
            parameters: { type: 'object', description: 'Parameters for the tool' }
          },
          required: ['tool', 'parameters']
        }
      }
    },
    required: ['tool_calls'],
    roles: ['general', 'orchestrator']
  },
  codesearch: {
    description: 'codesearch',
    parameters: {
      query: { type: 'string', description: 'Search query for APIs, libraries, SDKs' },
      tokensNum: { type: 'number', description: 'Number of tokens to return (1000-50000)' }
    },
    required: ['query'],
    roles: ['general', 'explorer', 'coder']
  },
  todowrite: {
    description: 'todowrite',
    parameters: {
      todos: {
        type: 'array',
        description: 'The updated todo list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Brief description of the task' },
            status: { type: 'string', description: 'Current status', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            priority: { type: 'string', description: 'Priority level', enum: ['high', 'medium', 'low'] }
          },
          required: ['content', 'status', 'priority']
        }
      }
    },
    required: ['todos'],
    roles: ['general', 'coder', 'debugger', 'orchestrator']
  },
  todoread: {
    description: 'todoread',
    parameters: {},
    required: [],
    roles: ['general', 'coder', 'debugger', 'orchestrator']
  },
  plan_exit: {
    description: 'plan_exit',
    parameters: {},
    required: [],
    roles: ['plan']
  },
  codebase_search: {
    description: 'codebase_search',
    parameters: {
      query: { type: 'string', description: 'Natural language search query describing what code you are looking for' }
    },
    required: ['query'],
    roles: ['general', 'explorer']
  },
  lsp: {
    description: 'lsp',
    parameters: {
      operation: { type: 'string', description: 'The LSP operation to perform', enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol', 'workspaceSymbol', 'goToImplementation', 'prepareCallHierarchy', 'incomingCalls', 'outgoingCalls'] },
      filePath: { type: 'string', description: 'The absolute or relative path to the file' },
      line: { type: 'number', description: 'The line number (1-based)' },
      character: { type: 'number', description: 'The character offset (1-based)' }
    },
    required: ['operation', 'filePath', 'line', 'character'],
    roles: ['general', 'explorer', 'coder']
  }
};

export function getToolsForRole(role) {
  const tools = [];

  for (const [id, def] of Object.entries(TOOL_DEFINITIONS)) {
    if (!def.roles.includes(role)) continue;

    const prompt = loadToolPrompt(def.description);
    if (!prompt) continue;

    const schema = {
      type: 'object',
      properties: {},
      required: def.required || []
    };

    for (const [paramName, paramDef] of Object.entries(def.parameters)) {
      schema.properties[paramName] = buildSchemaType(paramDef);
    }

    tools.push({
      type: 'function',
      function: {
        name: id,
        description: prompt,
        parameters: schema
      }
    });
  }

  return tools;
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
              Object.entries(paramDef.items.properties || {}).map(([k, v]) => [k, buildSchemaType(v)])
            ),
            required: paramDef.items.required || []
          }
        : { type: paramDef.items.type }
    };
  }

  if (paramDef.type === 'object' && paramDef.properties) {
    return {
      type: 'object',
      description: paramDef.description || '',
      properties: Object.fromEntries(
        Object.entries(paramDef.properties).map(([k, v]) => [k, buildSchemaType(v)])
      ),
      required: paramDef.required || []
    };
  }

  const result = { type: paramDef.type, description: paramDef.description || '' };
  if (paramDef.enum) result.enum = paramDef.enum;
  return result;
}

export function getAllToolNames() {
  return Object.keys(TOOL_DEFINITIONS);
}

export function getToolDefinition(name) {
  return TOOL_DEFINITIONS[name] || null;
}
