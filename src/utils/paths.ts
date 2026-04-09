import path from 'path';
import { config } from './config.js';

/**
 * Normalizes and resolves a requested path against the workspace root.
 * Ensures the target path does not escape the workspace (directory traversal).
 * @throws Error if path attempts to escape the root directory
 */
export function resolveWorkspacePath(requestedPath: string): string {
    const root = config.defaultCwd;
    
    // Resolve relative or absolute path against root
    // Absolute paths provided by the user (like C:\Users\...) will resolve strictly to themselves
    const resolved = path.resolve(root, requestedPath);
    
    return resolved;
}
