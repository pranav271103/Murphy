import dotenv from 'dotenv';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const GLOBAL_ENV_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.murphy');
const GLOBAL_ENV_PATH = path.join(GLOBAL_ENV_DIR, 'env');

// Load environment from multiple possible locations, starting with highest precedence
const envPaths = [
    GLOBAL_ENV_PATH,
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '.env.local'),
];

for (const envPath of envPaths) {
    if (existsSync(envPath)) {
        const result = dotenv.config({ path: envPath, override: true });
        // Only override if the value is actually present and not empty
        // dotenv override: true is a bit aggressive, but here we want the highest precedence
        // to be the local files, BUT if they are empty we want the next ones.
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
 * Update global configuration
 */
export function updateGlobalConfig(keys: { 
    nvidiaApiKey?: string; 
    kimiApiKey?: string; 
    qwenApiKey?: string;
}): void {
    if (!existsSync(GLOBAL_ENV_DIR)) {
        mkdirSync(GLOBAL_ENV_DIR, { recursive: true });
    }

    let content = '';
    if (existsSync(GLOBAL_ENV_PATH)) {
        // Simple update: append or overwrite
        // For simplicity in this implementation, we'll just write the ones provided
        // In a real app we might want to read first and merge
    }

    if (keys.nvidiaApiKey) content += `NVIDIA_API_KEY=${keys.nvidiaApiKey}\n`;
    if (keys.kimiApiKey) content += `NVIDIA_API_KIMI=${keys.kimiApiKey}\n`;
    if (keys.qwenApiKey) content += `NVIDIA_API_QWEN=${keys.qwenApiKey}\n`;

    // Also add defaults for models if not present
    content += `KIMI_MODEL=moonshotai/kimi-k2-thinking\n`;
    content += `QWEN_MODEL=qwen/qwen3-coder-480b-a35b-instruct\n`;

    writeFileSync(GLOBAL_ENV_PATH, content, { encoding: 'utf8', flag: 'w' });
    
    // Also update current process.env and config object so we don't need a restart
    if (keys.nvidiaApiKey) {
        process.env.NVIDIA_API_KEY = keys.nvidiaApiKey;
        config.nvidiaApiKey = keys.nvidiaApiKey;
        
        // Propagate to model-specific keys if not explicitly provided
        if (!keys.kimiApiKey) {
            config.kimiApiKey = keys.nvidiaApiKey;
        }
        if (!keys.qwenApiKey) {
            config.qwenApiKey = keys.nvidiaApiKey;
        }
    }
    if (keys.kimiApiKey) {
        process.env.NVIDIA_API_KIMI = keys.kimiApiKey;
        config.kimiApiKey = keys.kimiApiKey;
    }
    if (keys.qwenApiKey) {
        process.env.NVIDIA_API_QWEN = keys.qwenApiKey;
        config.qwenApiKey = keys.qwenApiKey;
    }
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
