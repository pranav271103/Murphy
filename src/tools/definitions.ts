import { z } from 'zod';

export const ToolSchema = z.object({
    type: z.literal('function'),
    function: z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.object({
            type: z.literal('object'),
            properties: z.record(z.string(), z.any()),
            required: z.array(z.string()).optional(),
        }),
    }),
});

export type ToolDefinition = z.infer<typeof ToolSchema>;

/**
 * Core File Operations
 */
export const readFileTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'read_file',
        description: 'Read the contents of a file. Use for examining code, configs, or any text file.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The absolute path to the file to read.' },
                offset: { type: 'number', description: 'Line number to start reading from (1-indexed).', default: 1 },
                limit: { type: 'number', description: 'Maximum number of lines to read.', default: 200 },
            },
            required: ['path'],
        },
    },
};

export const writeFileTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'write_file',
        description: 'Write content to a file. Creates directories automatically if they do not exist.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The absolute path to the file to write.' },
                content: { type: 'string', description: 'The complete content to write to the file.' },
            },
            required: ['path', 'content'],
        },
    },
};

export const editFileTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'edit_file',
        description: 'Edit an existing file by replacing specific text. Use for surgical modifications.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The absolute path to the file to edit.' },
                old_string: { type: 'string', description: 'The exact text to replace.' },
                new_string: { type: 'string', description: 'The replacement text.' },
            },
            required: ['path', 'old_string', 'new_string'],
        },
    },
};

export const deleteFileTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'delete_file',
        description: 'Delete a file. Use with caution.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The absolute path to the file to delete.' },
            },
            required: ['path'],
        },
    },
};

/**
 * Directory Operations
 */
export const listDirectoryTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'list_directory',
        description: 'List the contents of a directory. Returns files and subdirectories.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The absolute path to the directory.' },
                recursive: { type: 'boolean', description: 'Whether to list recursively.', default: false },
                pattern: { type: 'string', description: 'Glob pattern to filter results (e.g., "*.ts").', default: '*' },
            },
            required: ['path'],
        },
    },
};

export const createDirectoryTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'create_directory',
        description: 'Create a new directory and any necessary parent directories.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'The absolute path to the directory to create.' },
            },
            required: ['path'],
        },
    },
};

/**
 * Shell Operations
 */
export const runCommandTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'run_command',
        description: 'Run a shell command. Use for git operations, package management, or system commands.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The shell command to execute.' },
                cwd: { type: 'string', description: 'Working directory for the command.', default: '.' },
                timeout: { type: 'number', description: 'Timeout in milliseconds.', default: 60000 },
            },
            required: ['command'],
        },
    },
};

/**
 * Code Analysis Operations
 */
export const grepTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'grep',
        description: 'Search for patterns in files using regex. Returns matching lines with file paths.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'The regex pattern to search for.' },
                path: { type: 'string', description: 'Directory or file to search in.', default: '.' },
                glob: { type: 'string', description: 'File pattern to filter (e.g., "*.tsx").', default: '*' },
            },
            required: ['pattern'],
        },
    },
};

export const globTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'glob',
        description: 'Find files matching a glob pattern. Returns list of file paths.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'The glob pattern (e.g., "**/*.ts").' },
                path: { type: 'string', description: 'Base directory to search from.', default: '.' },
            },
            required: ['pattern'],
        },
    },
};

/**
 * Web Operations
 */
export const fetchUrlTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'fetch_url',
        description: 'Fetch content from a URL. Use for web scraping or API calls.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The URL to fetch.' },
                method: { type: 'string', description: 'HTTP method.', enum: ['GET', 'POST'], default: 'GET' },
                headers: { type: 'object', description: 'Request headers as key-value pairs.', default: {} },
            },
            required: ['url'],
        },
    },
};

/**
 * All available tools
 */
export const tools: ToolDefinition[] = [
    readFileTool,
    writeFileTool,
    editFileTool,
    deleteFileTool,
    listDirectoryTool,
    createDirectoryTool,
    runCommandTool,
    grepTool,
    globTool,
    fetchUrlTool,
];

/**
 * Tool name to definition mapping
 */
export const toolDefinitions: Record<string, ToolDefinition> = {
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    delete_file: deleteFileTool,
    list_directory: listDirectoryTool,
    create_directory: createDirectoryTool,
    run_command: runCommandTool,
    grep: grepTool,
    glob: globTool,
    fetch_url: fetchUrlTool,
};
