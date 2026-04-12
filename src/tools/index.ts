import fs from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import { resolveWorkspacePath } from '../utils/paths.js';
import { config } from '../utils/config.js';
import { lockManager } from '../utils/locks.js';

// execAsync removed - using spawn-based execution instead

export interface ToolResult {
    success: boolean;
    content?: string;
    error?: string;
    duration?: number;
    toolCallId?: string;
}

interface ToolHandler {
    (args: any, context?: {
        signal?: AbortSignal,
        onProgress?: (message: string) => void
    }): Promise<string>;
}

/**
 * Execute command with streaming output support
 */
async function executeCommand(
    command: string,
    cwd: string = '.',
    timeoutArg?: number,
    signal?: AbortSignal,
    onProgress?: (data: string) => void
): Promise<{ stdout: string; stderr: string }> {
    const timeout = timeoutArg || config.toolTimeout || 120000;
    const isWin = process.platform === 'win32';

    return new Promise((resolve, reject) => {
        const child = spawn(command, {
            shell: isWin ? 'powershell.exe' : true,
            cwd: resolveWorkspacePath(cwd),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timeoutId: NodeJS.Timeout;

        const MAX_OUTPUT = 10000;

        child.stdout.on('data', (data) => {
            const str = data.toString();
            if (onProgress) onProgress(str);

            if (stdout.length < MAX_OUTPUT) {
                stdout += str;
                if (stdout.length >= MAX_OUTPUT) {
                    stdout = stdout.slice(0, MAX_OUTPUT) + '\n...[STDOUT TRUNCATED]';
                }
            }
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            if (onProgress) onProgress(`[STDERR] ${str}`);

            if (stderr.length < MAX_OUTPUT) {
                stderr += str;
                if (stderr.length >= MAX_OUTPUT) {
                    stderr = stderr.slice(0, MAX_OUTPUT) + '\n...[STDERR TRUNCATED]';
                }
            }
        });

        timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                child.kill('SIGTERM');
                reject(new Error('Process killed by user via AbortSignal'));
            });
        }

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
            const safePath = resolveWorkspacePath(filePath);
            const stats = await fs.stat(safePath);
            const MAX_SIZE = 5 * 1024 * 1024; // 5MB safety limit

            if (stats.size > MAX_SIZE) {
                return `⚠️ Error: File is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum allowed is 5MB for safety. Use smaller read limits.`;
            }

            const content = await fs.readFile(safePath, 'utf-8');
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
        const release = await lockManager.acquire(filePath);
        try {
            const safePath = resolveWorkspacePath(filePath);
            const dir = path.dirname(safePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(safePath, content, 'utf-8');
            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully wrote ${content.length} chars to ${filePath} (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error writing file: ${error.message}`;
        } finally {
            release();
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
        const release = await lockManager.acquire(filePath);
        try {
            const safePath = resolveWorkspacePath(filePath);
            const content = await fs.readFile(safePath, 'utf-8');

            if (!content.includes(old_string)) {
                return `❌ Error: Could not find the text to replace in ${filePath}`;
            }

            const occurrences = content.split(old_string).length - 1;
            if (occurrences > 1) {
                return `⚠️ Warning: Found ${occurrences} occurrences. Replacing first one only.`;
            }

            const newContent = content.replaceAll(old_string, new_string);

            // Write a simple backup first
            await fs.writeFile(`${safePath}.bak`, content, 'utf-8');
            await fs.writeFile(safePath, newContent, 'utf-8');

            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully edited ${safePath} (backup created at .bak) - replaced ${old_string.length} chars with ${new_string.length} chars (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error editing file: ${error.message}`;
        } finally {
            release();
        }
    },

    /**
     * Delete file
     */
    delete_file: async ({ path: filePath }: { path: string }) => {
        const startTime = performance.now();
        const release = await lockManager.acquire(filePath);
        try {
            const safePath = resolveWorkspacePath(filePath);
            // Create backup dir for deleted files? For now, we'll just delete safely
            await fs.unlink(safePath);
            const elapsed = Math.round(performance.now() - startTime);
            return `✅ Successfully deleted ${filePath} (${elapsed}ms)`;
        } catch (error: any) {
            return `❌ Error deleting file: ${error.message}`;
        } finally {
            release();
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
            const safeDirPath = resolveWorkspacePath(dirPath);
            const searchPath = recursive
                ? path.join(safeDirPath, '**', pattern)
                : path.join(safeDirPath, pattern);

            // nodir: false to ensure we actually see directories when listing
            const files = await glob(searchPath, { nodir: false });
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
            const safePath = resolveWorkspacePath(dirPath);
            await fs.mkdir(safePath, { recursive: true });
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
        timeout,
    }: {
        command: string;
        cwd?: string;
        timeout?: number;
    }, context?: { signal?: AbortSignal; onProgress?: (msg: string) => void }) => {
        const startTime = performance.now();
        try {
            const { stdout, stderr } = await executeCommand(command, cwd, timeout, context?.signal, context?.onProgress);
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
        glob: searchGlob = '*',
    }: {
        pattern: string;
        searchPath?: string;
        glob?: string;
    }) => {
        const startTime = performance.now();
        const { createReadStream } = await import('fs');
        const { createInterface } = await import('readline');

        try {
            const files = await glob(path.join(resolveWorkspacePath(searchPath), '**', searchGlob));
            const results: string[] = [];
            const MAX_TOTAL_MATCHES = 100;

            let regex: RegExp | null = null;
            try {
                regex = new RegExp(pattern, 'i');
            } catch (e) {
                // Fallback to literal if regex invalid
            }

            for (const file of files.slice(0, 50)) {
                if (results.length >= MAX_TOTAL_MATCHES) break;

                try {
                    const stats = await fs.stat(file);
                    if (stats.size > 2 * 1024 * 1024) continue; // Skip files > 2MB for speed

                    const rl = createInterface({
                        input: createReadStream(file),
                        crlfDelay: Infinity
                    });

                    let lineNum = 0;
                    for await (const line of rl) {
                        lineNum++;
                        if ((regex && regex.test(line)) || line.includes(pattern)) {
                            results.push(`${path.relative(process.cwd(), file)}:${lineNum}: ${line.trim().slice(0, 500)}`);
                        }
                        if (results.length >= MAX_TOTAL_MATCHES) break;
                    }
                    rl.close();
                } catch {
                    // Skip inaccessible
                }
            }

            const elapsed = Math.round(performance.now() - startTime);
            return results.join('\n') + `\n\n[Found ${results.length} matches in ${elapsed}ms]`;
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
            const parsedUrl = new URL(url);
            const host = parsedUrl.hostname.toLowerCase();

            // Enhanced SSRF protection
            const isLocal = host === 'localhost' ||
                host === '127.0.0.1' ||
                host === '0.0.0.0' ||
                host === '::1' ||
                host.startsWith('192.168.') ||
                host.startsWith('10.') ||
                host.startsWith('172.') || // Covers 172.16.x.x - 172.31.x.x roughly
                host.startsWith('169.254.'); // Link-local

            if (isLocal) {
                throw new Error('SECURITY VIOLATION: Access to local or private network addresses is forbidden.');
            }

            const response = await fetch(url, {
                method,
                headers: {
                    'User-Agent': 'Murphy-Agent/3.1',
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












