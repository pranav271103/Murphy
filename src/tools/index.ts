import fs from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';

// execAsync removed - using spawn-based execution instead

export interface ToolResult {
    success: boolean;
    content?: string;
    error?: string;
    duration?: number;
    toolCallId?: string;
}

interface ToolHandler {
    (args: any): Promise<string>;
}

/**
 * Execute command with streaming output support
 */
async function executeCommand(
    command: string,
    cwd: string = '.',
    timeout: number = 60000
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, {
            shell: true,
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timeoutId: NodeJS.Timeout;

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        child.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code !== 0 && code !== null) {
                reject(new Error(`Exit code ${code}: ${stderr || 'Unknown error'}`));
            } else {
                resolve({ stdout, stderr });
            }
        });

        child.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

/**
 * Tool Handlers - The Predator's Arsenal
 *
 * All handlers return strings for easy message passing.
 * Errors are caught and returned as formatted strings.
 */
export const toolHandlers: Record<string, ToolHandler> = {
    /**
     * Read file with optional offset and limit
     */
    read_file: async ({
        path: filePath,
        offset = 1,
        limit = 200,
    }: {
        path: string;
        offset?: number;
        limit?: number;
    }) => {
        const startTime = performance.now();
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            // Apply offset and limit
            const startIndex = Math.max(0, offset - 1);
            const endIndex = Math.min(lines.length, startIndex + limit);
            const slicedLines = lines.slice(startIndex, endIndex);

            const result = slicedLines.join('\n');
            const elapsed = Math.round(performance.now() - startTime);

            return `${result}\n\n[Read ${slicedLines.length}/${lines.length} lines in ${elapsed}ms]`;
        } catch (error: any) {
            return `Error reading file: ${error.message}`;
        }
    },

    /**
     * Write file with automatic directory creation
     */
    write_file: async ({
        path: filePath,
        content,
    }: {
        path: string;
        content: string;
    }) => {
        const startTime = performance.now();
        try {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully wrote ${content.length} chars to ${filePath} (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error writing file: ${error.message}`;
        }
    },

    /**
     * Edit file with surgical precision
     */
    edit_file: async ({
        path: filePath,
        old_string,
        new_string,
    }: {
        path: string;
        old_string: string;
        new_string: string;
    }) => {
        const startTime = performance.now();
        try {
            const content = await fs.readFile(filePath, 'utf-8');

            if (!content.includes(old_string)) {
                return `❌ Error: Could not find the text to replace in ${filePath}`;
            }

            const occurrences = content.split(old_string).length - 1;
            if (occurrences > 1) {
                return `⚠️ Warning: Found ${occurrences} occurrences. Replacing first one only.`;
            }

            const newContent = content.replace(old_string, new_string);
            await fs.writeFile(filePath, newContent, 'utf-8');

            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully edited ${filePath} - replaced ${old_string.length} chars with ${new_string.length} chars (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error editing file: ${error.message}`;
        }
    },

    /**
     * Delete file
     */
    delete_file: async ({ path: filePath }: { path: string }) => {
        const startTime = performance.now();
        try {
            await fs.unlink(filePath);
            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully deleted ${filePath} (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error deleting file: ${error.message}`;
        }
    },

    /**
     * List directory contents
     */
    list_directory: async ({
        path: dirPath,
        recursive = false,
        pattern = '*',
    }: {
        path: string;
        recursive?: boolean;
        pattern?: string;
    }) => {
        const startTime = performance.now();
        try {
            const searchPath = recursive
                ? path.join(dirPath, '**', pattern)
                : path.join(dirPath, pattern);

            const files = await glob(searchPath, { nodir: !recursive });
            const elapsed = Math.round(performance.now() - startTime);

            const formatted = files
                .sort()
                .slice(0, 100) // Limit output
                .map((f) => {
                    const isDir = f.endsWith('/');
                    return isDir ? `📁 ${f}` : `📄 ${f}`;
                })
                .join('\n');

            return `${formatted}\n\n[Found ${files.length} items in ${elapsed}ms]`;
        } catch (error: any) {
            return `❌ Error listing directory: ${error.message}`;
        }
    },

    /**
     * Create directory
     */
    create_directory: async ({ path: dirPath }: { path: string }) => {
        const startTime = performance.now();
        try {
            await fs.mkdir(dirPath, { recursive: true });
            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully created directory ${dirPath} (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error creating directory: ${error.message}`;
        }
    },

    /**
     * Run shell command with timeout and streaming
     */
    run_command: async ({
        command,
        cwd = '.',
        timeout = 60000,
    }: {
        command: string;
        cwd?: string;
        timeout?: number;
    }) => {
        const startTime = performance.now();
        try {
            const { stdout, stderr } = await executeCommand(command, cwd, timeout);
            const elapsed = Math.round(performance.now() - startTime);

            let result = '';
            if (stdout) {
                result += stdout;
            }
            if (stderr) {
                result += `\n\n[STDERR]:\n${stderr}`;
            }

            return `${result}\n\n[Executed in ${elapsed}ms]`;
        } catch (error: any) {
            const elapsed = Math.round(performance.now() - startTime);
            return `❌ Command failed (${elapsed}ms): ${error.message}`;
        }
    },

    /**
     * Search for patterns in files
     */
    grep: async ({
        pattern,
        searchPath = '.',
        glob: fileGlob = '*',
    }: {
        pattern: string;
        searchPath?: string;
        glob?: string;
    }) => {
        const startTime = performance.now();
        try {
            const files = await glob(path.join(searchPath, '**', fileGlob));
            const results: string[] = [];

            for (const file of files.slice(0, 100)) {
                try {
                    const content = await fs.readFile(file, 'utf-8');
                    const lines = content.split('\n');
                    for (let idx = 0; idx < lines.length; idx++) {
                        const line = lines[idx];
                        if (line.includes(pattern) || RegExp(pattern).test(line)) {
                            results.push(`${file}:${idx + 1}: ${line.trim()}`);
                        }
                    }
                } catch {
                    // Skip binary or unreadable files
                }
            }

            const elapsed = Math.round(performance.now() - startTime);
            return results.slice(0, 50).join('\n') + `\n\n[${results.length} matches in ${elapsed}ms]`;
        } catch (error: any) {
            return `❌ Error searching: ${error.message}`;
        }
    },

    /**
     * Find files matching a glob pattern
     */
    glob: async ({
        pattern,
        searchPath = '.',
    }: {
        pattern: string;
        searchPath?: string;
    }) => {
        const startTime = performance.now();
        try {
            const results = await glob(path.join(searchPath, pattern));
            const elapsed = Math.round(performance.now() - startTime);
            return results.slice(0, 100).join('\n') + `\n\n[${results.length} files in ${elapsed}ms]`;
        } catch (error: any) {
            return `❌ Error globbing: ${error.message}`;
        }
    },

    /**
     * Fetch URL content
     */
    fetch_url: async ({
        url,
        method = 'GET',
        headers = {},
    }: {
        url: string;
        method?: 'GET' | 'POST';
        headers?: Record<string, string>;
    }) => {
        const startTime = performance.now();
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'User-Agent': 'Murphy-Agent/3.0',
                    ...headers,
                },
            });

            const content = await response.text();
            const elapsed = Math.round(performance.now() - startTime);

            return `Status: ${response.status} ${response.statusText}\n\n${content.slice(0, 10000)}\n\n[${content.length} chars in ${elapsed}ms]`;
        } catch (error: any) {
            return `❌ Error fetching URL: ${error.message}`;
        }
    },
};

// Predator Evolution Step 14
