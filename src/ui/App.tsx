import React, {
    useState,
    useCallback,
    useEffect,
    useRef,
    memo,
    useMemo,
} from 'react';
import { Box, Text, useInput, useApp, Static, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { AgentLoop, UpdateType, ToolExecutionEvent, LoopTelemetry } from '../agent/loop.js';
import { SYSTEM_PROMPT } from '../agent/constants.js';
import { performance } from 'perf_hooks';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    tools?: ToolExecutionEvent[];
    timestamp: number;
    expanded?: boolean;
}

interface SessionStats {
    messagesSent: number;
    tokensProcessed: number;
    totalToolExecutions: number;
    avgModelLatency: number;
}

// ============================================================================
// PREDATOR COMPONENTS - Optimized with React.memo
// ============================================================================

/**
 * CommandDetailTree - Collapsible tree showing full command details
 * Similar to Claude Code's command detail view
 */
interface CommandDetailTreeProps {
    event: ToolExecutionEvent;
    isExpanded: boolean;
    onToggle: () => void;
}

const CommandDetailTree = memo<CommandDetailTreeProps>(({ event, isExpanded }) => {
    if (!isExpanded) return null;

    const formatArgs = (args: any) => {
        try {
            return JSON.stringify(args, null, 2);
        } catch {
            return String(args);
        }
    };

    const formatResult = (result?: string) => {
        if (!result) return 'No output';
        // Truncate very long results
        if (result.length > 500) {
            return result.slice(0, 500) + '\n... (truncated)';
        }
        return result;
    };

    return (
        <Box flexDirection="column" marginLeft={6} marginTop={1}>
            <Box borderStyle="single" borderColor="gray" paddingX={1}>
                <Box flexDirection="column">
                    <Text color="gray" dimColor>Command: {event.name}</Text>
                    <Text color="gray" dimColor>Status: {event.status}</Text>
                    <Text color="gray" dimColor>Duration: {event.duration}ms</Text>
                    {event.retryCount && event.retryCount > 0 && (
                        <Text color="yellow">Retries: {event.retryCount}</Text>
                    )}
                </Box>

                <Box marginTop={1} flexDirection="column">
                    <Text color="cyan" dimColor>Arguments:</Text>
                    <Text color="white">{formatArgs(event.args)}</Text>
                </Box>

                {event.result && (
                    <Box marginTop={1} flexDirection="column">
                        <Text color="green" dimColor>Result:</Text>
                        <Text color="white">{formatResult(event.result)}</Text>
                    </Box>
                )}

                {event.error && (
                    <Box marginTop={1} flexDirection="column">
                        <Text color="red" dimColor>Error:</Text>
                        <Text color="red">{event.error}</Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
});
CommandDetailTree.displayName = 'CommandDetailTree';

/**
 * TreeNode - Displays a single tool execution in the hierarchy
 * Clickable to expand/collapse details
 */
const TreeNode = memo<{
    event: ToolExecutionEvent;
    isLast: boolean;
    isExpanded: boolean;
    onToggle: () => void;
}>(({ event, isLast, isExpanded, onToggle }) => {
    const statusIcon = useMemo(() => {
        switch (event.status) {
            case 'success':
                return '✅';
            case 'failure':
                return '❌';
            case 'recovered':
                return '🔧';
            case 'running':
                return '⏳';
            default:
                return '⏸️';
        }
    }, [event.status]);

    const statusColor = useMemo(() => {
        switch (event.status) {
            case 'success':
                return 'green';
            case 'failure':
                return 'red';
            case 'recovered':
                return 'yellow';
            case 'running':
                return 'cyan';
            default:
                return 'gray';
        }
    }, [event.status]);

    const connector = isLast ? '└──' : '├──';
    const expandIcon = isExpanded ? '▼' : '▶';
    const argsPreview = JSON.stringify(event.args).slice(0, 40);

    return (
        <Box flexDirection="column">
            <Box marginLeft={2}>
                <Text dimColor>{connector} </Text>
                <Text color="gray">{expandIcon} </Text>
                <Text color={statusColor as any}>{statusIcon}</Text>
                <Text bold> {event.name}</Text>
                <Text dimColor> ({event.duration}ms)</Text>
                <Text color="gray" dimColor>
                    {' '}
                    {argsPreview}...
                </Text>
                {event.retryCount && event.retryCount > 0 ? (
                    <Text color="yellow"> [retry:{event.retryCount}]</Text>
                ) : null}
            </Box>
            <CommandDetailTree event={event} isExpanded={isExpanded} onToggle={onToggle} />
        </Box>
    );
});

TreeNode.displayName = 'TreeNode';

/**
 * ToolExecutionTree - Living hierarchy of command execution with collapsible details
 */
const ToolExecutionTree = memo<{ events: ToolExecutionEvent[] }>(({ events }) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const toggleExpand = useCallback((id: string) => {
        setExpandedIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    }, []);

    if (events.length === 0) return null;

    const completedCount = events.filter(e => e.status === 'success' || e.status === 'failure').length;
    const allComplete = completedCount === events.length;

    return (
        <Box flexDirection="column" marginLeft={4} marginTop={1}>
            <Box>
                <Text dimColor italic>
                    {allComplete ? '└─' : '├─'} Execution Trace
                </Text>
                <Text dimColor> ({completedCount}/{events.length} complete)</Text>
            </Box>
            {events.map((event, idx) => (
                <TreeNode
                    key={event.id}
                    event={event}
                    isLast={idx === events.length - 1}
                    isExpanded={expandedIds.has(event.id)}
                    onToggle={() => toggleExpand(event.id)}
                />
            ))}
        </Box>
    );
});

ToolExecutionTree.displayName = 'ToolExecutionTree';

/**
 * ActiveToolPanel - Real-time parallel pipeline display with enhanced status
 */
const ActiveToolPanel = memo<{
    tools: ToolExecutionEvent[];
    spinnerFrame: string;
    phase?: string;
}>(({ tools, spinnerFrame, phase }) => {
    if (tools.length === 0 && !phase) return null;

    const runningCount = tools.filter((t) => t.status === 'running').length;
    const completedCount = tools.filter((t) => t.status === 'success').length;
    const failedCount = tools.filter((t) => t.status === 'failure').length;
    // pendingCount can be displayed if needed in future

    const borderColor = runningCount > 0 ? 'yellow' : failedCount > 0 ? 'red' : 'green';

    return (
        <Box
            flexDirection="column"
            marginLeft={4}
            marginTop={1}
            paddingX={1}
            paddingY={1}
            borderStyle="bold"
            borderColor={borderColor as any}
        >
            {/* Header with status */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    ⚡ ACTIVE EXECUTION
                </Text>
                {tools.length > 0 && (
                    <Text dimColor>
                        {' '}
                        [{runningCount}⏵ {completedCount}✓ {failedCount}✗ /{tools.length}]
                    </Text>
                )}
                {phase && (
                    <Text color="yellow"> | {phase}</Text>
                )}
            </Box>

            {/* Progress bar */}
            {tools.length > 0 && (
                <Box marginBottom={1}>
                    <Text>
                        <Text color="green">{'█'.repeat(completedCount)}</Text>
                        <Text color="yellow">{runningCount > 0 ? '▓'.repeat(runningCount) : ''}</Text>
                        <Text color="red">{failedCount > 0 ? '▒'.repeat(failedCount) : ''}</Text>
                        <Text color="gray" dimColor>{'░'.repeat(Math.max(0, tools.length - completedCount - runningCount - failedCount))}</Text>
                    </Text>
                    <Text dimColor> {Math.round((completedCount / tools.length) * 100)}%</Text>
                </Box>
            )}

            {/* Tool list with status */}
            <Box flexDirection="column">
                {tools.map((tool) => {
                    const statusIcon = tool.status === 'running'
                        ? spinnerFrame
                        : tool.status === 'success'
                            ? '✓'
                            : tool.status === 'failure'
                                ? '✗'
                                : tool.status === 'pending'
                                    ? '○'
                                    : '●';
                    const statusColor = tool.status === 'running'
                        ? 'yellow'
                        : tool.status === 'success'
                            ? 'green'
                            : tool.status === 'failure'
                                ? 'red'
                                : 'gray';
                    const statusText = tool.status === 'running'
                        ? 'executing...'
                        : tool.status === 'success'
                            ? 'completed'
                            : tool.status === 'failure'
                                ? 'failed'
                                : 'queued';

                    return (
                        <Box key={tool.id} marginLeft={2}>
                            <Text color={statusColor as any}>{statusIcon}</Text>
                            <Text bold> {tool.name}</Text>
                            <Text dimColor> ({Math.round(performance.now() - tool.startTime)}ms)</Text>
                            <Text color={statusColor as any}> ⏵ {statusText}</Text>
                        </Box>
                    );
                })}
            </Box>

            {/* Status footer */}
            <Box marginTop={1}>
                <Text color="gray" dimColor>
                    {runningCount > 0
                        ? `⏳ ${runningCount} tool${runningCount > 1 ? 's' : ''} currently running...`
                        : completedCount === tools.length && tools.length > 0
                            ? '✓ All tools completed'
                            : '⏸️ Waiting for execution...'}
                </Text>
            </Box>
        </Box>
    );
});

ActiveToolPanel.displayName = 'ActiveToolPanel';

/**
 * TelemetryBar - Real-time performance metrics
 */
const TelemetryBar = memo<{
    telemetry: LoopTelemetry | null;
    elapsed: number;
    spinnerFrame: string;
    isProcessing: boolean;
}>(({ telemetry, elapsed, spinnerFrame, isProcessing }) => {
    // Compute once per render to prevent constant recalculation
    const statusConfig = useMemo(() => {
        if (!telemetry) {
            return { color: 'green', text: '● ONLINE', label: 'STANDBY' };
        }
        if (telemetry.failedTools > 0) {
            return { color: 'yellow', text: '⚠ ACTIVE', label: 'RUNNING' };
        }
        return { color: 'cyan', text: `${spinnerFrame} ACTIVE`, label: 'RUNNING' };
    }, [telemetry, spinnerFrame]);

    // Phase display
    const phaseDisplay = useMemo(() => {
        if (!telemetry) return 'STANDBY';
        if (telemetry.phase === 'reasoning') return '🧠 THINKING';
        if (telemetry.phase === 'execution') return '🔧 EXECUTING';
        if (telemetry.phase === 'recovery') return '🚨 RECOVERING';
        return '● ACTIVE';
    }, [telemetry]);

    return (
        <Box
            height={3}
            borderStyle="double"
            borderColor={statusConfig.color as any}
            paddingX={2}
            flexDirection="row"
            alignItems="center"
        >
            {/* System Status */}
            <Box width="15%">
                <Text color={statusConfig.color as any} bold>
                    {phaseDisplay}
                </Text>
            </Box>

            {/* Telemetry Data - optimized display */}
            <Box width="70%" justifyContent="center">
                {telemetry ? (
                    <Text wrap="truncate">
                        <Text color="cyan">IT:</Text>
                        <Text bold>{telemetry.iteration}</Text>
                        <Text dimColor>|</Text>
                        <Text color="magenta">LAT:</Text>
                        <Text bold>{telemetry.modelLatency}ms</Text>
                        <Text dimColor>|</Text>
                        <Text color="yellow">EL:</Text>
                        <Text bold>{elapsed}ms</Text>
                        <Text dimColor>|</Text>
                        <Text color="green">OK:</Text>
                        <Text bold>{telemetry.completedTools}</Text>
                        {telemetry.activeTools > 0 && (
                            <>
                                <Text color="yellow">/~{telemetry.activeTools}</Text>
                            </>
                        )}
                        {telemetry.failedTools > 0 && (
                            <>
                                <Text color="red"> ✗{telemetry.failedTools}</Text>
                            </>
                        )}
                    </Text>
                ) : (
                    <Text color="gray" dimColor>
                        MURPHY v3.0 PREDATOR // READY
                    </Text>
                )}
            </Box>

            {/* Version */}
            <Box width="15%" justifyContent="flex-end">
                <Text dimColor>{isProcessing ? '⏵ RUNNING' : '● READY'}</Text>
            </Box>
        </Box>
    );
});

TelemetryBar.displayName = 'TelemetryBar';

/**
 * MessageItem - Single message with stable rendering
 */
const MessageItem = memo<{ msg: Message }>(({ msg }) => {
    const roleColor = msg.role === 'user' ? 'green' : 'cyan';
    const roleLabel = msg.role === 'user' ? '❯ YOU' : '⚡ MURPHY';

    return (
        <Box marginBottom={1} flexDirection="column">
            <Box>
                <Text bold color={roleColor}>{roleLabel}:</Text>
                <Text> {msg.content}</Text>
            </Box>
            {msg.tools && msg.tools.length > 0 && <ToolExecutionTree events={msg.tools} />}
        </Box>
    );
});
MessageItem.displayName = 'MessageItem';

/**
 * MessageHistory - Static display of completed messages
 * Using stable key to prevent re-renders
 */
/**
 * MessageHistory - Static display of completed messages
 * v3.1 Upgrade: Viewport management to only show recent history
 */
const MessageHistory = memo<{ messages: Message[]; maxVisible?: number }>(
    ({ messages, maxVisible = 10 }) => {
        // Viewport Logic: Only show the last N messages to prevent terminal overflow
        const visibleMessages = useMemo(() => {
            if (messages.length <= maxVisible) return messages;
            return messages.slice(-maxVisible);
        }, [messages, maxVisible]);

        const items = useMemo(() => {
            return visibleMessages.map((msg, idx) => ({
                ...msg,
                id: `${msg.timestamp}_${idx}`,
            }));
        }, [visibleMessages]);

        return (
            <Box flexDirection="column">
                {messages.length > maxVisible && (
                    <Box marginBottom={1} justifyContent="center">
                        <Text dimColor italic>
                            ... {messages.length - maxVisible} messages hidden in scrollback ...
                        </Text>
                    </Box>
                )}
                <Static items={items}>
                    {(msg) => <MessageItem key={msg.id} msg={msg} />}
                </Static>
            </Box>
        );
    }
);

MessageHistory.displayName = 'MessageHistory';

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const App: React.FC = () => {
    // State management with refs for high-frequency updates
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'ready' | 'thinking' | 'executing'>('ready');
    const [streamingContent, setStreamingContent] = useState('');
    const [currentPhase, setCurrentPhase] = useState<string>('');
    const [telemetry, setTelemetry] = useState<LoopTelemetry | null>(null);
    const [activeTools, setActiveTools] = useState<ToolExecutionEvent[]>([]);
    const [elapsed, setElapsed] = useState(0);
    const [tick, setTick] = useState(0);
    const [sessionStats, setSessionStats] = useState<SessionStats>({
        messagesSent: 0,
        tokensProcessed: 0,
        totalToolExecutions: 0,
        avgModelLatency: 0,
    });

    const { exit } = useApp();
    const { stdout } = useStdout();

    // Refs for performance
    const agentRef = useRef<AgentLoop | null>(null);
    const inputRef = useRef(input);
    const statusRef = useRef(status);
    const activeToolsRef = useRef(activeTools);
    const streamingStartTime = useRef<number>(0);

    // Sync refs
    inputRef.current = input;
    statusRef.current = status;
    activeToolsRef.current = activeTools;

    // Initialize agent
    useEffect(() => {
        agentRef.current = new AgentLoop(SYSTEM_PROMPT);
    }, []);

    // Spinner animation - optimized with RAF for smoother rendering
    useEffect(() => {
        if (status === 'ready') {
            setElapsed(0);
            setTick(0);
            return;
        }

        // Use longer interval to reduce re-render frequency
        const interval = setInterval(() => {
            setTick((t) => (t + 1) % 10);
            setElapsed((e) => e + 100);
        }, 150); // Slightly slower updates = less flicker

        return () => clearInterval(interval);
    }, [status]);

    const spinnerFrame = useMemo(() => {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        return frames[tick % frames.length];
    }, [tick]);

    /**
     * Handle agent updates with surgical precision
     */
    const handleAgentUpdate = useCallback((type: UpdateType, data: any) => {
        switch (type) {
            case 'phase_change':
                setCurrentPhase(data.message || data.phase);
                if (data.phase === 'execution') {
                    setStatus('executing');
                }
                break;

            case 'model_start':
                setStatus('thinking');
                setCurrentPhase(
                    data.phase === 'reasoning' ? '🧠 Strategic Planning' : '🔧 Code Execution'
                );
                streamingStartTime.current = performance.now();
                break;

            case 'model_stream':
                setStreamingContent((prev) => prev + data.chunk);
                break;

            case 'model_complete':
                // Streaming done, content is ready
                break;

            case 'tool_queued':
            case 'tool_start':
                setActiveTools((prev) => {
                    const exists = prev.find((t) => t.id === data.event.id);
                    if (exists) {
                        return prev.map((t) =>
                            t.id === data.event.id ? { ...t, ...data.event } : t
                        );
                    }
                    return [...prev, data.event];
                });
                break;

            case 'tool_complete':
            case 'tool_failed':
            case 'tool_recovered':
                setActiveTools((prev) =>
                    prev.map((t) => (t.id === data.event.id ? { ...t, ...data.event } : t))
                );
                break;

            case 'telemetry':
                setTelemetry(data.telemetry);
                break;

            case 'completed':
                if (data.response) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            role: 'assistant',
                            content: data.response,
                            tools: data.executionLog || [],
                            timestamp: Date.now(),
                        },
                    ]);
                }
                setStreamingContent('');
                setActiveTools([]);
                setStatus('ready');
                setTelemetry(null);
                setCurrentPhase('');

                // Update session stats
                setSessionStats((prev) => ({
                    ...prev,
                    totalToolExecutions:
                        prev.totalToolExecutions + (data.executionLog?.length || 0),
                }));
                break;

            case 'error':
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: `⚠️ ${data.error}`,
                        timestamp: Date.now(),
                    },
                ]);
                setStatus('ready');
                setStreamingContent('');
                setActiveTools([]);
                break;
        }
    }, []);

    /**
     * Send message to the predator
     */
    const handleSend = useCallback(async () => {
        const userInput = inputRef.current.trim();
        if (!userInput || !agentRef.current) return;

        setInput('');
        setMessages((prev) => [
            ...prev,
            { role: 'user', content: userInput, timestamp: Date.now() },
        ]);
        setStatus('thinking');
        setStreamingContent('');
        setActiveTools([]);

        // Update stats
        setSessionStats((prev) => ({ ...prev, messagesSent: prev.messagesSent + 1 }));

        await agentRef.current.process(userInput, handleAgentUpdate);
    }, [handleAgentUpdate]);

    // Paste buffer for bracketed paste mode support
    const [isPasteMode, setIsPasteMode] = useState(false);
    const pasteBufferRef = useRef('');

    /**
     * Process pasted content - handles multi-line text, code blocks, special chars
     */
    const processPaste = useCallback((content: string) => {
        // Handle multi-line paste - newlines become spaces in single-line input
        // but preserve for processing
        const normalized = content.replace(/\r\n/g, '\n').replace(/\n/g, ' ');
        setInput((prev) => prev + normalized);
    }, []);

    /**
     * Handle keyboard input with full paste support
     * Supports bracketed paste mode (OSC 200/201) and direct multi-character input
     */
    useInput(
        useCallback(
            (inputStr: string, key: any) => {
                // Detect bracketed paste start (ESC[200~)
                if (inputStr === '\x1b[200~') {
                    setIsPasteMode(true);
                    pasteBufferRef.current = '';
                    return;
                }

                // Detect bracketed paste end (ESC[201~)
                if (inputStr === '\x1b[201~') {
                    setIsPasteMode(false);
                    processPaste(pasteBufferRef.current);
                    pasteBufferRef.current = '';
                    return;
                }

                // If in paste mode, accumulate characters
                if (isPasteMode) {
                    pasteBufferRef.current += inputStr;
                    return;
                }

                // Handle multi-character input (non-bracketed paste)
                if (inputStr.length > 1 && !key.ctrl && !key.meta) {
                    // This is likely a paste event - process entire string
                    processPaste(inputStr);
                    return;
                }

                // Handle Enter key - submit message
                if (key.return) {
                    if (
                        inputRef.current.trim().toLowerCase() === 'exit' ||
                        inputRef.current.trim().toLowerCase() === 'quit'
                    ) {
                        exit();
                        return;
                    }
                    if (inputRef.current.trim()) {
                        handleSend();
                    }
                    return;
                }

                // Handle backspace/delete
                if (key.backspace || key.delete) {
                    setInput((prev) => {
                        // Handle UTF-8 characters properly
                        if (prev.length === 0) return prev;
                        // Check for surrogate pairs (emoji, etc.)
                        const lastCode = prev.charCodeAt(prev.length - 1);
                        if (lastCode >= 0xDC00 && lastCode <= 0xDFFF && prev.length > 1) {
                            // High surrogate, remove both
                            return prev.slice(0, -2);
                        }
                        return prev.slice(0, -1);
                    });
                    return;
                }

                // Handle Ctrl+C - exit
                if (key.ctrl && inputStr === 'c') {
                    exit();
                    return;
                }

                // Handle Ctrl+L - clear screen
                if (key.ctrl && inputStr === 'l') {
                    setMessages([]);
                    return;
                }

                // Handle Ctrl+U - clear current input line
                if (key.ctrl && inputStr === 'u') {
                    setInput('');
                    return;
                }

                // Handle Ctrl+W - delete word
                if (key.ctrl && inputStr === 'w') {
                    setInput((prev) => {
                        const trimmed = prev.trimEnd();
                        const lastSpace = trimmed.lastIndexOf(' ');
                        if (lastSpace === -1) return '';
                        return trimmed.slice(0, lastSpace + 1);
                    });
                    return;
                }

                // Handle Ctrl+A - go to start of line
                if (key.ctrl && inputStr === 'a') {
                    // Visual feedback only - cursor moves conceptually
                    return;
                }

                // Handle Ctrl+E - go to end of line
                if (key.ctrl && inputStr === 'e') {
                    return;
                }

                // Handle Escape - clear input
                if (key.escape) {
                    setInput('');
                    return;
                }

                // Regular character input
                if (!key.ctrl && !key.meta && inputStr.length >= 1) {
                    setInput((prev) => prev + inputStr);
                }
            },
            [handleSend, exit, isPasteMode, processPaste]
        )
    );

    // Calculate terminal width for responsive layout
    const terminalWidth = stdout?.columns || 100;
    const showCompact = terminalWidth < 120;

    return (
        <Box flexDirection="column" height="100%">
            {/* HEADER - Predator Branding */}
            <Box flexDirection="column" alignItems="center" marginBottom={1}>
                <Gradient name="retro">
                    <BigText text="MURPHY" font={showCompact ? 'simple' : 'block'} />
                </Gradient>
                <Box marginTop={-1}>
                    <Text italic color="cyan" dimColor>
                        ═══ THE HIGH-SPEED CODING PREDATOR ═══
                    </Text>
                </Box>
                <Box>
                    <Text dimColor>Session: </Text>
                    <Text color="green">{sessionStats.messagesSent} msgs</Text>
                    <Text dimColor> | </Text>
                    <Text color="yellow">{sessionStats.totalToolExecutions} tools</Text>
                </Box>
            </Box>

            {/* MAIN CHAT AREA */}
            <Box
                flexDirection="column"
                flexGrow={1}
                marginBottom={1}
                borderStyle="singleDouble"
                borderColor="cyan"
                paddingX={2}
                paddingY={1}
                // v3.1: Limit height to prevent terminal overflow and allow "scrolling" feel
                minHeight={10}
            >
                {/* Message History with Viewport */}
                <MessageHistory messages={messages} maxVisible={showCompact ? 3 : 6} />

                {/* Welcome Message */}
                {messages.length === 0 && (
                    <Box padding={2} justifyContent="center" flexDirection="column" alignItems="center">
                        <Text color="gray">Predator Online. Feed me commands.</Text>
                        <Text dimColor>
                            Try: "Summarize Murphy project and save to desktop as summary.txt"
                        </Text>
                        <Text dimColor color="cyan">
                            Commands: exit | clear | Ctrl+C to kill
                        </Text>
                    </Box>
                )}

                {/* Streaming Content - v3.1: Only show last 3 lines to minimize flicker */}
                {streamingContent && (
                    <Box marginTop={1} flexDirection="column">
                        <Box>
                            <Text bold color="cyan">
                                ⚡ MURPHY (Reasoning):
                            </Text>
                        </Box>
                        <Box marginLeft={2}>
                            <Text>
                                {streamingContent.length > 500
                                    ? '...' + streamingContent.slice(-500)
                                    : streamingContent}
                            </Text>
                            <Text color="yellow"> {spinnerFrame}</Text>
                        </Box>
                    </Box>
                )}

                {/* Active Tools Panel with status */}
                <ActiveToolPanel
                    tools={activeTools}
                    spinnerFrame={spinnerFrame}
                    phase={currentPhase}
                />

                {/* Thinking indicator when no tools but processing */}
                {currentPhase && activeTools.length === 0 && !streamingContent && (
                    <Box marginTop={1} marginLeft={2}>
                        <Text color="yellow">
                            {spinnerFrame} {currentPhase}...
                        </Text>
                    </Box>
                )}
            </Box>

            {/* TELEMETRY BAR */}
            <TelemetryBar
                telemetry={telemetry}
                elapsed={elapsed}
                spinnerFrame={spinnerFrame}
                isProcessing={status !== 'ready'}
            />

            {/* INPUT AREA - optimized to prevent flicker */}
            <Box marginTop={1} paddingX={2} flexDirection="row">
                <Box width={12}>
                    <Text color="cyan" bold>
                        {status === 'ready' ? 'PREDATOR ❯' : '⏳ RUNNING'}
                    </Text>
                </Box>
                <Box flexGrow={1}>
                    {input.length > 0 ? (
                        <Text wrap="wrap">{input}</Text>
                    ) : status === 'ready' ? (
                        <Text color="gray" dimColor>Deploy instructions...</Text>
                    ) : (
                        <Text color="yellow">Processing...{spinnerFrame}</Text>
                    )}
                </Box>
                <Box width={15} justifyContent="flex-end">
                    <Text dimColor>{status === 'ready' ? 'Ctrl+C Exit' : '⏵ Working'}</Text>
                </Box>
            </Box>
        </Box>
    );
};

export default App;

// Predator Evolution Step 18

// Predator Evolution Step 24

// Predator Evolution Step 35

// Predator Evolution Step 45

// Predator Evolution Step 47

// Predator Evolution Step 58

// Predator Evolution Step 63

// Predator Evolution Step 65

// Predator Evolution Step 72
