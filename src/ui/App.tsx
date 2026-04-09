#!/usr/bin/env node
import React, {
    useState,
    useCallback,
    useEffect,
    memo,
    useMemo,
    useRef,
} from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentLoop, UpdateType, ToolExecutionEvent, LoopTelemetry, stripXml } from '../agent/loop.js';
import { getSystemPrompt } from '../agent/constants.js';
import { saveSession, loadSession, clearSession } from '../utils/session.js';
import { config } from '../utils/config.js';
import fs from 'fs';
import path from 'path';

let pkgVersion = 'UNKNOWN';
try {
    const pkgPath = path.join(config.defaultCwd, 'package.json');
    pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
} catch (e) {
    // Ignore
}

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
// FIXED UI COMPONENTS
// ============================================================================

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

    const seconds = Math.floor(elapsed / 1000);
    const ms = elapsed % 1000;
    return <Text bold color={active ? 'yellow' : 'gray'}>{seconds}.{ms.toString().padStart(3, '0')}s</Text>;
});

// Message display - SHOWS FULL CONTENT, not truncated
const MessageItem = memo<{ msg: Message }>(({ msg }) => {
    const roleColor = msg.role === 'user' ? 'green' : 'cyan';
    const roleLabel = msg.role === 'user' ? '❯ YOU' : '⚡ MURPHY';
    const strippedContent = useMemo(() => stripXml(msg.content), [msg.content]);

    // Split content into lines for proper display
    const lines = strippedContent.split('\n');

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color={roleColor}>{roleLabel}:</Text>
            <Box flexDirection="column" paddingLeft={2}>
                {lines.map((line, idx) => (
                    <Text key={idx} wrap="wrap">{line || ' '}</Text>
                ))}
            </Box>
        </Box>
    );
});

// Full message history - NOT limited to 10
const MessageHistory = memo<{ messages: Message[] }>(({ messages }) => {
    return (
        <Box flexDirection="column" flexGrow={1}>
            {messages.length === 0 && (
                <Box flexDirection="column" paddingY={1}>
                    <Text color="gray" italic>Standing by for mission parameters...</Text>
                    <Text dimColor>Type your request or /help for commands</Text>
                </Box>
            )}
            {messages.map((msg, idx) => (
                <MessageItem key={`${msg.timestamp}_${idx}`} msg={msg} />
            ))}
        </Box>
    );
});

// Streaming area - SHOWS FULL CONTENT, not just last 150 chars
const StreamingArea = memo<{ content: string; active: boolean }>(({ content, active }) => {
    if (!active && !content) return null;
    const lines = stripXml(content).split('\n');

    return (
        <Box flexDirection="column" marginY={1} paddingX={1} borderStyle="single" borderColor="cyan">
            <Text bold color="cyan">⚡ STREAMING:</Text>
            <Box flexDirection="column" paddingLeft={2}>
                {lines.slice(-20).map((line, idx) => (
                    <Text key={idx} dimColor wrap="wrap">{line || ' '}</Text>
                ))}
                {active && (
                    <Box>
                        <PredatorSpinner active={true} />
                    </Box>
                )}
            </Box>
        </Box>
    );
});

const ActiveToolPanel = memo<{ tools: ToolExecutionEvent[]; phase?: string }>(({ tools, phase }) => {
    if (tools.length === 0 && !phase) return null;
    return (
        <Box flexDirection="row" marginY={0} paddingX={1}>
            <Text bold color="yellow">EXE:</Text>
            <Text color="white"> {phase || 'Ready'} </Text>
            {tools.length > 0 && (
                <Text dimColor>| {tools.length} tool{tools.length > 1 ? 's' : ''} active</Text>
            )}
        </Box>
    );
});

const TelemetryBar = memo<{
    telemetry: LoopTelemetry | null;
    isProcessing: boolean;
    sessionStats: SessionStats;
}>(({ telemetry, isProcessing, sessionStats }) => {
    return (
        <Box height={1} paddingX={1} flexDirection="row" alignItems="center" borderStyle="single" borderColor="gray" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
            <Text color={isProcessing ? 'yellow' : 'green'} bold>{isProcessing ? '⚡ RUNNING' : '● READY'}</Text>
            <Text dimColor> | Msgs:{sessionStats.messagesSent} </Text>
            {telemetry ? (
                <><Text color="cyan">| Iter:{telemetry.iteration}</Text><Text dimColor> | Tools:{telemetry.completedTools}</Text></>
            ) : null}
            <Box flexGrow={1} />
            <PredatorTimer active={isProcessing} />
        </Box>
    );
});

// Input area with clear status
const PredatorInputArea = memo<{ input: string; status: string }>(({ input, status }) => {
    const isReady = status === 'ready';
    return (
        <Box marginTop={1} paddingX={1} flexDirection="row">
            <Box width={12}>
                <Text color={isReady ? 'green' : 'yellow'} bold>
                    {isReady ? 'PREDATOR ❯' : 'WORKING...'}
                </Text>
            </Box>
            <Box flexGrow={1}>
                {input.length > 0 ? (
                    <Text color="white" wrap="wrap">{input}</Text>
                ) : isReady ? (
                    <Text color="gray" dimColor>Type /help for commands...</Text>
                ) : (
                    <Text color="yellow" dimColor>Processing your request...</Text>
                )}
            </Box>
            <Box width={15} justifyContent="flex-end">
                <Text dimColor>{isReady ? 'Ctrl+C: Exit' : 'ESC: Abort'}</Text>
            </Box>
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
    const [currentPhase, setCurrentPhase] = useState<string>('');
    const [telemetry, setTelemetry] = useState<LoopTelemetry | null>(null);
    const [activeTools, setActiveTools] = useState<ToolExecutionEvent[]>([]);
    const [permissionRequest, setPermissionRequest] = useState<{ tool: string, args: any, resolve: (v: boolean) => void } | null>(null);
    const [sessionStats, setSessionStats] = useState<SessionStats>({
        messagesSent: 0, tokensProcessed: 0, totalToolExecutions: 0, avgModelLatency: 0,
    });
    const [isProcessingInput, setIsProcessingInput] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [abortRequested, setAbortRequested] = useState(false);

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
                setActiveTools([]);
                setStatus('ready');
                setTelemetry(null);
                setCurrentPhase('');
                setIsProcessingInput(false);
                setSessionStats((prev) => ({ ...prev, totalToolExecutions: prev.totalToolExecutions + (data.executionLog?.length || 0) }));
                break;
            case 'error':
                setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Error: ${data.error}`, timestamp: Date.now() }]);
                setStatus('ready');
                setStreamingContent('');
                setActiveTools([]);
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
        if (lowerInput === '/new' || lowerInput === '/reset') {
            setMessages([]);
            if (agentRef.current) agentRef.current.reset(getSystemPrompt(config.defaultCwd));
            clearSession(config.defaultCwd);
            setInput('');
            setStreamingContent('');
            setActiveTools([]);
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
        setAbortRequested(false);
        setInput('');
        setMessages((prev) => [...prev, { role: 'user', content: userInput, timestamp: Date.now() }]);
        setCommandHistory((prev) => [...prev, userInput]);
        setHistoryIndex(-1);
        setStatus('thinking');
        setStreamingContent('');
        setActiveTools([]);
        setSessionStats((prev) => ({ ...prev, messagesSent: prev.messagesSent + 1 }));

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
            setAbortRequested(false);
        }
    }, [handleAgentUpdate, isProcessingInput]);

    const handleAbort = useCallback(() => {
        if (agentRef.current && isProcessingInput) {
            agentRef.current.abort();
            setAbortRequested(true);
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
                setActiveTools([]);
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
            {/* Header */}
            <Box flexDirection="column" width="100%" marginBottom={1}>
                <Box borderStyle="double" borderColor="cyan" paddingX={2} justifyContent="center">
                    <Text bold color="cyan">⚡ MURPHY v{pkgVersion} PREDATOR ⚡</Text>
                </Box>
            </Box>

            {/* Help Panel (conditional) */}
            {showHelp && (
                <Box marginBottom={1}>
                    <HelpPanel onClose={() => setShowHelp(false)} />
                </Box>
            )}

            {/* Messages Area - FULL HEIGHT, no truncation */}
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <MessageHistory messages={messages} />
                <div ref={messagesEndRef} />
            </Box>

            {/* Permission Request */}
            {permissionRequest && (
                <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
                    <Text color="yellow" bold>⚠️ PERMISSION REQUIRED: {permissionRequest.tool}</Text>
                    <Text color="gray" wrap="wrap">{JSON.stringify(permissionRequest.args)}</Text>
                    <Text color="cyan" bold>Allow? [Y]es / [N]o</Text>
                </Box>
            )}

            {/* Abort indicator */}
            {abortRequested && (
                <Box marginY={1}>
                    <Text color="yellow">⏹️ Aborting... Please wait...</Text>
                </Box>
            )}

            {/* Bottom Panel - Fixed at bottom */}
            <Box flexDirection="column" borderStyle="single" borderColor="gray" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
                <StreamingArea content={streamingContent} active={status !== 'ready'} />
                <ActiveToolPanel tools={activeTools} phase={currentPhase} />
                <TelemetryBar telemetry={telemetry} isProcessing={status !== 'ready'} sessionStats={sessionStats} />
                <PredatorInputArea input={input} status={status} />
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
