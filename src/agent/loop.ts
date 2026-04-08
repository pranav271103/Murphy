import { NVIDIAProvider, ModelType } from '../providers/nvidia.js';
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
 * The Unbreakable Engine: Text-to-Tool Parser
 * Surgically extracts tool calls from malformed responses
 */
const TEXT_TOOL_PATTERNS = [
    // Pattern 1: XML-style tool_call tags
    /<tool_call>[\s\S]*?<function=(\w+)(?:[\s\S]*?arguments=({[\s\S]*?}))?[\s\S]*?<\/tool_call>/g,
    // Pattern 2: Markdown code blocks with tool syntax
    /```(?:tool|function)?\s*\n?(\w+)\s*\n([\s\S]*?)```/g,
    // Pattern 3: JSON-like tool invocations
    /\{\s*"?tool"?:\s*"(\w+)"\s*,\s*"?arguments"?:\s*(\{[\s\S]*?\})\s*\}/g,
];

/**
 * Murphy Agent Loop - The High-Speed Coding Predator
 *
 * Architecture:
 * 1. DUAL-MODEL ORCHESTRATION: Kimi K2 for reasoning, Qwen3 for execution
 * 2. PARALLEL PIPELINE: Promise.all for concurrent tool execution
 * 3. AUTO-RECOVERY: Self-healing when tools fail
 * 4. ZERO-STALL: Text-to-Tool fallback ensures loop never stalls
 */
export class AgentLoop {
    private provider: NVIDIAProvider;
    private messages: Message[] = [];
    private telemetry: LoopTelemetry;
    private executionLog: ToolExecutionEvent[] = [];
    private readonly MAX_ITERATIONS = 25;
    private readonly MAX_RETRIES = 2;
    private abortController: AbortController | null = null;

    constructor(systemPrompt: string) {
        this.provider = new NVIDIAProvider();
        this.messages = [{ role: 'system', content: systemPrompt }];
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

    /**
     * The Unbreakable Parser: Extracts tool calls from any text format
     * Never let the loop stall on malformed responses
     */
    private parseTextToolCalls(text: string): any[] {
        const toolCalls: any[] = [];

        for (const pattern of TEXT_TOOL_PATTERNS) {
            const regex = new RegExp(pattern.source, 'g');
            let match;

            while ((match = regex.exec(text)) !== null) {
                const name = match[1]?.trim();
                const argsStr = match[2]?.trim() || '{}';

                if (!name) continue;

                try {
                    // Try to parse arguments as JSON
                    let args = {};
                    try {
                        args = JSON.parse(argsStr);
                    } catch {
                        // If not valid JSON, treat as raw string
                        args = { raw: argsStr };
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
                    // Silently skip malformed matches - predator doesn't complain
                }
            }
        }

        return toolCalls;
    }

    /**
     * Execute a single tool with automatic retry and recovery
     */
    private async executeTool(
        toolCall: any,
        onUpdate: (type: UpdateType, data: any) => void
    ): Promise<ToolResult> {
        const event: ToolExecutionEvent = {
            id: toolCall.id,
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}'),
            status: 'pending',
            duration: 0,
            startTime: performance.now(),
            retryCount: 0,
        };

        this.executionLog.push(event);
        onUpdate('tool_queued', { event });

        const handler = (toolHandlers as any)[event.name];
        if (!handler) {
            event.status = 'failure';
            event.error = `Unknown tool: ${event.name}`;
            event.duration = Math.round(performance.now() - event.startTime);
            onUpdate('tool_failed', { event });
            return { success: false, error: event.error, duration: event.duration };
        }

        // Execute with retry logic
        let lastError: string | undefined;
        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            event.retryCount = attempt;
            event.status = 'running';
            onUpdate('tool_start', { event, attempt });

            try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const result = await handler(args);

                event.status = 'success';
                event.result = String(result);
                event.duration = Math.round(performance.now() - event.startTime);

                this.telemetry.completedTools++;
                this.telemetry.activeTools--;
                onUpdate('tool_complete', { event, result });

                return {
                    success: true,
                    content: String(result),
                    duration: event.duration,
                    toolCallId: toolCall.id,
                };
            } catch (error: any) {
                lastError = error.message;
                event.error = lastError;

                if (attempt < this.MAX_RETRIES) {
                    // Brief pause before retry (exponential backoff)
                    await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
                }
            }
        }

        // All retries exhausted - mark as failed but try recovery
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
     * Execute tools in parallel using Promise.all for maximum speed
     */
    private async executeToolsParallel(
        toolCalls: any[],
        onUpdate: (type: UpdateType, data: any) => void
    ): Promise<{ results: ToolResult[]; toolMessages: Message[] }> {
        this.telemetry.activeTools += toolCalls.length;

        const promises = toolCalls.map((tc) => this.executeTool(tc, onUpdate));
        const results = await Promise.all(promises);

        const toolMessages: Message[] = results.map((result) => ({
            role: 'tool',
            content: result.success ? result.content! : `Error: ${result.error}`,
            tool_call_id: result.toolCallId!,
        }));

        return { results, toolMessages };
    }

    /**
     * Check if we should continue the loop or if task is complete
     */
    private shouldContinue(): boolean {
        const lastMessage = this.messages[this.messages.length - 1];

        // Continue if last message was from user or tool
        if (lastMessage.role === 'user' || lastMessage.role === 'tool') {
            return true;
        }

        // Continue if assistant made tool calls (waiting for results)
        if (lastMessage.role === 'assistant' && lastMessage.tool_calls?.length) {
            return true;
        }

        // Check if there are unfulfilled tool calls
        const pendingToolCalls = this.messages.filter((m) => m.role === 'assistant' && m.tool_calls).flatMap((m) => m.tool_calls || []);
        const completedToolCalls = this.messages.filter((m) => m.role === 'tool');

        return pendingToolCalls.length > completedToolCalls.length;
    }

    /**
     * Main processing loop - The Predator's Brain
     */
    async process(
        userInput: string,
        onUpdate: (type: UpdateType, data: any) => void,
        options?: { signal?: AbortSignal }
    ): Promise<{ response: string; telemetry: LoopTelemetry; executionLog: ToolExecutionEvent[] }> {
        const startTimeTotal = performance.now();
        this.abortController = new AbortController();
        const signal = options?.signal || this.abortController.signal;

        // Add user message
        this.messages.push({ role: 'user', content: userInput });
        onUpdate('phase_change', { phase: 'reasoning', message: 'Strategic Planning Phase' });

        try {
            while (this.telemetry.iteration < this.MAX_ITERATIONS) {
                if (signal.aborted) {
                    throw new Error('Operation aborted by user');
                }

                this.telemetry.iteration++;
                this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);

                const phase: ModelType = this.telemetry.iteration === 1 ? 'reasoning' : 'execution';
                this.telemetry.phase = phase;

                onUpdate('telemetry', { telemetry: { ...this.telemetry } });
                onUpdate('model_start', { phase, iteration: this.telemetry.iteration });

                // Phase 1: Strategic Planning (Kimi K2) or Execution (Qwen3)
                const modelStartTime = performance.now();
                const response = await this.provider.getCompletion({
                    messages: this.messages,
                    modelType: phase,
                    tools: phase === 'execution' ? tools : undefined,
                    temperature: phase === 'reasoning' ? 0.3 : 0.1,
                    onStream: (chunk) => {
                        onUpdate('model_stream', { chunk, phase });
                    },
                    signal,
                });

                this.telemetry.modelLatency = Math.round(performance.now() - modelStartTime);

                if (!response) {
                    throw new Error('Empty response from model');
                }

                onUpdate('model_complete', {
                    phase,
                    latency: this.telemetry.modelLatency,
                    content: response.content,
                });

                // Handle BOTH official tool_calls and manual text fallbacks
                let toolCalls = response.tool_calls || [];

                // The Unbreakable Fallback: Parse text if no official tool calls
                if (toolCalls.length === 0 && response.content) {
                    toolCalls = this.parseTextToolCalls(response.content);
                    if (toolCalls.length > 0) {
                        onUpdate('phase_change', {
                            phase: 'recovery',
                            message: 'Text-to-Tool Fallback Activated',
                        });
                    }
                }

                // Add assistant message to history
                const assistantMessage: Message = {
                    role: 'assistant',
                    content: response.content || '',
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                };
                this.messages.push(assistantMessage);

                // Phase 2: Parallel Tool Execution (if tools requested)
                if (toolCalls.length > 0) {
                    onUpdate('phase_change', {
                        phase: 'execution',
                        message: `Executing ${toolCalls.length} Tool${toolCalls.length > 1 ? 's' : ''}`,
                    });

                    const { results, toolMessages } = await this.executeToolsParallel(toolCalls, onUpdate);

                    // Add tool results to message history
                    this.messages.push(...toolMessages);

                    // Check for failures and trigger recovery if needed
                    const failures = results.filter((r) => !r.success);
                    if (failures.length > 0 && failures.length === results.length) {
                        // All tools failed - trigger recovery mode
                        onUpdate('phase_change', {
                            phase: 'recovery',
                            message: `Recovery Mode: ${failures.length} Tool Failure${failures.length > 1 ? 's' : ''}`,
                        });
                    }

                    // Continue loop to analyze results
                    continue;
                }

                // No tool calls - check if we're done
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

                // Continue for next iteration
            }

            // Max iterations reached
            const response = 'Operational limit reached. Task may be incomplete.';
            onUpdate('completed', { response, telemetry: { ...this.telemetry } });

            return {
                response,
                telemetry: { ...this.telemetry },
                executionLog: [...this.executionLog],
            };
        } catch (error: any) {
            this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);
            onUpdate('error', { error: error.message, telemetry: { ...this.telemetry } });

            return {
                response: `Critical Engine Failure: ${error.message}`,
                telemetry: { ...this.telemetry },
                executionLog: [...this.executionLog],
            };
        }
    }

    /**
     * Abort current operation
     */
    abort(): void {
        this.abortController?.abort();
    }

    /**
     * Reset the agent state
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
    }
}

// Predator Evolution Step 15

// Predator Evolution Step 17

// Predator Evolution Step 21

// Predator Evolution Step 29

// Predator Evolution Step 31

// Predator Evolution Step 36

// Predator Evolution Step 39

// Predator Evolution Step 40

// Predator Evolution Step 41
