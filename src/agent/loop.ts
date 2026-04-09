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
    // Pattern 1: Flexible XML-style tool_call tags
    /<tool_call>[\s\S]*?(?:<function=?([\w-]+)|function=([\w-]+))[\s\S]*?(?:arguments=?({[\s\S]*?})|arguments=({[\s\S]*?})|(?:<parameter=[\w-]+>([\s\S]*?)<\/parameter>)+)[\s\S]*?<\/tool_call>/gi,
    // Pattern 2: Markdown code blocks with tool syntax
    /```(?:tool|function)?\s*\n?([\w-]+)\s*\n([\s\S]*?)```/g,
    // Pattern 3: JSON-like tool invocations
    /\{\s*"?tool"?:\s*"([\w-]+)"\s*,\s*"?arguments"?:\s*(\{[\s\S]*?\})\s*\}/g,
];

/**
 * Utility to strip XML tags from content for clean UI display
 */
export const stripXml = (text: string): string => {
    return text
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
};

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
    // Effectively unlimited - only user can stop the task
    private readonly MAX_ITERATIONS = 1000;
    private readonly MAX_RETRIES = 3;
    private abortController: AbortController | null = null;
    public getIsProcessing(): boolean {
        return this.abortController !== null && !this.abortController.signal.aborted;
    }

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
            const regex = new RegExp(pattern.source, 'gi');
            let match;

            while ((match = regex.exec(text)) !== null) {
                // Determine function name from any of the capture groups
                const name = (match[1] || match[2] || match[match.length - 1])?.trim();
                
                // Handle different argument formats
                let argsBlob = match[3] || match[4] || match[5] || '{}';
                
                // Special case for <parameter=NAME>VALUE</parameter>
                if (text.includes('<parameter=')) {
                    const paramRegex = /<parameter=([\w-]+)>([\s\S]*?)<\/parameter>/gi;
                    const params: Record<string, any> = {};
                    let pMatch;
                    const toolBlock = match[0];
                    while ((pMatch = paramRegex.exec(toolBlock)) !== null) {
                        params[pMatch[1]] = pMatch[2].trim();
                    }
                    if (Object.keys(params).length > 0) {
                        argsBlob = JSON.stringify(params);
                    }
                }

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
                    // Skip
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
     * Check if we should continue the loop
     * v3.1 Upgrade: Smarter goal detection to prevent infinite loops
     */
    private shouldContinue(): boolean {
        const lastMessage = this.messages[this.messages.length - 1];

        // 1. If last message is from user (fresh input), ALWAYS continue
        if (lastMessage.role === 'user') return true;

        // 2. If last message is from a tool, ALWAYS continue (to process results)
        if (lastMessage.role === 'tool') return true;

        // 3. If assistant made tool calls, ALWAYS continue to execute them
        if (lastMessage.role === 'assistant' && lastMessage.tool_calls?.length) {
            return true;
        }

        // 4. Check for unfulfilled tool calls (count check)
        const totalToolCalls = this.messages
            .filter((m) => m.role === 'assistant' && m.tool_calls)
            .flatMap((m) => m.tool_calls || []).length;
        const totalToolResults = this.messages.filter((m) => m.role === 'tool').length;

        if (totalToolCalls > totalToolResults) return true;

        // 5. GOAL COMPLETION DETECTION (v3.1)
        if (lastMessage.role === 'assistant' && lastMessage.content) {
            const content = lastMessage.content;

            // Explicit termination signal
            if (content.includes('TASK_COMPLETE')) return false;

            // Heuristic detection: If we have content and NO tools in the last turn,
            // and we've already had at least one reasoning/execution cycle, we're likely done.
            // UNLESS it's a question (contains '?')
            const isQuestion = content.includes('?') && !content.includes('TASK_COMPLETE');
            if (!isQuestion && this.telemetry.iteration >= 1) {
                return false;
            }
        }

        // 6. Safety Break: If we have too many messages without progress, stop
        if (this.messages.length > 50) return false;

        return true;
    }

    /**
     * Main processing loop - The UNBREAKABLE Predator's Brain
     * NEVER exits until task is fully delivered to user
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
        onUpdate('phase_change', { phase: 'reasoning', message: '🧠 Strategic Planning Phase' });

        let lastError: Error | null = null;
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 3;

        try {
            while (this.telemetry.iteration < this.MAX_ITERATIONS) {
                if (signal.aborted) {
                    // Task completed
                    return {
                        response: '⏹️ Task stopped by user. Progress was saved.',
                        telemetry: { ...this.telemetry },
                        executionLog: [...this.executionLog],
                    };
                }

                this.telemetry.iteration++;
                this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);

                const phase: ModelType = this.telemetry.iteration === 1 ? 'reasoning' : 'execution';
                this.telemetry.phase = phase;

                onUpdate('telemetry', { telemetry: { ...this.telemetry } });
                onUpdate('model_start', { phase, iteration: this.telemetry.iteration });

                try {
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
                    consecutiveErrors = 0; // Reset error counter on success

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
                                message: '🔧 Text-to-Tool Fallback Activated',
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
                            message: `🔧 Executing ${toolCalls.length} Tool${toolCalls.length > 1 ? 's' : ''}`,
                        });

                        const { results, toolMessages } = await this.executeToolsParallel(toolCalls, onUpdate);

                        // Add tool results to message history
                        this.messages.push(...toolMessages);

                        // Check for failures and trigger recovery if needed
                        const failures = results.filter((r) => !r.success);
                        if (failures.length > 0) {
                            if (failures.length === results.length) {
                                // All tools failed - trigger recovery mode
                                onUpdate('phase_change', {
                                    phase: 'recovery',
                                    message: `🚨 Recovery Mode: ${failures.length} Tool Failure${failures.length > 1 ? 's' : ''}`,
                                });
                            }
                            // Add recovery instructions to messages
                            this.messages.push({
                                role: 'system',
                                content: `Some tools failed: ${failures.map(f => f.error).join(', ')}. Try alternative approaches.`,
                            });
                        }

                        // Continue loop to analyze results - NEVER stop mid-task
                        continue;
                    }

                    // No tool calls - check if we're done
                    if (!this.shouldContinue()) {
                        const finalResponse = response.content || '';
                        this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);
                        // Task completed

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
                    // Handle iteration-specific errors WITHOUT breaking the loop
                    consecutiveErrors++;
                    lastError = iterationError;

                    onUpdate('phase_change', {
                        phase: 'recovery',
                        message: `🔄 Recovering from error (attempt ${consecutiveErrors})...`,
                    });

                    // Add error context to help the model recover
                    this.messages.push({
                        role: 'system',
                        content: `An error occurred: ${iterationError.message}. Please continue with the task using an alternative approach.`,
                    });

                    // Only stop if we've had too many consecutive errors
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        const errorResponse = `⚠️ Task encountered persistent errors after ${MAX_CONSECUTIVE_ERRORS} attempts. Last error: ${lastError?.message}. Please try rephrasing your request.`;
                        // Task completed

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

                    // Brief pause before retry
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }

                // Continue for next iteration
            }

            // Max iterations reached - but still deliver what we have
            const lastMessage = this.messages[this.messages.length - 1];
            const response = lastMessage?.role === 'assistant'
                ? lastMessage.content || 'Task completed after extensive processing.'
                : 'Task processed through maximum iterations. Results are available in the execution log.';

            // Task completed
            onUpdate('completed', { response, telemetry: { ...this.telemetry }, executionLog: [...this.executionLog] });

            return {
                response,
                telemetry: { ...this.telemetry },
                executionLog: [...this.executionLog],
            };

        } catch (error: any) {
            // Absolute last resort - this should almost never happen
            this.telemetry.totalElapsed = Math.round(performance.now() - startTimeTotal);
            // Task completed

            const errorResponse = `💥 Critical Engine Issue: ${error.message}. However, any completed work has been preserved. Try asking to continue from where we left off.`;

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

// Predator Evolution Step 44

// Predator Evolution Step 62

// Predator Evolution Step 66

// Predator Evolution Step 69

// Predator Evolution Step 70
