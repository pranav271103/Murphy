#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './ui/App.js';
import { validateConfig, logConfig } from './utils/config.js';

/**
 * Murphy v3.0 - The High-Speed Coding Predator
 *
 * Entry point for the Murphy CLI application.
 * Initializes the Ink-based TUI with optimized settings.
 */
async function main() {
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

    // Show configuration banner
    logConfig();

    // Start the Ink application with optimizations
    const { waitUntilExit } = render(
        React.createElement(App),
        {
            // Performance optimizations
            stdout: process.stdout,
            stdin: process.stdin,
            // Patch console to not interfere with Ink
            patchConsole: true,
            // Exit on Ctrl+C
            exitOnCtrlC: true,
        }
    );

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\n⚡ Predator disengaging...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n\n⚡ Predator shutting down...');
        process.exit(0);
    });

    // Wait for app to exit
    await waitUntilExit();
}

// Execute main with error handling
main().catch((error) => {
    console.error('\n💥 CRITICAL FAILURE:', error);
    process.exit(1);
});
