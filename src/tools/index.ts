import fs from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { glob } from 'glob';
import { performance } from 'perf_hooks';
import { resolveWorkspacePath } from '../utils/paths.js';
import { config } from '../utils/config.js';
import { lockManager } from '../utils/locks.js';
import { LSPClient } from '../utils/lsp.js';

let lspClient: LSPClient | null = null;
async function getLspClient(): Promise<LSPClient> {
    if (!lspClient) {
        lspClient = new LSPClient(config.defaultCwd);
        await lspClient.start();
    }
    return lspClient;
}

process.on('exit', () => {
    if (lspClient) {
        lspClient.close();
    }
});

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
 * Helper to perform fuzzy code replacement when exact matching fails
 */
function fuzzyReplace(content: string, oldString: string, newString: string): string | null {
    // Try exact replacement first
    if (content.includes(oldString)) {
        return content.replaceAll(oldString, newString);
    }

    const normalize = (str: string) => str.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    const normalizedContent = normalize(content);
    const normalizedOld = normalize(oldString);

    if (!normalizedContent.includes(normalizedOld)) {
        return null;
    }

    const contentLines = content.split(/\r?\n/);
    const oldLines = oldString.split(/\r?\n/);

    const normContentLines = contentLines.map(l => l.replace(/[ \t]+/g, ' ').trim());
    const normOldLines = oldLines.map(l => l.replace(/[ \t]+/g, ' ').trim());

    let matchIndex = -1;
    for (let i = 0; i <= normContentLines.length - normOldLines.length; i++) {
        let match = true;
        for (let j = 0; j < normOldLines.length; j++) {
            if (normContentLines[i + j] !== normOldLines[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            if (matchIndex !== -1) {
                // Multiple matches found, abort fuzzy replace for safety
                return null;
            }
            matchIndex = i;
        }
    }

    if (matchIndex !== -1) {
        const updatedLines = [
            ...contentLines.slice(0, matchIndex),
            ...newString.split(/\r?\n/),
            ...contentLines.slice(matchIndex + normOldLines.length)
        ];
        return updatedLines.join('\n');
    }

    if (oldLines.length === 1) {
        const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        try {
            const regex = new RegExp(escaped, 'g');
            if (regex.test(content)) {
                return content.replace(regex, newString);
            }
        } catch {
            // Ignore regex issues
        }
    }

    return null;
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

            const newContent = fuzzyReplace(content, old_string, new_string);
            if (newContent === null) {
                return `❌ Error: Could not find the text block to replace in ${filePath} (even using fuzzy whitespace matching)`;
            }

            // Write a simple backup first
            await fs.writeFile(`${safePath}.bak`, content, 'utf-8');
            await fs.writeFile(safePath, newContent, 'utf-8');

            const elapsed = Math.round(performance.now() - startTime);
            const isExact = content.includes(old_string);
            return `✅ Successfully edited ${safePath} (backup created at .bak) - replaced ${old_string.length} chars with ${new_string.length} chars (${elapsed}ms, mode: ${isExact ? 'exact' : 'fuzzy'})`;
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
    analyze_project: async (args: { depth?: number }) => {
        try {
            const depth = args.depth || 2;
            const files = await glob('**/*', { 
                ignore: ['node_modules/**', 'dist/**', '.git/**'],
                maxDepth: depth 
            });
            
            const structure = files.reduce((acc: any, file) => {
                const parts = file.split('/');
                let current = acc;
                parts.forEach((part, i) => {
                    if (!current[part]) {
                        current[part] = i === parts.length - 1 ? 'file' : {};
                    }
                    current = current[part];
                });
                return acc;
            }, {});

            return `Project Radar Scan (Depth ${depth}):\n${JSON.stringify(structure, null, 2)}\n\nFound ${files.length} key files. Use read_file on entry points to begin mission.`;
        } catch (error: any) {
            return `❌ Analysis Error: ${error.message}`;
        }
    },

    lsp_get_definition: async ({ path: filePath, line, character }: { path: string; line: number; character: number }) => {
        try {
            const client = await getLspClient();
            const safePath = resolveWorkspacePath(filePath);
            
            try {
                const text = await fs.readFile(safePath, 'utf-8');
                await client.openDocument(safePath, text);
            } catch {
                // Ignore open failures
            }

            const defs = await client.getDefinition(safePath, line, character);
            if (!defs || (Array.isArray(defs) && defs.length === 0)) {
                return `ℹ️ No definition found for symbol at ${filePath}:${line}:${character}`;
            }

            const formatLocation = (loc: any) => {
                const targetUri = loc.uri || loc.targetUri || '';
                const targetRange = loc.range || loc.targetSelectionRange || loc.targetRange || {};
                const start = targetRange.start || {};
                
                let cleanedPath = targetUri.replace(/^file:\/\/\//, '');
                cleanedPath = decodeURIComponent(cleanedPath);
                if (process.platform === 'win32' && /^[a-zA-Z]:/.test(cleanedPath)) {
                    cleanedPath = cleanedPath.replace(/\//g, '\\');
                } else {
                    cleanedPath = '/' + cleanedPath;
                }

                const relativePath = path.relative(process.cwd(), cleanedPath);
                return `📍 Definition found in ${relativePath} at line ${(start.line || 0) + 1}, column ${(start.character || 0) + 1}`;
            };

            if (Array.isArray(defs)) {
                return defs.map(formatLocation).join('\n');
            } else {
                return formatLocation(defs);
            }
        } catch (error: any) {
            return `❌ LSP Error: ${error.message}`;
        }
    },

    lsp_get_references: async ({ path: filePath, line, character }: { path: string; line: number; character: number }) => {
        try {
            const client = await getLspClient();
            const safePath = resolveWorkspacePath(filePath);
            
            try {
                const text = await fs.readFile(safePath, 'utf-8');
                await client.openDocument(safePath, text);
            } catch {
                // Ignore open failures
            }

            const refs = await client.getReferences(safePath, line, character);
            if (!refs || refs.length === 0) {
                return `ℹ️ No references found for symbol at ${filePath}:${line}:${character}`;
            }

            const formatted = refs.map((ref: any) => {
                const start = ref.range?.start || {};
                let cleanedPath = ref.uri.replace(/^file:\/\/\//, '');
                cleanedPath = decodeURIComponent(cleanedPath);
                if (process.platform === 'win32' && /^[a-zA-Z]:/.test(cleanedPath)) {
                    cleanedPath = cleanedPath.replace(/\//g, '\\');
                } else {
                    cleanedPath = '/' + cleanedPath;
                }
                const relativePath = path.relative(process.cwd(), cleanedPath);
                return `🔗 ${relativePath}:${(start.line || 0) + 1}:${(start.character || 0) + 1}`;
            }).join('\n');

            return `Found ${refs.length} references:\n${formatted}`;
        } catch (error: any) {
            return `❌ LSP Error: ${error.message}`;
        }
    }
};












