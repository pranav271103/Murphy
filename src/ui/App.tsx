#!/usr/bin/env node
import React, {
    useState,
    useCallback,
    useEffect,
    useRef,
    useMemo,
} from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentLoop, UpdateType, ToolExecutionEvent, LoopTelemetry } from '../agent/loop.js';
import { getSystemPrompt } from '../agent/constants.js';
import { saveSession, loadSession, clearSession } from '../utils/session.js';
import { config } from '../utils/config.js';

// Sub-components
import { MissionHeader } from './components/MissionHeader.js';
import { MessageHistory } from './components/MessageHistory.js';
import { ToolTray } from './components/ToolTray.js';
import { MissionStatus } from './components/MissionStatus.js';

// Types
interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
}

const App: React.FC = () => {
    // Session & Context
    const initialSession = useMemo(() => loadSession(config.defaultCwd), []);
    const [messages, setMessages] = useState<Message[]>(initialSession?.uiMessages || []);
    
    // Mission State
    const [status, setStatus] = useState<'ready' | 'thinking' | 'executing'>('ready');
    const [currentPhase, setCurrentPhase] = useState<string>('');
    const [telemetry, setTelemetry] = useState<LoopTelemetry | null>(null);
    const [activeTools, setActiveTools] = useState<ToolExecutionEvent[]>([]);
    
    // UI Interaction
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const { exit } = useApp();
    
    // Agent Instance
    const agentRef = useRef<AgentLoop | null>(null);
    useEffect(() => {
        agentRef.current = new AgentLoop(getSystemPrompt(config.defaultCwd), initialSession?.agentMessages);
    }, [initialSession]);

    // Handle Agent Communication
    const handleUpdate = useCallback((type: UpdateType, data: any) => {
        switch (type) {
            case 'phase_change':
                setCurrentPhase(data.message || data.phase);
                break;
            case 'model_start':
                setStatus('thinking');
                setCurrentPhase(data.phase === 'reasoning' ? '🧠 Analyzing' : '🔧 Processing');
                break;
            case 'tool_queued':
            case 'tool_start':
                setActiveTools(prev => {
                    const exists = prev.find(t => t.id === data.event.id);
                    if (exists) return prev.map(t => t.id === data.event.id ? { ...t, ...data.event } : t);
                    return [...prev, data.event];
                });
                break;
            case 'tool_complete':
            case 'tool_failed':
                setActiveTools(prev => prev.map(t => t.id === data.event.id ? { ...t, ...data.event } : t));
                // Clear tool after delay
                setTimeout(() => {
                    setActiveTools(prev => prev.filter(t => t.id !== data.event.id));
                }, 3000);
                break;
            case 'telemetry':
                setTelemetry(data.telemetry);
                break;
            case 'completed':
                if (data.response) {
                    setMessages(prev => {
                        const next = [...prev, {
                            role: 'assistant' as const,
                            content: data.response,
                            timestamp: Date.now()
                        }];
                        if (agentRef.current) {
                            saveSession(config.defaultCwd, next, agentRef.current.getMessages());
                        }
                        return next;
                    });
                }
                setStatus('ready');
                setIsProcessing(false);
                break;
        }
    }, []);

    const handleSend = useCallback(async () => {
        if (!input.trim() || isProcessing) return;
        
        const userInput = input.trim();
        setInput('');
        setIsProcessing(true);
        setMessages(prev => [...prev, { role: 'user', content: userInput, timestamp: Date.now() }]);
        
        try {
            await agentRef.current?.process(userInput, handleUpdate);
        } catch (error: any) {
            setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Mission Failure: ${error.message}`, timestamp: Date.now() }]);
            setIsProcessing(false);
            setStatus('ready');
        }
    }, [input, isProcessing, handleUpdate]);

    // Input Handling
    useInput((inputStr, key) => {
        if (key.return) {
            if (input.trim().toLowerCase() === 'exit') exit();
            else handleSend();
            return;
        }
        if (key.backspace || key.delete) {
            setInput(p => p.slice(0, -1));
            return;
        }
        if (key.ctrl && inputStr === 'c') {
            if (isProcessing) agentRef.current?.abort();
            else exit();
            return;
        }
        if (!key.ctrl && !key.meta && inputStr.length === 1) {
            setInput(p => p + inputStr);
        }
    });

    return (
        <Box flexDirection="column" width="100%" paddingX={2} paddingY={1}>
            <MissionHeader version="4.0-ALPHA" phase={currentPhase || 'Standby'} />
            
            <Box flexDirection="column" minHeight={10} flexGrow={1}>
                <MessageHistory messages={messages} />
            </Box>

            <ToolTray activeTools={activeTools} />

            <Box flexDirection="column" marginTop={1}>
                <MissionStatus 
                    telemetry={telemetry} 
                    isProcessing={status !== 'ready'} 
                    version="4.0-ALPHA" 
                />
                
                <Box borderStyle="round" borderColor={isProcessing ? 'yellow' : 'cyan'} paddingX={1}>
                    <Text color="cyan" bold>❯ </Text>
                    {input ? (
                        <Text color="white">{input}</Text>
                    ) : (
                        <Text color="gray" italic>Analyze, build, or deploy... ask Murphy anything.</Text>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

export default App;
