import { NVIDIAProvider, ModelType } from '../providers/nvidia.js';
import { MODEL_CONFIG } from '../agent/constants.js';
import { tools } from '../tools/definitions.js';
import { toolHandlers, ToolResult } from '../tools/index.js';
import { performance } from 'perf_hooks';

export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: any[];
}

export interface ToolExecutionEvent {
    id: string;
    name: string;
    args: any;
    status: 'pending' | 'running' | 'success' | 'failure' | 'recovered';
    duration: number;
    startTime: number;
    result?: string;
    error?: string;
    retryCount?: number;
}

export interface LoopTelemetry {
    iteration: number;
    phase: 'reasoning' | 'execution' | 'recovery';
    modelLatency: number;
    totalElapsed: number;
    activeTools: number;
    completedTools: number;
    failedTools: number;
}

export type UpdateType =
    | 'phase_change'
    | 'model_start'
    | 'model_stream'
    | 'model_complete'
    | 'tool_queued'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_complete'
    | 'tool_failed'
    | 'tool_recovered'
    | 'telemetry'
    | 'completed'
    | 'error';

export interface UpdatePayload {
    type: UpdateType;
    data?: any;
}

/**
 * Text-to-Tool Parser - Extracts tool calls from malformed responses
 */
const TEXT_TOOL_PATTERNS = [
    /<tool_call>\s*(?:<function=)?([\w-]+)>?\s*(?:<arguments=)?([\s\S]*?)(?:<\/arguments>)?(?:<\/tool_call>)/g,
    /<tool_call>\s*```(?:json)?\s*\{\s*"name"\s*:\s*"([\w-]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\s*```\s*<\/tool_call>/gi
];

/**
 * Strip XML tags from content for clean UI display
 */
export const stripXml = (text: string): string => {
    if (!text) return '';
    return text
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
};

/**
 * Murphy Agent Loop - The High-Speed Coding Predator
 *
 * Key Features:
 * - Dual-model orchestration (Kimi K2 for reasoning, Qwen3 for execution)
 * - Parallel tool execution
 * - Auto-recovery from errors
 * - User abort support
 * - Proper error boundaries
 */
export class AgentLoop {
    private provider: NVIDIAProvider;
    private messages: Message[] = [];
    private telemetry: LoopTelemetry;
    private executionLog: ToolExecutionEvent[] = [];
    private readonly MAX_ITERATIONS = 100;
    private readonly MAX_RETRIES = 2;
    private abortController: AbortController | null = null;
    private isAborted = false;

    public getIsProcessing(): boolean {
        return this.abortController !== null && !this.isAborted;
    }

    constructor(systemPrompt: string, initialMessages?: Message[]) {
        this.provider = new NVIDIAProvider();
        if (initialMessages && initialMessages.length > 0) {
            this.messages = [...initialMessages];
        } else {
            this.messages = [{ role: 'system', content: systemPrompt }];
        }
        this.telemetry = {
            iteration: 0,
            phase: 'reasoning',
            modelLatency: 0,
            totalElapsed: 0,
            activeTools: 0,
            completedTools: 0,
            failedTools: 0,
        };
    }

    public getMessages(): Message[] {
        return [...this.messages];
    }

    /**
     * Extract tool calls from text as fallback
     */
    private parseTextToolCalls(text: string): any[] {
        const toolCalls: any[] = [];

        for (const pattern of TEXT_TOOL_PATTERNS) {
            const regex = new RegExp(pattern.source, 'gi');
            let match;

            while ((match = regex.exec(text)) !== null) {
                const name = match[1]?.trim();
                let argsBlob = match[2] || '{}';

                if (!name) continue;

                try {
                    let args = {};
                    try {
                        args = JSON.parse(argsBlob);
                    } catch {
                        args = { raw: argsBlob };
                    }

                    toolCalls.push({
                        id: `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        type: 'function',
                        function: {
                            name,
                            arguments: typeof args === 'string' ? args : JSON.stringify(args),
                        },
                    });
                } catch (e) {
                    // Skip malformed
                }
            }
        }

        return toolCalls;
    }

    /**
     * Execute a single tool with retry and recovery
     */
    private async executeTool(
        toolCall: any,
        onUpdate: (type: UpdateType, data: any) => void,
        askPermission?: (tool: string, args: any) => Promise<boolean>,
        options?: { signal?: AbortSignal }
    ): Promise<ToolResult> {
        const event: ToolExecutionEvent = {
            id: toolCall.id || `tool_${Date.now()}`,
            name: (toolCall.function?.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, ''),
            args: {},
            status: 'pending',
            duration: 0,
            startTime: performance.now(),
            retryCount: 0,
        };

        // Parse args safely
        try {
            event.args = JSON.parse(toolCall.function?.arguments || '{}');
        } catch {
            event.args = { raw: toolCall.function?.arguments };
        }

        this.executionLog.push(event);
        onUpdate('tool_queued', { event });

        // Check for abort
        if (options?.signal?.aborted || this.isAborted) {
            event.status = 'failure';
            event.error = 'Aborted by user';
            event.duration = Math.round(performance.now() - event.startTime);
            onUpdate('tool_failed', { event, error: 'Aborted' });
            return { success: false, error: 'Aborted by user', duration: event.duration, toolCallId: toolCall.id };
        }

        const handler = (toolHandlers as any)[event.name];
        if (!handler) {
            event.status = 'failure';
            event.error = `Unknown tool: '${event.name}' (Length: ${event.name.length}, type: ${typeof event.name}). Handlers: ${Object.keys(toolHandlers || {}).join(',')}`;
            event.duration = Math.round(performance.now() - event.startTime);
            onUpdate('tool_failed', { event });
            return { success: false, error: event.error, duration: event.duration, toolCallId: toolCall.id };
        }

        // Permission check for dangerous tools
        const requiresPermission = ['run_command', 'delete_file', 'edit_file', 'write_file'].includes(event.name);
        if (requiresPermission && askPermission) {
            onUpdate('phase_change', { phase: 'waiting', message: `⏸️  Waiting for permission: ${event.name}` });
            const allowed = await askPermission(event.name, event.args);
            if (!allowed) {
                event.status = 'failure';
                event.error = 'Permission denied by user';
                onUpdate('tool_failed', { event });
                return { success: false, error: event.error, duration: 0, toolCallId: toolCall.id };
            }
        }

        // Execute with retry
        let lastError: string | undefined;
        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            if (options?.signal?.aborted || this.isAborted) {
                event.status = 'failure';
                event.error = 'Aborted by user';
                event.duration = Math.round(performance.now() - event.startTime);
                onUpdate('tool_failed', { event, error: 'Aborted' });
                return { success: false, error: 'Aborted by user', duration: event.duration, toolCallId: toolCall.id };
            }

            event.retryCount = attempt;
            event.status = 'running';
            onUpdate('tool_start', { event, attempt });

            try {
                const result = await handler(event.args, { signal: options?.signal });

                event.status = 'success';
                event.result = String(result).slice(0, 5000); // Limit stored result
                event.duration = Math.round(performance.now() - event.startTime);

                this.telemetry.completedTools++;
                this.telemetry.activeTools--;
                onUpdate('tool_complete', { event, result: String(result).slice(0, 1000) });

                return {
                    success: true,
                    content: String(result),
                    duration: event.duration,
                    toolCallId: toolCall.id,
                };
            } catch (error: any) {
                lastError = error.message || 'Unknown error';
                event.error = lastError;

                if (attempt < this.MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
                }
            }
        }

        // All retries failed
        event.status = 'failure';
        event.duration = Math.round(performance.now() - event.startTime);
        this.telemetry.failedTools++;
        this.telemetry.activeTools--;

        onUpdate('tool_failed', { event, error: lastError });

        return {
            success: false,
            error: lastError || 'Unknown error',
            duration: event.duration,
            toolCallId: toolCall.id,
        };
    }

    /**
     * Execute tools in parallel
     */
    private async executeToolsParallel(
        toolCalls: any[],
        onUpdate: (type: UpdateType, data: any) => void,
        askPermission?: (tool: string, args: any) => Promise<boolean>,
        options?: { signal?: AbortSignal }
    ): Promise<{ results: ToolResult[]; toolMessages: Message[] }> {
        this.telemetry.activeTools += toolCalls.length;

        // Execute with concurrency limit
        const results: ToolResult[] = [];
        const batchSize = 5; // Limit concurrent executions

        for (let i = 0; i < toolCalls.length; i += batchSize) {
            const batch = toolCalls.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map((tc) => this.executeTool(tc, onUpdate, askPermission, options))
            );
            results.push(...batchResults);
        }

        const toolMessages: Message[] = results.map((result) => ({
            role: 'tool',
            content: result.success ? result.content!.slice(0, 10000) : `Error: ${result.error}`,
            tool_call_id: result.toolCallId!,
        }));

        return { results, toolMessages };
    }

    /**
     * Check if loop should continue
     */
    private consecutiveNoToolIterations = 0;

    private shouldContinue(): boolean {
        const lastMessage = this.messages[this.messages.length - 1];
        if (!lastMessage) return false;

        // Continue if user just sent a message
        if (lastMessage.role === 'user') return true;

        // Continue if tool results need processing
        if (lastMessage.role === 'tool') return true;

        // Continue if assistant made tool calls
        if (lastMessage.role === 'assistant' && lastMessage.tool_calls?.length) {
            this.consecutiveNoToolIterations = 0;
            return true;
        }

        // Check for unfulfilled tool calls
        const totalToolCalls = this.messages
            .filter((m) => m.role === 'assistant' && m.tool_calls)
            .flatMap((m) => m.tool_calls || []).length;
        const totalToolResults = this.messages.filter((m) => m.role === 'tool').length;
        if (totalToolCalls > totalToolResults) return true;

        // Stop if assistant gave text with no tools twice in a row
        if (lastMessage.role === 'assistant' && !lastMessage.tool_calls?.length) {
            this.consecutiveNoToolIterations++;
            if (this.consecutiveNoToolIterations >= 2) {
                return false;
            }
        }

        // Safety brake
        if (this.messages.length > 50) return false;
        if (this.telemetry.iteration >= this.MAX_ITERATIONS) return false;

        return true;
    }

    /**
     * Main processing loop with proper abort support
     */
    async process(
        userInput: string,
        onUpdate: (type: UpdateType, data: any) => void,
        askPermission?: (tool: string, args: any) => Promise<boolean>,
        options?: { signal?: AbortSignal }
    ): Promise<{ response: string; telemetry: LoopTelemetry; executionLog: ToolExecutionEvent[] }> {
        const startTimeTotal = performance.now();
        this.abortController = new AbortController();
        this.isAborted = false;

        // Listen to external abort signal
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.abort();
            });
        }

        const signal = this.abortController.signal;

        // Reset state
        this.consecutiveNoToolIterations = 0;
        this.executionLog = [];

        // Check for simple greetings
        const userInputLower = userInput.trim().toLowerCase();
        const socialGreetings = ['hi', 'hello', 'hey', 'who are you', 'how are you', 'what are you'];
        if (socialGreetings.includes(userInputLower)) {
            const response = "I am MURPHY, the High-Speed Coding Predator.\n\nI can help you with:\n- Writing and editing code\n- Running commands\n- Searching and analyzing files\n- Web requests\n\nWhat would you like to build?";
            this.messages.push({ role: 'user', content: userInput });
            this.messages.push({ role: 'assistant', content: response });
            onUpdate('completed', { response, telemetry: this.telemetry, executionLog: [] });
            return { response, telemetry: this.telemetry, executionLog: [] };
        }

        // Add user message
        this.messages.push({ role: 'user', content: userInput });
        onUpdate('phase_change', { phase: 'reasoning', message: '🧠 Planning' });

        let lastError: Error | null = null;
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 3;

        try {
            while (this.telemetry.iteration < this.MAX_ITERATIONS) {
                // Check abort
                if (signal.aborted || this.isAborted) {
                    this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);
                    return {
                        response: '⏹️ Task aborted.',
                        telemetry: { ...this.telemetry },
                        executionLog: [...this.executionLog],
                    };
                }

                // Prune old context if needed
                if (this.messages.length > 40) {
                    onUpdate('phase_change', { phase: 'reasoning', message: '🧹 Pruning context...' });
                    const sysPrompt = this.messages[0];
                    const recentMsgs = this.messages.slice(-25);
                    this.messages = [sysPrompt, ...recentMsgs];
                }

                this.telemetry.iteration++;
                this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);

                const phase: ModelType = this.telemetry.iteration === 1 ? 'reasoning' : 'execution';
                this.telemetry.phase = phase;

                onUpdate('telemetry', { telemetry: { ...this.telemetry } });
                onUpdate('model_start', { phase, iteration: this.telemetry.iteration });

                try {
                    // Get completion
                    const modelStartTime = performance.now();
                    const response = await this.provider.getCompletion({
                        messages: this.messages,
                        modelType: phase,
                        tools: phase === 'execution' ? tools : undefined,
                        temperature: phase === 'reasoning' ? MODEL_CONFIG.reasoning.temperature : MODEL_CONFIG.execution.temperature,
                        maxTokens: phase === 'reasoning' ? MODEL_CONFIG.reasoning.maxTokens : MODEL_CONFIG.execution.maxTokens,
                        onStream: (chunk) => {
                            if (!signal.aborted) {
                                onUpdate('model_stream', { chunk, phase });
                            }
                        },
                        signal,
                    });

                    this.telemetry.modelLatency = Math.round(performance.now() - modelStartTime);
                    consecutiveErrors = 0;

                    if (!response) {
                        throw new Error('Empty response from model');
                    }

                    onUpdate('model_complete', {
                        phase,
                        latency: this.telemetry.modelLatency,
                        content: response.content,
                    });

                    // Extract tool calls
                    let toolCalls = response.tool_calls || [];
                    if (toolCalls.length === 0 && response.content) {
                        toolCalls = this.parseTextToolCalls(response.content);
                    }

                    // Add assistant message
                    const assistantMessage: Message = {
                        role: 'assistant',
                        content: response.content || '',
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                    };
                    this.messages.push(assistantMessage);

                    // Execute tools if any
                    if (toolCalls.length > 0) {
                        onUpdate('phase_change', {
                            phase: 'execution',
                            message: `🔧 Executing ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}`,
                        });

                        const { results, toolMessages } = await this.executeToolsParallel(
                            toolCalls, onUpdate, askPermission, { signal }
                        );

                        this.messages.push(...toolMessages);

                        // Handle failures
                        const failures = results.filter((r) => !r.success);
                        if (failures.length > 0) {
                            this.messages.push({
                                role: 'system',
                                content: `Some tools failed: ${failures.map(f => f.error).join(', ')}. Try alternatives.`,
                            });
                        }

                        continue;
                    }

                    // Check if done
                    if (!this.shouldContinue()) {
                        const finalResponse = response.content || '';
                        this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);

                        onUpdate('completed', {
                            response: finalResponse,
                            telemetry: { ...this.telemetry },
                            executionLog: [...this.executionLog],
                        });

                        return {
                            response: finalResponse,
                            telemetry: { ...this.telemetry },
                            executionLog: [...this.executionLog],
                        };
                    }

                } catch (iterationError: any) {
                    consecutiveErrors++;
                    lastError = iterationError;

                    // Check if aborted
                    if (signal.aborted || iterationError.message?.includes('abort') || iterationError.name === 'AbortError') {
                        throw new Error('Aborted by user');
                    }

                    onUpdate('phase_change', {
                        phase: 'recovery',
                        message: `🔄 Error recovery (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})...`,
                    });

                    this.messages.push({
                        role: 'system',
                        content: `Error occurred: ${iterationError.message}. Continue with task using alternative approach.`,
                    });

                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        const errorResponse = `⚠️ Task failed after ${MAX_CONSECUTIVE_ERRORS} attempts. Last error: ${lastError?.message}`;
                        this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);

                        onUpdate('completed', {
                            response: errorResponse,
                            telemetry: { ...this.telemetry },
                            executionLog: [...this.executionLog],
                        });

                        return {
                            response: errorResponse,
                            telemetry: { ...this.telemetry },
                            executionLog: [...this.executionLog],
                        };
                    }

                    await new Promise(r => setTimeout(r, 500));
                }
            }

            // Max iterations
            const lastMessage = this.messages[this.messages.length - 1];
            const response = lastMessage?.role === 'assistant'
                ? lastMessage.content || 'Task completed.'
                : 'Task processed.';

            this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);
            onUpdate('completed', { response, telemetry: { ...this.telemetry }, executionLog: [...this.executionLog] });

            return {
                response,
                telemetry: { ...this.telemetry },
                executionLog: [...this.executionLog],
            };

        } catch (error: any) {
            this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);

            const errorResponse = error.message?.includes('abort')
                ? '⏹️ Task aborted.'
                : `💥 Error: ${error.message}`;

            onUpdate('completed', {
                response: errorResponse,
                telemetry: { ...this.telemetry },
                executionLog: [...this.executionLog],
            });

            return {
                response: errorResponse,
                telemetry: { ...this.telemetry },
                executionLog: [...this.executionLog],
            };
        } finally {
            this.abortController = null;
            this.isAborted = false;
        }
    }

    /**
     * Abort current operation
     */
    abort(): void {
        this.isAborted = true;
        this.abortController?.abort();
    }

    /**
     * Reset agent state
     */
    reset(systemPrompt: string): void {
        this.messages = [{ role: 'system', content: systemPrompt }];
        this.executionLog = [];
        this.telemetry = {
            iteration: 0,
            phase: 'reasoning',
            modelLatency: 0,
            totalElapsed: 0,
            activeTools: 0,
            completedTools: 0,
            failedTools: 0,
        };
        this.abortController = null;
        this.isAborted = false;
        this.consecutiveNoToolIterations = 0;
    }
}
