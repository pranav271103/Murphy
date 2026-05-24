import { spawn, ChildProcess } from 'child_process';

/**
 * Native Language Server Protocol (LSP) Client for TypeScript
 */
export class LSPClient {
    private process: ChildProcess | null = null;
    private buffer = '';
    private nextId = 1;
    private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private rootPath: string;
    private initialized = false;

    constructor(rootPath: string) {
        this.rootPath = rootPath;
    }

    public async start(): Promise<void> {
        const isWin = process.platform === 'win32';
        
        // Spawn typescript-language-server using npx
        this.process = spawn(isWin ? 'npx.cmd' : 'npx', ['typescript-language-server', '--stdio'], {
            cwd: this.rootPath,
            env: process.env,
            shell: isWin ? 'powershell.exe' : true,
        });

        this.process.stdout?.on('data', (chunk) => {
            this.buffer += chunk.toString();
            this.processBuffer();
        });

        this.process.stderr?.on('data', (_data) => {
            // Silence stderr logging to avoid cluttering output
        });

        this.process.on('close', () => {
            this.cleanup();
        });

        // Wait a small buffer time and send initialize request
        await new Promise((r) => setTimeout(r, 1000));
        await this.initialize();
    }

    private cleanup(): void {
        for (const [_, req] of this.pendingRequests.entries()) {
            req.reject(new Error('LSP Server terminated'));
        }
        this.pendingRequests.clear();
        this.process = null;
        this.initialized = false;
    }

    public close(): void {
        if (this.process) {
            this.process.kill();
            this.cleanup();
        }
    }

    private processBuffer(): void {
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;

            const headers = this.buffer.slice(0, headerEnd);
            const contentLengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
                this.buffer = this.buffer.slice(headerEnd + 4);
                continue;
            }

            const contentLength = parseInt(contentLengthMatch[1], 10);
            const messageStart = headerEnd + 4;

            if (this.buffer.length < messageStart + contentLength) {
                break;
            }

            const bodyStr = this.buffer.slice(messageStart, messageStart + contentLength);
            this.buffer = this.buffer.slice(messageStart + contentLength);

            try {
                const message = JSON.parse(bodyStr);
                this.handleMessage(message);
            } catch (e) {
                // JSON parse error, ignore
            }
        }
    }

    private handleMessage(msg: any): void {
        if (msg.id !== undefined) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                    pending.reject(new Error(msg.error.message || 'JSON-RPC Error'));
                } else {
                    pending.resolve(msg.result);
                }
            }
        }
    }

    private sendRequest(method: string, params: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.process) {
                return reject(new Error('LSP server is not running'));
            }

            const id = this.nextId++;
            const payload = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            const json = JSON.stringify(payload);
            const requestStr = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;

            this.pendingRequests.set(id, { resolve, reject });
            this.process.stdin?.write(requestStr);
        });
    }

    private sendNotification(method: string, params: any): void {
        if (!this.process) return;

        const payload = {
            jsonrpc: '2.0',
            method,
            params,
        };

        const json = JSON.stringify(payload);
        const requestStr = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
        this.process.stdin?.write(requestStr);
    }

    private async initialize(): Promise<void> {
        const rootUri = `file:///${this.rootPath.replace(/\\/g, '/')}`;
        await this.sendRequest('initialize', {
            processId: process.pid,
            rootPath: this.rootPath,
            rootUri,
            capabilities: {
                textDocument: {
                    definition: { dynamicRegistration: true },
                    references: { dynamicRegistration: true },
                }
            },
        });

        this.sendNotification('initialized', {});
        this.initialized = true;
    }

    public async openDocument(filePath: string, text: string): Promise<void> {
        if (!this.initialized) return;
        const uri = `file:///${filePath.replace(/\\/g, '/')}`;
        this.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: 'typescript',
                version: 1,
                text,
            },
        });
    }

    public async getDefinition(filePath: string, line: number, character: number): Promise<any> {
        if (!this.initialized) await this.start();
        const uri = `file:///${filePath.replace(/\\/g, '/')}`;
        return this.sendRequest('textDocument/definition', {
            textDocument: { uri },
            position: { line: line - 1, character: character - 1 },
        });
    }

    public async getReferences(filePath: string, line: number, character: number): Promise<any> {
        if (!this.initialized) await this.start();
        const uri = `file:///${filePath.replace(/\\/g, '/')}`;
        return this.sendRequest('textDocument/references', {
            textDocument: { uri },
            position: { line: line - 1, character: character - 1 },
            context: { includeDeclaration: true },
        });
    }
}
