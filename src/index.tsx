#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './ui/App.js';
import { validateConfig, logConfig } from './utils/config.js';
import { clearSession } from './utils/session.js';

/**
 * Murphy v3.2 - The High-Speed Coding Predator
 *
 * Entry point for the Murphy CLI application.
 * Improvements:
 * - Better error handling
 * - Startup flags (--new, --help)
 * - Graceful shutdown
 */

async function main() {
    const args = process.argv.slice(2);

    // Handle startup flags
    if (args.includes('--help') || args.includes('-h')) {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  MURPHY - The High-Speed Coding Predator');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('Usage: murphy [options]');
        console.log('');
        console.log('Options:');
        console.log('  --new, -n       Start a fresh session (clear history)');
        console.log('  --help, -h      Show this help message');
        console.log('  --version, -v   Show version');
        console.log('');
        console.log('Commands (within Murphy):');
        console.log('  /help           Show available commands');
        console.log('  /new            Start a new chat');
        console.log('  /clear          Clear the screen');
        console.log('  /reset          Reset agent and clear history');
        console.log('  exit            Exit Murphy');
        console.log('');
        console.log('Keyboard shortcuts:');
        console.log('  Ctrl+C          Exit when ready, abort when working');
        console.log('  ESC             Abort current operation');
        console.log('  ↑/↓             Navigate command history');
        console.log('  Ctrl+L          Clear screen');
        console.log('═══════════════════════════════════════════════════════════');
        process.exit(0);
    }

    if (args.includes('--version') || args.includes('-v')) {
        console.log('Murphy v3.4.0');
        process.exit(0);
    }

    if (args.includes('--new') || args.includes('-n')) {
        clearSession(process.cwd());
        console.log('🗑️  Previous session cleared. Starting fresh...\n');
    }

    // Validate configuration before starting
    const validation = validateConfig();

    if (!validation.valid) {
        console.error('╔════════════════════════════════════════════════════════════╗');
        console.error('║  MURPHY INITIALIZATION FAILED                              ║');
        console.error('╠════════════════════════════════════════════════════════════╣');
        validation.errors.forEach((error) => {
            console.error(`║  ❌ ${error.padEnd(56)} ║`);
        });
        console.error('╚════════════════════════════════════════════════════════════╝\n');
        console.error('Create a .env file with:');
        console.error('  NVIDIA_API_KEY=your_api_key_here');
        console.error('\nGet your API key at: https://build.nvidia.com/\n');
        process.exit(1);
    }

    // Show configuration banner (Disabled for recording)
    // logConfig();

    // Start the Ink application
    const { waitUntilExit } = render(
        React.createElement(App),
        {
            stdout: process.stdout,
            stdin: process.stdin,
            patchConsole: true,
            exitOnCtrlC: false, // We handle this ourselves
        }
    );

    // Handle graceful shutdown
    const shutdown = (signal: string) => {
        console.log(`\n\n⚡ ${signal} received. Shutting down gracefully...`);
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        console.error('\n💥 Uncaught Exception:', error.message);
        console.error('Murphy will attempt to continue, but may be unstable.');
    });

    process.on('unhandledRejection', (reason) => {
        console.error('\n💥 Unhandled Promise Rejection:', reason);
    });

    // Wait for app to exit
    await waitUntilExit();
}

// Execute main with error handling
main().catch((error) => {
    console.error('\n💥 CRITICAL FAILURE:', error.message);
    console.error('\nPlease report this issue at: https://github.com/pranav271103/Murphy/issues');
    process.exit(1);
});
