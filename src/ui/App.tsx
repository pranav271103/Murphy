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
import { execSync } from 'child_process';

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
// BRANDING COMPONENTS
// ============================================================================

const MurphyInkLogo = memo(() => {
    const columns = process.stdout.columns || 80;
    const logoWidth = 52; // Approximate width of the ASCII art
    const padding = Math.max(0, Math.floor((columns - logoWidth) / 2));

    return (
        <Box flexDirection="column" width="100%" marginY={1}>
            <Box flexDirection="column" paddingLeft={padding}>
                <Text color="cyan" bold>{String.raw`   __  __ _    _ _____  _____  _    ___     __`}</Text>
                <Text color="cyan" bold>{String.raw`  |  \/  | |  | |  __ \|  __ \| |  | \ \   / /`}</Text>
                <Text color="cyan" bold>{String.raw`  | \  / | |  | | |__) | |__) | |__| |\ \_/ / `}</Text>
                <Text color="cyan" bold>{String.raw`  | |\/| | |  | |  _  /|  ___/|  __  | \   /  `}</Text>
                <Text color="cyan" bold>{String.raw`  | |  | | |__| | | \ \| |    | |  | |  | |   `}</Text>
                <Text color="cyan" bold>{String.raw`  |_|  |_|\____/|_|  \_\_|    |_|  |_|  |_|   `}</Text>
                <Box paddingLeft={2}>
                    <Text color="gray" dimColor>PREDATOR v3.4 EDITION | MISSION CONTROL CENTER</Text>
                </Box>
            </Box>
            <Box width="100%" marginY={1}>
                <Text color="gray">{'─'.repeat(columns)}</Text>
            </Box>
        </Box>
    );
});

// ============================================================================
// UI COMPONENTS
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
        <Box flexDirection="column">
            <Box paddingLeft={1}>
                <Text color={statusColor}>{statusIcon}</Text>
                <Text color="white"> {event.name}</Text>
                <Text color="gray" dimColor>{durationText}</Text>
            </Box>
            {event.liveOutput && (
                <Box paddingLeft={4}>
                    <Text color="gray" dimColor italic>{event.liveOutput}</Text>
                </Box>
            )}
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
        <Static items={[{ role: 'system', content: '__LOGO__', timestamp: 0 } as Message, ...messages]}>
            {(msg, idx) => (
                <Box key={idx} flexDirection="column" width="100%">
                    {msg.content === '__LOGO__' ? <MurphyInkLogo /> : <MessageItem msg={msg} />}
                </Box>
            )}
        </Static>
    );
});

const CommitHistoryDisplay = memo<{ commits: { hash: string; message: string; author: string; date: string }[] }>(({ commits }) => {
    if (commits.length === 0) return null;
    return (
        <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="round" borderColor="gray">
            <Text bold color="cyan">Recent Commits</Text>
            {commits.map((commit) => (
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

const TerminalOutput = memo<{
    messages: Message[];
    commitHistory: { hash: string; message: string; author: string; date: string }[];
    showCommits: boolean;
}>(({ messages, commitHistory, showCommits }) => {
    return (
        <Box flexDirection="column" width="100%">
            {showCommits && <CommitHistoryDisplay commits={commitHistory} />}
            <MessageHistory messages={messages} />
        </Box>
    );
});

const ActiveWorkArea = memo<{
    content: string;
    active: boolean;
    tools: ToolExecutionEvent[];
    phase: string;
}>(({ content, active, tools, phase }) => {
    if (!active && !content && tools.length === 0 && !phase) return null;
    return (
        <Box flexDirection="column" paddingX={1} width="100%">
            {content && <StreamingArea content={content} active={active} />}
            {tools.length > 0 && <ActivityFeed tools={tools} phase={phase} />}
        </Box>
    );
});

const TelemetryBar = memo<{
    telemetry: LoopTelemetry | null;
    isProcessing: boolean;
}>(({ telemetry, isProcessing }) => {
    return (
        <Box height={1} paddingX={1} width="100%" justifyContent="space-between">
            <Box flexDirection="row">
                <Text color={isProcessing ? 'cyan' : 'gray'} bold>{isProcessing ? '●' : '○'}</Text>
                <Text color="gray"> STATUS: </Text>
                <Text color={isProcessing ? 'yellow' : 'green'}>{isProcessing ? 'EXECUTING MISSION' : 'IDLE / READY'}</Text>
                {telemetry && (
                    <Box paddingLeft={2}>
                        <Text color="gray">TOOLS: </Text>
                        <Text color="white">{telemetry.completedTools}</Text>
                        <Text color="gray"> | ITER: </Text>
                        <Text color="white">{telemetry.iteration}</Text>
                    </Box>
                )}
            </Box>

            <Box>
                <Text color="gray" dimColor>MURPHY v3.4 <Text color="cyan">|</Text> ESC TO ABORT <Text color="cyan">|</Text> CTRL+C TO EXIT</Text>
            </Box>
        </Box>
    );
});

const PredatorInputArea = memo<{ input: string; isProcessing: boolean }>(({ input, isProcessing }) => {
    return (
        <Box flexDirection="column" marginTop={1} width="100%">
            <Box
                borderStyle="round"
                borderColor={isProcessing ? "yellow" : "cyan"}
                paddingX={2}
                width="100%"
            >
                <Box flexDirection="row" flexGrow={1}>
                    <Text color="cyan" bold>❯ </Text>
                    {input ? (
                        <Text color="white">{input}</Text>
                    ) : (
                        <Text color="gray" dimColor italic>Ask Murphy anything...</Text>
                    )}
                </Box>
            </Box>
            {isProcessing && (
                <Box width="100%" paddingLeft={4} marginTop={0}>
                    <PredatorSpinner />
                    <Text color="yellow" italic>  Executing mission protocols...</Text>
                </Box>
            )}
        </Box>
    );
});

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
                <Text><Text bold color="green">/new</Text> - Start a NEW CHAT (clears history)</Text>
                <Text><Text bold color="green">/clear</Text> - Clear the screen</Text>
                <Text><Text bold color="green">/reset</Text> - Reset agent and clear history</Text>
                <Text><Text bold color="green">/commits</Text> - TOGGLE commit history window</Text>
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
    const [currentPhase, setCurrentPhase] = useState<string>('');
    const [telemetry, setTelemetry] = useState<LoopTelemetry | null>(null);
    const [fullHistory, setFullHistory] = useState<ToolExecutionEvent[]>([]);
    const [permissionRequest, setPermissionRequest] = useState<{ tool: string, args: any, resolve: (v: boolean) => void } | null>(null);
    const [isProcessingInput, setIsProcessingInput] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showCommits, setShowCommits] = useState(false);
    const [commitHistory, setCommitHistory] = useState<{ hash: string; message: string; author: string; date: string }[]>([]);

    const [input, setInput] = useState('');
    const [isPasteMode, setIsPasteMode] = useState(false);
    const pasteBufferRef = useRef('');
    const [status, setStatus] = useState<'ready' | 'thinking' | 'executing'>('ready');
    const [streamingContent, setStreamingContent] = useState('');
    const streamingBufferRef = useRef('');
    const lastRenderTimeRef = useRef(0);

    useEffect(() => {
        try {
            const output = execSync('git log --oneline -10 --pretty=format:"%h|%s|%an|%ad"', {
                cwd: process.cwd(),
                env: process.env,
                encoding: 'utf8'
            }).toString();

            const commits = output.split('\n').filter(line => line.trim() !== '').map(line => {
                const [hash, message, author, date] = line.split('|');
                return { hash, message, author, date };
            });

            setCommitHistory(commits);
        } catch (error) {
            setCommitHistory([]);
        }
    }, []);

    const [commandHistory, setCommandHistory] = useState<string[]>(() => {
        return (initialSession?.uiMessages || [])
            .filter((m: any) => m.role === 'user')
            .map((m: any) => m.content);
    });
    const [, setHistoryIndex] = useState<number>(-1);

    const { exit } = useApp();
    const agentRef = useRef<AgentLoop | null>(null);

    useEffect(() => {
        agentRef.current = new AgentLoop(getSystemPrompt(config.defaultCwd), initialSession?.agentMessages);
    }, [initialSession]);

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
            case 'tool_progress':
                setFullHistory((prev) => prev.map((t) => {
                    if (t.id === data.id) {
                        const newOutput = (t.liveOutput || '') + data.message;
                        // Limit live output to last 5 lines for UI sanity
                        const lines = newOutput.split('\n').slice(-5);
                        return { ...t, liveOutput: lines.join('\n') };
                    }
                    return t;
                }));
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

    const handleSend = useCallback(async (msg?: string) => {
        const userInput = (msg || input).trim();
        if (!userInput || !agentRef.current || isProcessingInput) return;

        const lowerInput = userInput.toLowerCase();
        if (lowerInput === '/help') { setShowHelp(true); setInput(''); return; }
        if (lowerInput === '/commits') { setShowCommits((prev) => !prev); setInput(''); return; }
        if (lowerInput === '/new' || lowerInput === '/reset') {
            setMessages([]);
            if (agentRef.current) agentRef.current.reset(getSystemPrompt(config.defaultCwd));
            clearSession(config.defaultCwd);
            setInput(''); setStreamingContent(''); setFullHistory([]); setStatus('ready'); setIsProcessingInput(false); setShowCommits(false);
            return;
        }
        if (lowerInput === '/clear' || lowerInput === 'clear') { setMessages([]); setInput(''); return; }

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
    }, [handleAgentUpdate, isProcessingInput, input]);

    const handleAbort = useCallback(() => {
        if (agentRef.current && isProcessingInput) {
            agentRef.current.abort();
        }
    }, [isProcessingInput]);

    useInput(useCallback((inputStr, key) => {
        if (showHelp) { if (key.return || key.escape || inputStr === 'q') setShowHelp(false); return; }
        if (permissionRequest) {
            const char = inputStr.toLowerCase();
            if (char === 'y') permissionRequest.resolve(true);
            else if (char === 'n') permissionRequest.resolve(false);
            return;
        }
        if (inputStr === '\x1b[200~') { setIsPasteMode(true); pasteBufferRef.current = ''; return; }
        if (inputStr === '\x1b[201~') {
            setIsPasteMode(false);
            const normalized = pasteBufferRef.current.replace(/\r\n/g, '\n').replace(/\n/g, ' ');
            setInput((prev) => prev + normalized);
            return;
        }
        if (isPasteMode) { pasteBufferRef.current += inputStr; return; }
        if (key.escape) { if (isProcessingInput) handleAbort(); return; }
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
        if (key.return) {
            const val = input.trim().toLowerCase();
            if (val === 'exit') exit();
            else if (val === 'clear' || val === '/clear') { setMessages([]); setInput(''); }
            else if (val === '/new' || val === '/reset') {
                setMessages([]);
                if (agentRef.current) agentRef.current.reset(getSystemPrompt(config.defaultCwd));
                clearSession(config.defaultCwd);
                setInput(''); setStreamingContent(''); setFullHistory([]); setStatus('ready'); setIsProcessingInput(false);
            } else if (val === '/help') { setShowHelp(true); setInput(''); }
            else if (input.trim() && !isProcessingInput) handleSend(input);
            return;
        }
        if (key.backspace || key.delete) { setInput((p) => p.slice(0, -1)); return; }
        if (key.ctrl && inputStr === 'c') { if (isProcessingInput) handleAbort(); else exit(); return; }
        if (key.ctrl && inputStr === 'l') { setMessages([]); return; }
        if (!key.ctrl && !key.meta && inputStr.length >= 1) { setInput((p) => p + inputStr); }
    }, [input, handleSend, exit, isPasteMode, isProcessingInput, commandHistory, permissionRequest, showHelp, handleAbort]));

    return (
        <Box flexDirection="column" width="100%">
            <TerminalOutput
                messages={messages}
                commitHistory={commitHistory}
                showCommits={showCommits}
            />

            <ActiveWorkArea
                content={streamingContent}
                active={status !== 'ready'}
                tools={fullHistory}
                phase={currentPhase}
            />

            {showHelp && (
                <Box padding={1} width="100%">
                    <HelpPanel onClose={() => setShowHelp(false)} />
                </Box>
            )}

            {permissionRequest && (
                <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} marginY={1}>
                    <Text color="yellow" bold>PERMISSION REQUIRED: {permissionRequest.tool}</Text>
                    <Text dimColor color="gray">{JSON.stringify(permissionRequest.args)}</Text>
                    <Box marginTop={1}><Text color="cyan" bold>Allow action? [Y]es / [N]o</Text></Box>
                </Box>
            )}

            <Box flexDirection="column" marginTop={1}>
                {/* Visual separator */}
                <Box width="100%" height={1} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />

                <TelemetryBar telemetry={telemetry} isProcessing={status !== 'ready'} />

                <PredatorInputArea input={input} isProcessing={isProcessingInput} />
            </Box>
            <Box height={1} />
        </Box>
    );
};

// Error Boundary
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
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
