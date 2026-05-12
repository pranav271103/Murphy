import React from 'react';
import { Box, Text } from 'ink';

export interface TelemetryData {
    iteration: number;
    completedTools: number;
}

interface MissionStatusProps {
    telemetry: TelemetryData | null;
    isProcessing: boolean;
    version: string;
}

export const MissionStatus: React.FC<MissionStatusProps> = ({ telemetry, isProcessing, version }) => {
    return (
        <Box height={1} paddingX={1} width="100%" justifyContent="space-between">
            <Box flexDirection="row">
                <Text color={isProcessing ? 'cyan' : 'gray'} bold>{isProcessing ? '●' : '○'}</Text>
                <Text color="gray"> STATUS: </Text>
                <Text color={isProcessing ? 'yellow' : 'green'}>
                    {isProcessing ? 'EXECUTING MISSION' : 'IDLE / READY'}
                </Text>
                {telemetry && (
                    <Box paddingLeft={2}>
                        <Text color="gray">TOOLS: </Text>
                        <Text color="white">{String(telemetry.completedTools)}</Text>
                        <Text color="gray"> | ITER: </Text>
                        <Text color="white">{String(telemetry.iteration)}</Text>
                    </Box>
                )}
            </Box>

            <Box>
                <Text color="gray" dimColor>
                    MURPHY v{version} <Text color="cyan">|</Text> ESC TO ABORT <Text color="cyan">|</Text> CTRL+C TO EXIT
                </Text>
            </Box>
        </Box>
    );
};
