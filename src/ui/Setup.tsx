import React, { useState, memo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { updateGlobalConfig } from '../utils/config.js';

const MurphyInkLogo = memo(() => {
    return (
        <Box flexDirection="column" marginY={1}>
            <Text color="cyan" bold>{String.raw`   __  __ _    _ _____  _____  _    ___     __`}</Text>
            <Text color="cyan" bold>{String.raw`  |  \/  | |  | |  __ \|  __ \| |  | \ \   / /`}</Text>
            <Text color="cyan" bold>{String.raw`  | \  / | |  | | |__) | |__) | |__| |\ \_/ / `}</Text>
            <Text color="cyan" bold>{String.raw`  | |\/| | |  | |  _  /|  ___/|  __  | \   /  `}</Text>
            <Text color="cyan" bold>{String.raw`  | |  | | |__| | | \ \| |    | |  | |  | |   `}</Text>
            <Text color="cyan" bold>{String.raw`  |_|  |_|\____/|_|  \_\_|    |_|  |_|  |_|   `}</Text>
            <Box paddingLeft={2}>
                <Text color="gray" dimColor>PREDATOR v3.4 EDITION | MISSION INITIALIZATION</Text>
            </Box>
        </Box>
    );
});

interface SetupProps {
    onComplete: () => void;
}

const Setup: React.FC<SetupProps> = ({ onComplete }) => {
    const [input, setInput] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const { exit } = useApp();

    useInput((inputStr, key) => {
        if (key.ctrl && inputStr === 'c') {
            exit();
            return;
        }

        if (key.return) {
            if (input.trim() && !isSaving) {
                const keyVal = input.trim();
                setIsSaving(true);
                
                // Simulate a small delay for "predator" aesthetic
                setTimeout(() => {
                    updateGlobalConfig({ nvidiaApiKey: keyVal });
                    onComplete();
                }, 1000);
            }
            return;
        }

        if (key.backspace || key.delete) {
            setInput((p) => p.slice(0, -1));
            return;
        }

        if (!key.ctrl && !key.meta && inputStr.length >= 1) {
            setInput((p) => p + inputStr);
        }
    });

    return (
        <Box flexDirection="column" padding={2} width={80}>
            <MurphyInkLogo />
            
            <Box borderStyle="double" borderColor="cyan" padding={1} flexDirection="column" marginTop={1}>
                <Text bold color="yellow">⚠️  MISSION REQUISITES MISSING</Text>
                <Box marginTop={1}>
                    <Text>Murphy requires an NVIDIA NIM API Key to operate.</Text>
                </Box>
                <Text color="gray">This key will be saved globally at <Text color="white">~/.murphy/env</Text></Text>
                
                <Box marginY={1} flexDirection="column">
                    <Text bold color="cyan">How to get your key:</Text>
                    <Text>1. Visit <Text color="cyan" underline>https://build.nvidia.com/</Text></Text>
                    <Text>2. Log in and select any model (e.g., Llama or Qwen)</Text>
                    <Text>3. Click "Get API Key" and copy it</Text>
                    <Text>4. Paste it below and press ENTER</Text>
                </Box>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold color={isSaving ? "green" : "cyan"}>
                    {isSaving ? "✓ KEY INITIALIZED" : "ENTER NVIDIA_API_KEY:"}
                </Text>
                <Box borderStyle="round" borderColor={isSaving ? "green" : "cyan"} paddingX={1} marginTop={1}>
                    <Text color="white">{isSaving ? "********************************" : (input ? '*'.repeat(input.length) : (
                        <Text color="gray" italic dimColor>paste your key here...</Text>
                    ))}</Text>
                </Box>
                {isSaving ? (
                    <Box marginTop={1}>
                        <Text color="green" bold>🚀 Saving to global environment and launching mission...</Text>
                    </Box>
                ) : (
                    <Box marginTop={1}>
                        <Text color="gray" dimColor>Press Ctrl+C to abort</Text>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default Setup;
