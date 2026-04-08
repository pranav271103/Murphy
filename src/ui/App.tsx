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
import Spinner from 'ink-spinner';
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
 * TreeNode - Displays a single tool execution in the hierarchy
 */
const TreeNode = memo<{ event: ToolExecutionEvent; isLast: boolean }>(
    ({ event, isLast }) => {
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
        const argsPreview = JSON.stringify(event.args).slice(0, 35);

        return (
            <Box marginLeft={2}>
                <Text dimColor>{connector} </Text>
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
        );
    }
);

TreeNode.displayName = 'TreeNode';

/**
 * ToolExecutionTree - Living hierarchy of command execution
 */
const ToolExecutionTree = memo<{ events: ToolExecutionEvent[] }>(({ events }) => {
    if (events.length === 0) return null;

    return (
        <Box flexDirection="column" marginLeft={4} marginTop={1}>
            <Text dimColor italic>
                └─ Execution Trace
            </Text>
            {events.map((event, idx) => (
                <TreeNode key={event.id} event={event} isLast={idx === events.length - 1} />
            ))}
        </Box>
    );
});

ToolExecutionTree.displayName = 'ToolExecutionTree';

/**
 * ActiveToolPanel - Real-time parallel pipeline display
 */
const ActiveToolPanel = memo<{
    tools: ToolExecutionEvent[];
    spinnerFrame: string;
}>(({ tools, spinnerFrame }) => {
    if (tools.length === 0) return null;

    const runningCount = tools.filter((t) => t.status === 'running').length;
    const completedCount = tools.filter((t) => t.status === 'success').length;

    return (
        <Box
            flexDirection="column"
            marginLeft={4}
            marginTop={1}
            paddingX={1}
            borderStyle="bold"
            borderColor={runningCount > 0 ? 'yellow' : 'green'}
        >
            <Box>
                <Text bold color="cyan">
                    ╔ PARALLEL PIPELINE
                </Text>
                <Text dimColor>
                    {' '}
                    [Active:{runningCount} Done:{completedCount}/{tools.length}]
                </Text>
            </Box>
            {tools.map((tool) => (
                <Box key={tool.id} marginLeft={2}>
                    <Text color={tool.status === 'running' ? 'yellow' : 'green'}>
                        {tool.status === 'running' ? spinnerFrame : '✔'}
                    </Text>
                    <Text bold> {tool.name}</Text>
                    <Text dimColor> ({Math.round(performance.now() - tool.startTime)}ms)</Text>
                    {tool.status === 'running' && (
                        <Text color="yellow">
                            {' '}
                            <Spinner type="dots" />
                        </Text>
                    )}
                </Box>
            ))}
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
}>(({ telemetry, elapsed, spinnerFrame }) => {
    const statusColor = useMemo(() => {
        if (!telemetry) return 'green';
        if (telemetry.failedTools > 0) return 'yellow';
        return 'cyan';
    }, [telemetry]);

    return (
        <Box
            height={3}
            borderStyle="double"
            borderColor={statusColor as any}
            paddingX={2}
            flexDirection="row"
            alignItems="center"
        >
            {/* System Status */}
            <Box width="15%">
                <Text color={statusColor as any} bold>
                    {telemetry?.phase === 'reasoning'
                        ? `${spinnerFrame} THINK`
                        : telemetry?.phase === 'execution'
                            ? `${spinnerFrame} EXEC`
                            : telemetry?.phase === 'recovery'
                                ? '🔧 RECOVERY'
                                : '● ONLINE'}
                </Text>
            </Box>

            {/* Telemetry Data */}
            <Box width="70%" justifyContent="center">
                {telemetry ? (
                    <Text>
                        <Text color="cyan">ITER:</Text>
                        <Text bold> {telemetry.iteration}</Text>
                        <Text dimColor> | </Text>
                        <Text color="magenta">LATENCY:</Text>
                        <Text bold> {telemetry.modelLatency}ms</Text>
                        <Text dimColor> | </Text>
                        <Text color="yellow">ELAPSED:</Text>
                        <Text bold> {elapsed}ms</Text>
                        <Text dimColor> | </Text>
                        <Text color="green">TOOLS:</Text>
                        <Text bold>
                            {' '}
                            {telemetry.completedTools}/{telemetry.completedTools + telemetry.activeTools}
                        </Text>
                        {telemetry.failedTools > 0 && (
                            <>
                                <Text dimColor> | </Text>
                                <Text color="red">FAILURES: {telemetry.failedTools}</Text>
                            </>
                        )}
                    </Text>
                ) : (
                    <Text color="gray" dimColor>
                        MURPHY v3.0 PREDATOR // STANDBY
                    </Text>
                )}
            </Box>

            {/* Version */}
            <Box width="15%" justifyContent="flex-end">
                <Text dimColor>v3.0.PREDATOR</Text>
            </Box>
        </Box>
    );
});

TelemetryBar.displayName = 'TelemetryBar';

/**
 * MessageHistory - Static display of completed messages
 */
const MessageHistory = memo<{ messages: Message[] }>(({ messages }) => {
    return (
        <Static items={messages}>
            {(msg) => (
                <Box key={msg.timestamp} marginBottom={1} flexDirection="column">
                    <Box>
                        <Text bold color={msg.role === 'user' ? 'green' : 'cyan'}>
                            {msg.role === 'user' ? '❯ YOU' : '⚡ MURPHY'}:
                        </Text>
                        <Text> {msg.content}</Text>
                    </Box>
                    {msg.tools && <ToolExecutionTree events={msg.tools} />}
                </Box>
            )}
        </Static>
    );
});

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

    // Spinner animation - optimized to run only when needed
    useEffect(() => {
        if (status === 'ready') {
            setElapsed(0);
            return;
        }

        const interval = setInterval(() => {
            setTick((t) => (t + 1) % 10);
            setElapsed((e) => e + 100);
        }, 100);

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

    /**
     * Handle keyboard input
     */
    useInput(
        useCallback(
            (inputStr: string, key: any) => {
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
                } else if (key.backspace || key.delete) {
                    setInput((prev) => prev.slice(0, -1));
                } else if (key.ctrl && inputStr === 'c') {
                    exit();
                } else if (!key.ctrl && !key.meta && inputStr.length === 1) {
                    setInput((prev) => prev + inputStr);
                } else if (key.clear || key.escape) {
                    setInput('');
                }
            },
            [handleSend, exit]
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
            >
                {/* Message History */}
                <MessageHistory messages={messages} />

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

                {/* Streaming Content */}
                {streamingContent && (
                    <Box marginTop={1} flexDirection="column">
                        <Box>
                            <Text bold color="cyan">
                                ⚡ MURPHY:
                            </Text>
                        </Box>
                        <Box marginLeft={2}>
                            <Text>{streamingContent}</Text>
                            <Text color="yellow"> {spinnerFrame}</Text>
                        </Box>
                    </Box>
                )}

                {/* Active Tools Panel */}
                <ActiveToolPanel tools={activeTools} spinnerFrame={spinnerFrame} />

                {/* Current Phase Indicator */}
                {currentPhase && (
                    <Box marginTop={1} marginLeft={2}>
                        <Text color="yellow">
                            <Spinner type="line" /> {currentPhase}
                        </Text>
                    </Box>
                )}
            </Box>

            {/* TELEMETRY BAR */}
            <TelemetryBar telemetry={telemetry} elapsed={elapsed} spinnerFrame={spinnerFrame} />

            {/* INPUT AREA */}
            <Box marginTop={1} paddingX={2}>
                <Text color="cyan" bold>
                    {status === 'ready' ? 'PREDATOR ❯ ' : '⏳ '}
                </Text>
                <Text>{input}</Text>
                <Text color="gray" dimColor={input === ''}>
                    {input === '' ? ' Deploy instructions...' : ''}
                </Text>
                <Box flexGrow={1} />
                <Text dimColor>Ctrl+C Kill</Text>
            </Box>
        </Box>
    );
};

export default App;

// Predator Evolution Step 18
