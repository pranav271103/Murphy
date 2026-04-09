import React, {
    useState,
    useCallback,
    useEffect,
    useRef,
    memo,
    useMemo,
} from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { AgentLoop, UpdateType, ToolExecutionEvent, LoopTelemetry, stripXml } from '../agent/loop.js';
import { SYSTEM_PROMPT } from '../agent/constants.js';

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
// PREDATOR LEAF COMPONENTS - TUI Stability Phase 2
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
        }, 80);
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
 * CommandDetailTree - Collapsible tree showing full command details
 */
const CommandDetailTree = memo<{ event: ToolExecutionEvent; isExpanded: boolean }>(({ event, isExpanded }) => {
    if (!isExpanded) return null;
    return (
        <Box flexDirection="column" marginLeft={6} marginTop={1}>
            <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
                <Text color="gray" dimColor>Command: {event.name}</Text>
                <Text color="cyan" dimColor>Arguments: {JSON.stringify(event.args, null, 2)}</Text>
                {event.result && <Text color="green" dimColor>Result: {event.result.slice(0, 300)}</Text>}
            </Box>
        </Box>
    );
});

/**
 * TreeNode - Displays a single tool execution in the hierarchy
 */
const TreeNode = memo<{ event: ToolExecutionEvent; isLast: boolean; isExpanded: boolean }>(
    ({ event, isLast, isExpanded }) => {
        const connector = isLast ? '└──' : '├──';
        return (
            <Box flexDirection="column">
                <Box marginLeft={2}>
                    <Text dimColor>{connector} </Text>
                    {event.status === 'running' ? <PredatorSpinner active={true} /> : <Text color="green">✅</Text>}
                    <Text bold> {event.name}</Text>
                    <Text dimColor> ({event.duration}ms)</Text>
                </Box>
                <CommandDetailTree event={event} isExpanded={isExpanded} />
            </Box>
        );
    }
);

/**
 * ToolExecutionTree - Living hierarchy of command execution
 */
const ToolExecutionTree = memo<{ events: ToolExecutionEvent[] }>(({ events }) => {
    if (events.length === 0) return null;
    return (
        <Box flexDirection="column" marginLeft={4} marginTop={1}>
            <Text dimColor italic>├─ Execution Trace</Text>
            {events.map((event, idx) => (
                <TreeNode key={event.id} event={event} isLast={idx === events.length - 1} isExpanded={false} />
            ))}
        </Box>
    );
});

/**
 * PredatorInputArea - Isolated input rendering to prevent global re-renders while typing
 */
const PredatorInputArea = memo<{ input: string; status: string }>(({ input, status }) => (
    <Box marginTop={1} paddingX={2} flexDirection="row">
        <Box width={12}>
            <Text color="cyan" bold>{status === 'ready' ? 'PREDATOR ❯' : '⏳ RUNNING'}</Text>
        </Box>
        <Box flexGrow={1}>
            {input.length > 0 ? (
                <Text wrap="wrap">{input}</Text>
            ) : status === 'ready' ? (
                <Text color="gray" dimColor>Deploy instructions...</Text>
            ) : (
                <Text color="yellow">Processing...</Text>
            )}
        </Box>
        <Box width={15} justifyContent="flex-end">
            <Text dimColor>{status === 'ready' ? 'Ctrl+C Exit' : '⏵ Working'}</Text>
        </Box>
    </Box>
));

const BRANDING_STABLE = [{ id: 'murphy-branding-v1' }];

/**
 * MessageItem - Single message with stable rendering
 */
const MessageItem = memo<{ msg: Message }>(({ msg }) => {
    const roleColor = msg.role === 'user' ? 'green' : 'cyan';
    const roleLabel = msg.role === 'user' ? '❯ YOU' : '⚡ MURPHY';
    return (
        <Box marginBottom={0} flexDirection="column">
            <Box>
                <Text bold color={roleColor}>{roleLabel}:</Text>
                <Text> {stripXml(msg.content).length > 200 ? stripXml(msg.content).slice(0, 197) + '...' : stripXml(msg.content)}</Text>
            </Box>
        </Box>
    );
});

/**
 * MessageHistory - Extreme stability
 */
const MessageHistory = memo<{ messages: Message[]; maxVisible?: number }>(
    ({ messages, maxVisible = 2 }) => {
        const visibleMessages = useMemo(() => messages.slice(-maxVisible), [messages, maxVisible]);
        return (
            <Box flexDirection="column" flexGrow={0}>
                {visibleMessages.map((msg, idx) => (
                    <MessageItem key={`${msg.timestamp}_${idx}`} msg={msg} />
                ))}
            </Box>
        );
    }
);

/**
 * StreamingArea - Locked height
 */
const StreamingArea = memo<{ content: string; active: boolean }>(({ content, active }) => {
    if (!active && !content) return null;
    return (
        <Box marginTop={0} flexDirection="column" height={3} overflow="hidden">
            <Text bold color="cyan">⚡ STREAMING:</Text>
            <Box marginLeft={2}>
                <Text dimColor>{stripXml(content).length > 150 ? '...' + stripXml(content).slice(-150) : stripXml(content)}</Text>
                {active && <PredatorSpinner active={true} />}
            </Box>
        </Box>
    );
});

/**
 * ActiveToolPanel - Ultra compact
 */
const ActiveToolPanel = memo<{ tools: ToolExecutionEvent[]; phase?: string }>(({ tools, phase }) => {
    if (tools.length === 0 && !phase) return null;
    return (
        <Box flexDirection="row" marginTop={0} paddingX={1} borderStyle="single" borderColor="yellow" height={3}>
            <Text bold color="yellow">EXE: </Text>
            <Text wrap="truncate-end" dimColor>
                {phase || 'Processing'} | {tools.length} active
            </Text>
        </Box>
    );
});

const TelemetryBar = memo<{
    telemetry: LoopTelemetry | null;
    isProcessing: boolean;
    sessionStats: SessionStats;
}>(({ telemetry, isProcessing, sessionStats }) => {
    return (
        <Box height={1} paddingX={1} flexDirection="row" alignItems="center">
            <Text color="cyan" bold>{isProcessing ? '⚡ RUN' : '● OK'}</Text>
            <Text dimColor> | {sessionStats.messagesSent}m | </Text>
            {telemetry ? (
                <Text color="green">IT:{telemetry.iteration} | OK:{telemetry.completedTools}</Text>
            ) : (
                <Text color="gray" dimColor>STANDBY</Text>
            )}
            <Box flexGrow={1} />
            <PredatorTimer active={isProcessing} />
        </Box>
    );
});

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
    const [isProcessingInput, setIsProcessingInput] = useState(false);

    const { exit } = useApp();
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
        if (!userInput || !agentRef.current || isProcessingInput) return;
        
        setIsProcessingInput(true);
        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: userInput, timestamp: Date.now() }]);
        setStatus('thinking');
        setStreamingContent('');
        setActiveTools([]);
        setSessionStats((prev) => ({ ...prev, messagesSent: prev.messagesSent + 1 }));
        
        try {
            await agentRef.current.process(userInput, handleAgentUpdate);
        } finally {
            setIsProcessingInput(false);
            setStatus('ready');
        }
    }, [handleAgentUpdate, isProcessingInput]);

    const [isPasteMode, setIsPasteMode] = useState(false);
    const pasteBufferRef = useRef('');

    useInput(useCallback((inputStr, key) => {
        if (inputStr === '\x1b[200~') { setIsPasteMode(true); pasteBufferRef.current = ''; return; }
        if (inputStr === '\x1b[201~') { setIsPasteMode(false); const normalized = pasteBufferRef.current.replace(/\r\n/g, '\n').replace(/\n/g, ' '); setInput((prev) => prev + normalized); return; }
        if (isPasteMode) { pasteBufferRef.current += inputStr; return; }
        if (key.return) { 
            if (inputRef.current.trim().toLowerCase() === 'exit') exit(); 
            else if (inputRef.current.trim() && !isProcessingInput) handleSend(); 
            return; 
        }
        if (key.backspace || key.delete) { setInput((p) => p.slice(0, -1)); return; }
        if (key.ctrl && inputStr === 'c') exit();
        if (key.ctrl && inputStr === 'l') setMessages([]);
        if (!key.ctrl && !key.meta && inputStr.length >= 1) setInput((p) => p + inputStr);
    }, [handleSend, exit, isPasteMode, isProcessingInput]));

    return (
        <Box flexDirection="column" width="100%" height={20} overflow="hidden">
            <Static items={BRANDING_STABLE}>
                {(item) => (
                    <Box key={item.id} flexDirection="column" width="100%" marginBottom={1}>
                        <Box borderStyle="double" borderColor="cyan" paddingX={2} justifyContent="center">
                            <Text bold color="cyan"> ⚡ MURPHY v3.1.5 PREDATOR ⚡ </Text>
                        </Box>
                    </Box>
                )}
            </Static>

            <Box flexDirection="column" flexGrow={1} paddingX={2}>
                <MessageHistory messages={messages} maxVisible={4} />
                {messages.length === 0 && <Text dimColor italic>Standing by for mission parameters...</Text>}
            </Box>

            <Box flexDirection="column" paddingX={2} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
                <StreamingArea content={streamingContent} active={status !== 'ready'} />
                <ActiveToolPanel tools={activeTools} phase={currentPhase} />
                <TelemetryBar telemetry={telemetry} isProcessing={status !== 'ready'} sessionStats={sessionStats} />
                <PredatorInputArea input={input} status={status} />
            </Box>
        </Box>
    );
};

export default App;
