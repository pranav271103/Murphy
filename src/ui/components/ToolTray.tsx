import React from 'react';
import { Box, Text } from 'ink';

export interface ToolEvent {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'failure' | 'recovered';
    duration?: number;
    error?: string;
}

interface ToolTrayProps {
    activeTools: ToolEvent[];
}

export const ToolTray: React.FC<ToolTrayProps> = ({ activeTools }) => {
    if (activeTools.length === 0) return null;

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
            <Text bold color="cyan">🔧 ACTIVE SYSTEMS</Text>
            {activeTools.map((tool) => (
                <Box key={tool.id} justifyContent="space-between">
                    <Box>
                        <Text color={tool.status === 'running' ? 'yellow' : tool.status === 'success' ? 'green' : tool.status === 'recovered' ? 'cyan' : 'red'}>
                            {tool.status === 'running' ? '▶' : tool.status === 'success' ? '✓' : tool.status === 'recovered' ? '↺' : '✗'}
                        </Text>
                        <Text> {tool.name}</Text>
                    </Box>
                    {!!tool.duration && <Text color="gray"> {tool.duration}ms</Text>}
                </Box>
            ))}
        </Box>
    );
};
