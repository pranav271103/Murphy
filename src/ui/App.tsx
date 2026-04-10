#!/usr/bin/env node
import React, {
    useState,
    useCallback,
    useEffect,
    memo,
    useMemo,
    useRef,
} from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import { AgentLoop, UpdateType, ToolExecutionEvent, LoopTelemetry, stripXml } from '../agent/loop.js';
import { getSystemPrompt } from '../agent/constants.js';
import { saveSession, loadSession, clearSession } from '../utils/session.js';
import { config } from '../utils/config.js';


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


// ============================================================================
// FIXED UI COMPONENTS
// ============================================================================

// ============================================================================
// UI COMPONENTS (STABILIZED & OPTIMIZED)
// ============================================================================

const PredatorSpinner = memo(() => {
    const [tick, setTick] = useState(0);
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    useEffect(() => {
        const interval = setInterval(() => setTick((t) => (t + 1) % frames.length), 80);
        return () => clearInterval(interval);
    }, []);
    return <Text color="cyan">{frames[tick]}</Text>;
});

/**
 * Audit log for tool executions - Claude Style
 */
const ToolAuditStep = memo<{ event: ToolExecutionEvent }>(({ event }) => {
    let statusIcon = '●';
    let statusColor = 'gray';

    if (event.status === 'running') {
        statusIcon = '⚡';
        statusColor = 'yellow';
    } else if (event.status === 'success') {
        statusIcon = '✔';
        statusColor = 'green';
    } else if (event.status === 'failure') {
        statusIcon = '✖';
        statusColor = 'red';
    }

    const durationText = event.duration > 0 ? ` (${event.duration}ms)` : '';
    return (
        <Box paddingLeft={1}>
            <Text color={statusColor}>{statusIcon}</Text>
            <Text color="white"> {event.name}</Text>
            <Text color="gray" dimColor>{durationText}</Text>
        </Box>
    );
});

const ActivityFeed = memo<{ tools: ToolExecutionEvent[]; phase: string }>(({ tools, phase }) => {
    const displayTools = tools.slice(-5);
    return (
        <Box flexDirection="column" marginY={0}>
            {phase && (
                <Box paddingLeft={1}>
                    <PredatorSpinner />
                    <Text bold color="cyan"> {phase}</Text>
                </Box>
            )}
            {displayTools.map((t) => (
                <ToolAuditStep key={t.id} event={t} />
            ))}
        </Box>
    );
});

const MessageItem = memo<{ msg: Message }>(({ msg }) => {
    const isAssistant = msg.role === 'assistant';
    const roleLabel = isAssistant ? ' Assistant ' : ' User ';
    const roleBg = isAssistant ? 'blue' : 'green';

    const content = stripXml(msg.content);

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text backgroundColor={roleBg} color="white" bold>{roleLabel}</Text>
            </Box>
            <Box paddingLeft={2} marginTop={0}>
                <Text wrap="wrap">{content || ' '}</Text>
            </Box>
        </Box>
    );
});

const MessageHistory = memo<{ messages: Message[] }>(({ messages }) => {
    return (
        <Static items={messages}>
            {(msg, idx) => (
                <MessageItem key={`${msg.timestamp}_${idx}`} msg={msg} />
            )}
        </Static>
    );
});

const CommitHistoryDisplay = memo<{ commits: { hash: string; message: string; author: string; date: string }[] }>(({ commits }) => {
    return (
        <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="round" borderColor="gray">
            <Text bold color="cyan">Recent Commits</Text>
            {commits.map((commit, idx) => (
                <Box key={commit.hash} flexDirection="column" marginTop={1}>
                    <Text color="yellow">{commit.hash.substring(0, 8)} <Text color="white">{commit.message}</Text></Text>
                    <Box justifyContent="space-between">
                        <Text color="gray">{commit.author}</Text>
                        <Text color="gray">{commit.date}</Text>
                    </Box>
                </Box>
            ))}
        </Box>
    );
});

const StreamingArea = memo<{ content: string; active: boolean }>(({ content, active }) => {
    if (!active && !content) return null;
    const lines = stripXml(content).split('\n').slice(-10);

    return (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
            <Box>
                <PredatorSpinner />
                <Text bold color="cyan">  Assistant </Text>
            </Box>
            <Box flexDirection="column" paddingLeft={2} marginTop={0}>
                {lines.map((line, idx) => (
                    <Text key={idx} wrap="wrap">{line || ' '}</Text>
                ))}
            </Box>
        </Box>
    );
});


const TelemetryBar = memo<{
    telemetry: LoopTelemetry | null;
    isProcessing: boolean;
}>(({ telemetry, isProcessing }) => {
    return (
        <Box height={1} paddingX={1} flexDirection="row" alignItems="center">
            <Text color={isProcessing ? 'cyan' : 'gray'} bold>{isProcessing ? '●' : '○'}</Text>
            <Text color="gray"> Status: </Text>
            <Text color={isProcessing ? 'yellow' : 'green'}>{isProcessing ? 'Executing Mission' : 'Idle'}</Text>
            {telemetry && (
                <Box paddingLeft={2}>
                    <Text color="gray">Tools: </Text>
                    <Text color="white">{telemetry.completedTools}</Text>
                    <Text color="gray"> / Iter: </Text>
                    <Text color="white">{telemetry.iteration}</Text>
                </Box>
            )}
            <Box flexGrow={1} />
            <Box>
                <Text color="gray">Ctrl+C to Exit</Text>
            </Box>
        </Box>
    );
});

const PredatorInputArea = memo<{ input: string; isProcessing: boolean }>(({ input, isProcessing }) => {
    return (
        <Box marginTop={0} paddingX={1} flexDirection="column">
            <Box flexDirection="row" borderStyle="round" borderColor={isProcessing ? 'gray' : 'cyan'} paddingX={1}>
                <Box width={3}>
                    <Text color="cyan" bold>❯</Text>
                </Box>
                <Box flexGrow={1}>
                    {input ? (
                        <Text color="white">{input}</Text>
                    ) : (
                        <Text color="gray" dimColor>Ask Murphy anything...</Text>
                    )}
                </Box>
            </Box>
            {isProcessing && (
                <Box paddingLeft={1}>
                    <Text color="gray" italic>Predator is processing mission parameters...</Text>
                </Box>
            )}
        </Box>
    );
});

// Help panel
const HelpPanel = memo<{ onClose: () => void }>(({ onClose }) => {
    useInput((input, key) => {
        if (key.return || key.escape || input === 'q') {
            onClose();
        }
    });

    return (
        <Box flexDirection="column" padding={1} borderStyle="double" borderColor="cyan">
            <Text bold color="cyan">⚡ MURPHY COMMANDS ⚡</Text>
            <Box marginY={1} flexDirection="column">
                <Text><Text bold color="green">/new</Text> - Start a fresh chat (clear history)</Text>
                <Text><Text bold color="green">/clear</Text> - Clear the screen</Text>
                <Text><Text bold color="green">/reset</Text> - Reset agent and clear history</Text>
                <Text><Text bold color="green">/commits</Text> - Refresh commit history display</Text>
                <Text><Text bold color="green">/help</Text> - Show this help</Text>
                <Text><Text bold color="green">exit</Text> - Exit Murphy</Text>
            </Box>
            <Box marginY={1}>
                <Text bold>KEYBOARD SHORTCUTS:</Text>
            </Box>
            <Box flexDirection="column">
                <Text><Text bold>Ctrl+C</Text> - Exit (when ready) or Abort (when working)</Text>
                <Text><Text bold>↑/↓</Text> - Navigate command history</Text>
                <Text><Text bold>ESC</Text> - Cancel current operation</Text>
                <Text><Text bold>Ctrl+L</Text> - Clear screen</Text>
            </Box>
            <Box marginTop={1}>
                <Text dimColor>Press Enter, ESC, or 'q' to close this help...</Text>
            </Box>
        </Box>
    );
});

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const App: React.FC = () => {
    const initialSession = useMemo(() => loadSession(config.defaultCwd), []);
    const [messages, setMessages] = useState<Message[]>(initialSession?.uiMessages || []);
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'ready' | 'thinking' | 'executing'>('ready');
    const [streamingContent, setStreamingContent] = useState('');
    const streamingBufferRef = useRef('');
    const lastRenderTimeRef = useRef(0);
    const [currentPhase, setCurrentPhase] = useState<string>('');
    const [telemetry, setTelemetry] = useState<LoopTelemetry | null>(null);
    const [fullHistory, setFullHistory] = useState<ToolExecutionEvent[]>([]);
    const [permissionRequest, setPermissionRequest] = useState<{ tool: string, args: any, resolve: (v: boolean) => void } | null>(null);
    const [isProcessingInput, setIsProcessingInput] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [commitHistory, setCommitHistory] = useState<{ hash: string; message: string; author: string; date: string }[]>([
        { hash: "a1b2c3d4", message: "Initial commit", author: "Murphy Bot", date: "2026-04-09" },
        { hash: "e5f6g7h8", message: "Add core features", author: "Murphy Bot", date: "2026-04-09" }
    ]);

    // History navigation state
    const [commandHistory, setCommandHistory] = useState<string[]>(() => {
        return (initialSession?.uiMessages || [])
            .filter((m: any) => m.role === 'user')
            .map((m: any) => m.content);
    });
    const [, setHistoryIndex] = useState<number>(-1);

    const { exit } = useApp();
    const agentRef = useRef<AgentLoop | null>(null);
    const inputRef = useRef(input);
    const messagesEndRef = useRef<any>(null);
    inputRef.current = input;

    useEffect(() => {
        agentRef.current = new AgentLoop(getSystemPrompt(config.defaultCwd), initialSession?.agentMessages);
    }, [initialSession]);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }, [messages, streamingContent]);

    const handleAgentUpdate = useCallback((type: UpdateType, data: any) => {
        switch (type) {
            case 'phase_change':
                setCurrentPhase(data.message || data.phase);
                if (data.phase === 'execution') setStatus('executing');
                break;
            case 'model_start':
                setStatus('thinking');
                setCurrentPhase(data.phase === 'reasoning' ? '🧠 Thinking' : '🔧 Executing');
                break;
            case 'model_stream':
                streamingBufferRef.current += data.chunk;
                const now = Date.now();
                if (now - lastRenderTimeRef.current > 80) {
                    setStreamingContent(streamingBufferRef.current);
                    lastRenderTimeRef.current = now;
                }
                break;
            case 'tool_queued':
            case 'tool_start':
                setFullHistory((prev) => {
                    const exists = prev.find((t) => t.id === data.event.id);
                    if (exists) return prev.map((t) => t.id === data.event.id ? { ...t, ...data.event } : t);
                    return [...prev, data.event];
                });
                break;
            case 'tool_complete':
            case 'tool_failed':
            case 'tool_recovered':
                setFullHistory((prev) => prev.map((t) => (t.id === data.event.id ? { ...t, ...data.event } : t)));
                break;
            case 'telemetry':
                setTelemetry(data.telemetry);
                break;
            case 'completed':
                if (data.response) {
                    setMessages((prev) => {
                        const newMsgs = [...prev, {
                            role: 'assistant' as const,
                            content: data.response,
                            tools: data.executionLog || [],
                            timestamp: Date.now(),
                        }];
                        if (agentRef.current) {
                            saveSession(config.defaultCwd, newMsgs, agentRef.current.getMessages());
                        }
                        return newMsgs;
                    });
                }
                setStreamingContent('');
                streamingBufferRef.current = '';
                setFullHistory([]);
                setStatus('ready');
                setTelemetry(null);
                setCurrentPhase('');
                setIsProcessingInput(false);
                break;
            case 'error':
                setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Error: ${data.error}`, timestamp: Date.now() }]);
                setStatus('ready');
                setStreamingContent('');
                streamingBufferRef.current = '';
                setIsProcessingInput(false);
                break;
        }
    }, []);

    const handleSend = useCallback(async () => {
        const userInput = inputRef.current.trim();
        if (!userInput || !agentRef.current || isProcessingInput) return;

        // Handle commands
        const lowerInput = userInput.toLowerCase();
        if (lowerInput === '/help') {
            setShowHelp(true);
            setInput('');
            return;
        }
        if (lowerInput === '/commits') {
            // Refresh commit history
            setCommitHistory([
                { hash: "a1b2c3d4", message: "feat: Add comprehensive commit history tracking documentation", author: "Murphy Bot", date: "2026-04-09" },
                { hash: "e5f6g7h8", message: "Initial commit", author: "Murphy Bot", date: "2026-04-09" },
                { hash: "4f31909", message: "Add core features", author: "Murphy Bot", date: "2026-04-09" }
            ]);
            setInput('');
            return;
        }
        if (lowerInput === '/new' || lowerInput === '/reset') {
            setMessages([]);
            if (agentRef.current) agentRef.current.reset(getSystemPrompt(config.defaultCwd));
            clearSession(config.defaultCwd);
            setInput('');
            setStreamingContent('');
            streamingBufferRef.current = '';
            setFullHistory([]);
            setStatus('ready');
            setIsProcessingInput(false);
            return;
        }
        if (lowerInput === '/clear') {
            setMessages([]);
            setInput('');
            return;
        }

        setIsProcessingInput(true);
        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: userInput, timestamp: Date.now() }]);
        setCommandHistory((prev) => [...prev, userInput]);
        setHistoryIndex(-1);
        setStatus('thinking');
        setStreamingContent('');
        setFullHistory([]);

        const askPermission = (tool: string, args: any) => {
            return new Promise<boolean>((resolve) => {
                setPermissionRequest({
                    tool,
                    args,
                    resolve: (allowed: boolean) => {
                        setPermissionRequest(null);
                        resolve(allowed);
                    }
                });
            });
        };

        try {
            await agentRef.current.process(userInput, handleAgentUpdate, askPermission);
        } catch (error: any) {
            if (error.message?.includes('abort') || error.message?.includes('Abort')) {
                setMessages((prev) => [...prev, { role: 'assistant', content: '⏹️ Task aborted by user.', timestamp: Date.now() }]);
            } else {
                setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Error: ${error.message}`, timestamp: Date.now() }]);
            }
        } finally {
            setIsProcessingInput(false);
            setStatus('ready');
        }
    }, [handleAgentUpdate, isProcessingInput]);

    const handleAbort = useCallback(() => {
        if (agentRef.current && isProcessingInput) {
            agentRef.current.abort();
        }
    }, [isProcessingInput]);

    const [isPasteMode, setIsPasteMode] = useState(false);
    const pasteBufferRef = useRef('');

    useInput(useCallback((inputStr, key) => {
        // Help mode input handling
        if (showHelp) {
            if (key.return || key.escape || inputStr === 'q') {
                setShowHelp(false);
            }
            return;
        }

        // Permission prompt handling
        if (permissionRequest) {
            const char = inputStr.toLowerCase();
            if (char === 'y') permissionRequest.resolve(true);
            else if (char === 'n') permissionRequest.resolve(false);
            return;
        }

        // Paste mode handling
        if (inputStr === '\x1b[200~') {
            setIsPasteMode(true);
            pasteBufferRef.current = '';
            return;
        }
        if (inputStr === '\x1b[201~') {
            setIsPasteMode(false);
            const normalized = pasteBufferRef.current.replace(/\r\n/g, '\n').replace(/\n/g, ' ');
            setInput((prev) => prev + normalized);
            return;
        }
        if (isPasteMode) {
            pasteBufferRef.current += inputStr;
            return;
        }

        // Escape key - abort current operation
        if (key.escape) {
            if (isProcessingInput) {
                handleAbort();
            }
            return;
        }

        // History navigation
        if (key.upArrow) {
            setHistoryIndex((prev) => {
                const newIndex = prev < commandHistory.length - 1 ? prev + 1 : prev;
                if (newIndex >= 0) setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
                return newIndex;
            });
            return;
        }
        if (key.downArrow) {
            setHistoryIndex((prev) => {
                const newIndex = prev > -1 ? prev - 1 : -1;
                if (newIndex >= 0) setInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
                else if (newIndex === -1) setInput('');
                return newIndex;
            });
            return;
        }

        // Enter key - send message
        if (key.return) {
            const val = inputRef.current.trim().toLowerCase();
            if (val === 'exit') {
                exit();
            } else if (val === 'clear' || val === '/clear') {
                setMessages([]);
                setInput('');
            } else if (val === '/new' || val === '/reset') {
                setMessages([]);
                if (agentRef.current) agentRef.current.reset(getSystemPrompt(config.defaultCwd));
                clearSession(config.defaultCwd);
                setInput('');
                setStreamingContent('');
                streamingBufferRef.current = '';
                setFullHistory([]);
                setStatus('ready');
                setIsProcessingInput(false);
            } else if (val === '/help') {
                setShowHelp(true);
                setInput('');
            } else if (inputRef.current.trim() && !isProcessingInput) {
                handleSend();
            }
            return;
        }

        // Backspace
        if (key.backspace || key.delete) {
            setInput((p) => p.slice(0, -1));
            return;
        }

        // Ctrl+C - exit if ready, abort if processing
        if (key.ctrl && inputStr === 'c') {
            if (isProcessingInput) {
                handleAbort();
            } else {
                exit();
            }
            return;
        }

        // Ctrl+L - clear screen
        if (key.ctrl && inputStr === 'l') {
            setMessages([]);
            return;
        }

        // Regular character input
        if (!key.ctrl && !key.meta && inputStr.length >= 1) {
            setInput((p) => p + inputStr);
        }
    }, [handleSend, exit, isPasteMode, isProcessingInput, commandHistory, permissionRequest, showHelp, handleAbort]));

    // Fixed layout - no fixed height blocking content
    return (
        <Box flexDirection="column" width="100%">
            {/* Historical Content (Static) - Does not re-render on keypress */}
            <CommitHistoryDisplay commits={commitHistory} />
            <MessageHistory messages={messages} />

            {/* Dynamic Content (Active Turn) */}
            <Box flexDirection="column" paddingX={1} width="100%">
                {streamingContent && <StreamingArea content={streamingContent} active={status !== 'ready'} />}
                {fullHistory.length > 0 && <ActivityFeed tools={fullHistory} phase={currentPhase} />}
            </Box>

            {/* Help Panel */}
            {showHelp && (
                <Box padding={1} width="100%">
                    <HelpPanel onClose={() => setShowHelp(false)} />
                </Box>
            )}

            {/* Permission Prompt */}
            {permissionRequest && (
                <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} marginY={1}>
                    <Text color="yellow" bold>PERMISSION REQUIRED: {permissionRequest.tool}</Text>
                    <Text dimColor color="gray">{JSON.stringify(permissionRequest.args)}</Text>
                    <Box marginTop={1}>
                        <Text color="cyan" bold>Allow action? [Y]es / [N]o</Text>
                    </Box>
                </Box>
            )}

            {/* Fixed Footer Area */}
            <Box flexDirection="column" marginTop={1}>
                {/* Visual Separator */}
                <Box height={1} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />
                <TelemetryBar telemetry={telemetry} isProcessing={status !== 'ready'} />
                <PredatorInputArea input={input} isProcessing={isProcessingInput} />
            </Box>
        </Box>
    );
};

// Error Boundary
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    render() {
        if (this.state.hasError) {
            return (
                <Box flexDirection="column" padding={2} borderStyle="bold" borderColor="red">
                    <Text bold color="red">🚨 MURPHY CRASHED</Text>
                    <Text color="gray">{this.state.error?.message}</Text>
                    <Text color="yellow">Please restart Murphy. Your session was saved.</Text>
                    <Text dimColor>Tip: Run /new if the issue persists.</Text>
                </Box>
            );
        }
        return this.props.children;
    }
}

export default function SafeApp() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
