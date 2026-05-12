import React from 'react';
import { Box, Text } from 'ink';

interface MissionHeaderProps {
    version: string;
    phase: string;
}

export const MissionHeader: React.FC<MissionHeaderProps> = ({ version, phase }) => {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text color="green" bold>
{`
                        __  __ _    _ _____  _____  _    ___     __
                       |  \/  | |  | |  __ \|  __ \| |  | \ \   / /
                       | \  / | |  | | |__) | |__) | |__| |\ \_/ / 
                       | |\/| | |  | |  _  /|  ___/|  __  | \   /  
                       | |  | | |__| | | \ \| |    | |  | |  | |   
                       |_|  |_|\____/|_|  \_\_|    |_|  |_|  |_|   `}
            </Text>
            <Box justifyContent="space-between" paddingX={1} borderStyle="single" borderColor="green">
                <Text color="green" bold>PREDATOR v{version} EDITION</Text>
                <Text color="yellow">PHASE: {phase.toUpperCase()}</Text>
                <Text color="green">MISSION CONTROL CENTER</Text>
            </Box>
        </Box>
    );
};
