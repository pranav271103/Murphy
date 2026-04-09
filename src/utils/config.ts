import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';

// Load environment from multiple possible locations, starting with highest precedence
const envPaths = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.murphy', 'env'),
];

for (const envPath of envPaths) {
    if (existsSync(envPath)) {
        // We do not break on the first find, we load in order of overrides (dotenv won't override existing env vars)
        dotenv.config({ path: envPath });
    }
}

// Fallback to default .env if not found above
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

    // Model configuration
    models: {
        reasoning: {
            id: process.env.KIMI_MODEL || 'moonshotai/kimi-k2-thinking',
            temperature: 0.7,
            maxTokens: 8192,
            timeout: 120000,
            client: 'kimi' as const,
        },
        execution: {
            id: process.env.QWEN_MODEL || 'qwen/qwen3-coder-480b-a35b-instruct',
            temperature: 0.1,
            maxTokens: 16384,
            timeout: 180000,
            client: 'qwen' as const,
        },
    },

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
    console.log(`  Kimi Model:    ${config.models.reasoning.id}`);
    console.log(`  Qwen Model:    ${config.models.execution.id}`);
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

export const MODEL_CONFIG = config.models;
