/**
 * Murphy Type Definitions
 *
 * Core type system for the High-Speed Coding Predator.
 */

// ============================================================================
// Agent Loop Types
// ============================================================================

export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolExecutionEvent {
    id: string;
    name: string;
    args: Record<string, any>;
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

// ============================================================================
// Provider Types
// ============================================================================

export type ModelType = 'reasoning' | 'execution';

export interface CompletionMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface CompletionParams {
    messages: CompletionMessage[];
    modelType: ModelType;
    tools?: ToolDefinition[];
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    onStream?: (chunk: string) => void;
    signal?: AbortSignal;
}

export interface CompletionResult {
    role: 'assistant';
    content: string;
    tool_calls?: ToolCall[];
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

export interface ToolResult {
    success: boolean;
    content?: string;
    error?: string;
    duration?: number;
    toolCallId?: string;
}

export interface ToolHandler {
    (args: any): Promise<string>;
}

// ============================================================================
// UI Types
// ============================================================================

export interface UIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    tools?: ToolExecutionEvent[];
    timestamp: number;
}

export interface SessionStats {
    messagesSent: number;
    tokensProcessed: number;
    totalToolExecutions: number;
    avgModelLatency: number;
}

export interface UIState {
    messages: UIMessage[];
    input: string;
    status: 'ready' | 'thinking' | 'executing';
    streamingContent: string;
    currentPhase: string;
    telemetry: LoopTelemetry | null;
    activeTools: ToolExecutionEvent[];
    elapsed: number;
    tick: number;
    sessionStats: SessionStats;
}

// ============================================================================
// Config Types
// ============================================================================

export interface Config {
    nvidiaApiKey: string;
    kimiApiKey: string;
    qwenApiKey: string;
    nvidiaBaseUrl: string;
    kimiModel: string;
    qwenModel: string;
    defaultCwd: string;
    maxConcurrentTools: number;
    toolTimeout: number;
    theme: string;
    showTelemetry: boolean;
    debugMode: boolean;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

// ============================================================================
// Constants
// ============================================================================

export interface ModelConfig {
    model: string;
    temperature: number;
    maxTokens: number;
    timeout: number;
}

export interface RetryConfig {
    maxRetries: number;
    baseDelay: number;
    backoffMultiplier: number;
}

export interface UIConfig {
    spinnerFrames: string[];
    updateInterval: number;
    maxHistoryMessages: number;
}
