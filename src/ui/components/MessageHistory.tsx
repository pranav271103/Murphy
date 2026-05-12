import React from 'react';
import { Box, Text } from 'ink';

interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
}

interface MessageHistoryProps {
    messages: Message[];
}

export const MessageHistory: React.FC<MessageHistoryProps> = ({ messages }) => {
    // Filter out tool messages for cleaner display
    const visibleMessages = messages.filter(m => m.role !== 'tool' && m.role !== 'system');

    return (
        <Box flexDirection="column" paddingX={1}>
            {visibleMessages.map((msg, i) => (
                <Box key={i} flexDirection="column" marginBottom={1}>
                    <Text bold color={msg.role === 'user' ? 'blue' : 'green'}>
                        {msg.role === 'user' ? '👤 User' : '🐆 Assistant'}
                    </Text>
                    <Box paddingLeft={2}>
                        <Text>{msg.content}</Text>
                    </Box>
                </Box>
            ))}
        </Box>
    );
};
