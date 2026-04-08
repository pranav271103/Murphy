import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';

// Load environment from multiple possible locations
const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
    path.join(process.env.HOME || '', '.murphy', 'env'),
];

for (const envPath of envPaths) {
    if (existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
    }
}

// Fallback to default .env
if (!process.env.NVIDIA_API_KEY) {
    dotenv.config();
}

/**
 * Murphy Configuration
 *
 * Centralized configuration for all Murphy components.
 * Supports environment variables and sensible defaults.
 */
export const config = {
    // API Keys (NVIDIA NIM uses same key for both models typically)
    nvidiaApiKey: process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KIMI || '',
    kimiApiKey: process.env.NVIDIA_API_KIMI || process.env.NVIDIA_API_KEY || '',
    qwenApiKey: process.env.NVIDIA_API_QWEN || process.env.NVIDIA_API_KEY || '',

    // NVIDIA NIM Configuration
    nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',

    // Model IDs
    kimiModel: process.env.KIMI_MODEL || 'moonshotai/kimi-k2-thinking',
    qwenModel: process.env.QWEN_MODEL || 'qwen/qwen3-coder-480b-a35b-instruct',

    // Execution settings
    defaultCwd: process.env.DEFAULT_CWD || process.cwd(),
    maxConcurrentTools: parseInt(process.env.MAX_CONCURRENT_TOOLS || '10', 10),
    toolTimeout: parseInt(process.env.TOOL_TIMEOUT || '120000', 10),

    // UI settings
    theme: process.env.MURPHY_THEME || 'retro',
    showTelemetry: process.env.MURPHY_TELEMETRY !== 'false',
    debugMode: process.env.MURPHY_DEBUG === 'true',
};

/**
 * Validate configuration on startup
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.nvidiaApiKey && !config.kimiApiKey && !config.qwenApiKey) {
        errors.push('NVIDIA_API_KEY not set. Get one at https://build.nvidia.com/');
    }

    if (config.maxConcurrentTools < 1 || config.maxConcurrentTools > 50) {
        errors.push('MAX_CONCURRENT_TOOLS must be between 1 and 50');
    }

    if (config.toolTimeout < 5000) {
        errors.push('TOOL_TIMEOUT must be at least 5000ms (5 seconds)');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Log configuration (without exposing secrets)
 */
export function logConfig(): void {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MURPHY v3.0 PREDATOR CONFIGURATION');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Kimi Model:    ${config.kimiModel}`);
    console.log(`  Qwen Model:    ${config.qwenModel}`);
    console.log(`  Base URL:      ${config.nvidiaBaseUrl}`);
    console.log(`  Working Dir:   ${config.defaultCwd}`);
    console.log(`  Concurrent:    ${config.maxConcurrentTools} tools`);
    console.log(`  Tool Timeout:  ${config.toolTimeout}ms`);
    console.log(`  Theme:         ${config.theme}`);
    console.log(`  Telemetry:     ${config.showTelemetry ? 'ON' : 'OFF'}`);
    console.log(`  Debug Mode:    ${config.debugMode ? 'ON' : 'OFF'}`);
    console.log(`  API Key:       ${config.nvidiaApiKey ? '✅ Loaded' : '❌ Missing'}`);
    console.log('═══════════════════════════════════════════════════════════\n');
}

// Auto-log on import in debug mode
if (config.debugMode) {
    const validation = validateConfig();
    logConfig();
    if (!validation.valid) {
        console.warn('Configuration warnings:');
        validation.errors.forEach((e) => console.warn(`  ⚠️ ${e}`));
    }
}

// Predator Evolution Step 19

// Predator Evolution Step 22

// Predator Evolution Step 28

// Predator Evolution Step 32

// Predator Evolution Step 37

// Predator Evolution Step 38
