import React, {
    useState,
    useCallback,
    useEffect,
    useRef,
    memo,
    useMemo,
} from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
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

// ============================================================================
// PREDATOR LEAF COMPONENTS - High-frequency updates isolated here
// ============================================================================

/**
 * PredatorSpinner - Manages its own animation interval to prevent global re-renders
 */
const PredatorSpinner = memo<{ active: boolean }>(({ active }) => {
    const [tick, setTick] = useState(0);
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

    useEffect(() => {
        if (!active) {
            setTick(0);
            return;
        }
        const interval = setInterval(() => {
            setTick((t) => (t + 1) % frames.length);
        }, 80); // Fast, smooth spinner
        return () => clearInterval(interval);
    }, [active]);

    if (!active) return null;
    return <Text color="yellow">{frames[tick]}</Text>;
});

/**
 * PredatorTimer - Manages its own clock to prevent global re-renders
 */
const PredatorTimer = memo<{ active: boolean }>(({ active }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!active) {
            setElapsed(0);
            return;
        }
        const startTime = Date.now();
        const interval = setInterval(() => {
            setElapsed(Date.now() - startTime);
        }, 100);
        return () => clearInterval(interval);
    }, [active]);

    return <Text bold>{elapsed}ms</Text>;
});

/**
 * PredatorHeader - High-complexity branding, memoized to prevent re-renders
 */
const PredatorHeader = memo<{ sessionStats: SessionStats; showCompact: boolean }>(
    ({ sessionStats, showCompact }) => (
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
    )
);

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
            case 'success': return '✅';
            case 'failure': return '❌';
            case 'recovered': return '🔧';
            case 'running': return null; // Handled by PredatorSpinner
            default: return '⏸️';
        }
    }, [event.status]);

    const statusColor = useMemo(() => {
        switch (event.status) {
            case 'success': return 'green';
            case 'failure': return 'red';
            case 'recovered': return 'yellow';
            case 'running': return 'cyan';
            default: return 'gray';
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
                {event.status === 'running' ? (
                    <PredatorSpinner active={true} />
                ) : (
                    <Text color={statusColor as any}>{statusIcon}</Text>
                )}
                <Text bold> {event.name}</Text>
                <Text dimColor> ({event.duration}ms)</Text>
                <Text color="gray" dimColor>
                    {' '}
                    {argsPreview}...
                </Text>
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
    phase?: string;
}>(({ tools, phase }) => {
    if (tools.length === 0 && !phase) return null;

    const runningCount = tools.filter((t) => t.status === 'running').length;
    const completedCount = tools.filter((t) => t.status === 'success').length;
    const failedCount = tools.filter((t) => t.status === 'failure').length;

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
            <Box marginBottom={1}>
                <Text bold color="cyan">⚡ ACTIVE EXECUTION</Text>
                {tools.length > 0 && (
                    <Text dimColor> [{runningCount}⏵ {completedCount}✓ {failedCount}✗ /{tools.length}]</Text>
                )}
                {phase && <Text color="yellow"> | {phase}</Text>}
            </Box>

            <Box flexDirection="column">
                {tools.map((tool) => (
                    <Box key={tool.id} marginLeft={2}>
                        {tool.status === 'running' ? (
                            <PredatorSpinner active={true} />
                        ) : (
                            <Text color={tool.status === 'success' ? 'green' : 'red'}>
                                {tool.status === 'success' ? '✓' : '✗'}
                            </Text>
                        )}
                        <Text bold> {tool.name}</Text>
                        <Text dimColor> ({Math.round(performance.now() - tool.startTime)}ms)</Text>
                    </Box>
                ))}
            </Box>
        </Box>
    );
});

ActiveToolPanel.displayName = 'ActiveToolPanel';

// ============================================================================
// MODIFIED PREDATOR COMPONENTS
// ============================================================================

const TelemetryBar = memo<{
    telemetry: LoopTelemetry | null;
    isProcessing: boolean;
}>(({ telemetry, isProcessing }) => {
    const phaseDisplay = useMemo(() => {
        if (!telemetry) return 'STANDBY';
        if (telemetry.phase === 'reasoning') return '🧠 THINKING';
        if (telemetry.phase === 'execution') return '🔧 EXECUTING';
        if (telemetry.phase === 'recovery') return '🚨 RECOVERING';
        return '● ACTIVE';
    }, [telemetry]);

    const statusColor = telemetry?.failedTools ? 'yellow' : telemetry ? 'cyan' : 'green';

    return (
        <Box
            height={3}
            borderStyle="double"
            borderColor={statusColor as any}
            paddingX={2}
            flexDirection="row"
            alignItems="center"
        >
            <Box width="15%">
                <Text color={statusColor as any} bold>
                    {phaseDisplay}
                </Text>
            </Box>

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
                        <PredatorTimer active={isProcessing} />
                        <Text dimColor>|</Text>
                        <Text color="green">OK:</Text>
                        <Text bold>{telemetry.completedTools}</Text>
                        {telemetry.activeTools > 0 && <Text color="yellow">/~{telemetry.activeTools}</Text>}
                        {telemetry.failedTools > 0 && <Text color="red"> ✗{telemetry.failedTools}</Text>}
                    </Text>
                ) : (
                    <Text color="gray" dimColor>MURPHY v3.1 PREDATOR // READY</Text>
                )}
            </Box>

            <Box width="15%" justifyContent="flex-end">
                <Text dimColor>{isProcessing ? '⏵ RUNNING' : '● READY'}</Text>
            </Box>
        </Box>
    );
});

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
 * MessageHistory - Standard Box-based rendering (REMOVED Static)
 * Fixed 'empty box' and 'layout inversion' issues
 */
const MessageHistory = memo<{ messages: Message[]; maxVisible?: number }>(
    ({ messages, maxVisible = 6 }) => {
        const visibleMessages = useMemo(() => messages.slice(-maxVisible), [messages, maxVisible]);

        return (
            <Box flexDirection="column">
                {messages.length > maxVisible && (
                    <Box marginBottom={1} justifyContent="center">
                        <Text dimColor italic>... scrollback restricted to last {maxVisible} interactions ...</Text>
                    </Box>
                )}
                {visibleMessages.map((msg, idx) => (
                    <MessageItem key={`${msg.timestamp}_${idx}`} msg={msg} />
                ))}
            </Box>
        );
    }
);

MessageHistory.displayName = 'MessageHistory';

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const App: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'ready' | 'thinking' | 'executing'>('ready');
    const [streamingContent, setStreamingContent] = useState('');
    const [currentPhase, setCurrentPhase] = useState<string>('');
    const [telemetry, setTelemetry] = useState<LoopTelemetry | null>(null);
    const [activeTools, setActiveTools] = useState<ToolExecutionEvent[]>([]);
    const [sessionStats, setSessionStats] = useState<SessionStats>({
        messagesSent: 0, tokensProcessed: 0, totalToolExecutions: 0, avgModelLatency: 0,
    });

    const { exit } = useApp();
    const { stdout } = useStdout();
    const agentRef = useRef<AgentLoop | null>(null);
    const inputRef = useRef(input);
    inputRef.current = input;

    useEffect(() => {
        agentRef.current = new AgentLoop(SYSTEM_PROMPT);
    }, []);

    const handleAgentUpdate = useCallback((type: UpdateType, data: any) => {
        switch (type) {
            case 'phase_change':
                setCurrentPhase(data.message || data.phase);
                if (data.phase === 'execution') setStatus('executing');
                break;
            case 'model_start':
                setStatus('thinking');
                setCurrentPhase(data.phase === 'reasoning' ? '🧠 THINKING' : '🔧 CODING');
                break;
            case 'model_stream':
                setStreamingContent((prev) => prev + data.chunk);
                break;
            case 'tool_queued':
            case 'tool_start':
                setActiveTools((prev) => {
                    const exists = prev.find((t) => t.id === data.event.id);
                    if (exists) return prev.map((t) => t.id === data.event.id ? { ...t, ...data.event } : t);
                    return [...prev, data.event];
                });
                break;
            case 'tool_complete':
            case 'tool_failed':
            case 'tool_recovered':
                setActiveTools((prev) => prev.map((t) => (t.id === data.event.id ? { ...t, ...data.event } : t)));
                break;
            case 'telemetry':
                setTelemetry(data.telemetry);
                break;
            case 'completed':
                if (data.response) {
                    setMessages((prev) => [...prev, {
                        role: 'assistant',
                        content: data.response,
                        tools: data.executionLog || [],
                        timestamp: Date.now(),
                    }]);
                }
                setStreamingContent('');
                setActiveTools([]);
                setStatus('ready');
                setTelemetry(null);
                setCurrentPhase('');
                setSessionStats((prev) => ({ ...prev, totalToolExecutions: prev.totalToolExecutions + (data.executionLog?.length || 0) }));
                break;
            case 'error':
                setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${data.error}`, timestamp: Date.now() }]);
                setStatus('ready');
                setStreamingContent('');
                setActiveTools([]);
                break;
        }
    }, []);

    const handleSend = useCallback(async () => {
        const userInput = inputRef.current.trim();
        if (!userInput || !agentRef.current) return;
        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: userInput, timestamp: Date.now() }]);
        setStatus('thinking');
        setStreamingContent('');
        setActiveTools([]);
        setSessionStats((prev) => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
        await agentRef.current.process(userInput, handleAgentUpdate);
    }, [handleAgentUpdate]);

    const [isPasteMode, setIsPasteMode] = useState(false);
    const pasteBufferRef = useRef('');

    useInput(useCallback((inputStr, key) => {
        if (inputStr === '\x1b[200~') { setIsPasteMode(true); pasteBufferRef.current = ''; return; }
        if (inputStr === '\x1b[201~') { setIsPasteMode(false); const normalized = pasteBufferRef.current.replace(/\r\n/g, '\n').replace(/\n/g, ' '); setInput((prev) => prev + normalized); return; }
        if (isPasteMode) { pasteBufferRef.current += inputStr; return; }
        if (key.return) { if (inputRef.current.trim().toLowerCase() === 'exit') exit(); else if (inputRef.current.trim()) handleSend(); return; }
        if (key.backspace || key.delete) { setInput((p) => p.slice(0, -1)); return; }
        if (key.ctrl && inputStr === 'c') exit();
        if (key.ctrl && inputStr === 'l') setMessages([]);
        if (!key.ctrl && !key.meta && inputStr.length >= 1) setInput((p) => p + inputStr);
    }, [handleSend, exit, isPasteMode]));

    const terminalWidth = stdout?.columns || 100;
    const showCompact = terminalWidth < 120;

    return (
        <Box flexDirection="column" height="100%">
            <PredatorHeader sessionStats={sessionStats} showCompact={showCompact} />

            <Box
                flexDirection="column"
                flexGrow={1}
                marginBottom={1}
                borderStyle="singleDouble"
                borderColor="cyan"
                paddingX={2}
                paddingY={1}
                minHeight={10}
            >
                <MessageHistory messages={messages} maxVisible={showCompact ? 3 : 5} />

                {messages.length === 0 && (
                    <Box padding={2} justifyContent="center" flexDirection="column" alignItems="center">
                        <Text color="gray">Predator Online. Feed me commands.</Text>
                        <Text dimColor color="cyan">exit | clear | Ctrl+C</Text>
                    </Box>
                )}

                {streamingContent && (
                    <Box marginTop={1} flexDirection="column">
                        <Text bold color="cyan">⚡ MURPHY:</Text>
                        <Box marginLeft={2}>
                            <Text>{streamingContent.length > 300 ? '...' + streamingContent.slice(-300) : streamingContent}</Text>
                            <PredatorSpinner active={true} />
                        </Box>
                    </Box>
                )}

                <ActiveToolPanel tools={activeTools} phase={currentPhase} />
            </Box>

            <TelemetryBar telemetry={telemetry} isProcessing={status !== 'ready'} />

            <Box marginTop={1} paddingX={2} flexDirection="row">
                <Box width={12}><Text color="cyan" bold>{status === 'ready' ? '❯' : '⏳'}</Text></Box>
                <Box flexGrow={1}><Text color={input.length > 0 ? 'white' : 'gray'}>{input.length > 0 ? input : 'Deploy instructions...'}</Text></Box>
                <Box width={15} justifyContent="flex-end"><Text dimColor>{status === 'ready' ? 'Ctrl+C' : '⏵ RUN'}</Text></Box>
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
