import fs from 'fs';
import path from 'path';

/**
 * Session persistence utility - IMPROVED VERSION
 *
 * Changes:
 * - Better error handling
 * - Atomic writes (write to temp file first)
 * - Size limiting to prevent huge session files
 * - Backup of corrupted sessions
 */

export interface SessionData {
    uiMessages: any[];
    agentMessages: any[];
    version: string;
    savedAt: string;
}

const SESSION_VERSION = '3.2';
const MAX_SESSION_SIZE = 10 * 1024 * 1024; // 10MB limit

export function getSessionPath(cwd: string): string {
    return path.join(cwd, '.murphy_session.json');
}

export function getBackupPath(cwd: string): string {
    return path.join(cwd, `.murphy_session.backup.${Date.now()}.json`);
}

export function saveSession(cwd: string, messages: any[], agentMessages: any[]): void {
    try {
        const sessionPath = getSessionPath(cwd);
        const sessionData: SessionData = {
            uiMessages: messages,
            agentMessages: agentMessages,
            version: SESSION_VERSION,
            savedAt: new Date().toISOString(),
        };

        const json = JSON.stringify(sessionData, null, 2);

        // Check size
        if (json.length > MAX_SESSION_SIZE) {
            console.warn('[Session] Session too large, pruning old messages...');
            // Keep only last 20 messages
            const prunedData: SessionData = {
                uiMessages: messages.slice(-20),
                agentMessages: agentMessages.slice(-30),
                version: SESSION_VERSION,
                savedAt: new Date().toISOString(),
            };
            const prunedJson = JSON.stringify(prunedData, null, 2);

            // Atomic write
            const tempPath = sessionPath + '.tmp';
            fs.writeFileSync(tempPath, prunedJson, 'utf-8');
            fs.renameSync(tempPath, sessionPath);
            return;
        }

        // Atomic write
        const tempPath = sessionPath + '.tmp';
        fs.writeFileSync(tempPath, json, 'utf-8');
        fs.renameSync(tempPath, sessionPath);
    } catch (e) {
        console.error('[Session] Failed to save:', e);
    }
}

export function loadSession(cwd: string): { uiMessages: any[], agentMessages: any[] } | null {
    try {
        const sessionPath = getSessionPath(cwd);
        if (fs.existsSync(sessionPath)) {
            const data = fs.readFileSync(sessionPath, 'utf-8');
            const parsed: SessionData = JSON.parse(data);

            // Validate
            if (!parsed.uiMessages || !parsed.agentMessages) {
                throw new Error('Invalid session format');
            }

            return {
                uiMessages: parsed.uiMessages,
                agentMessages: parsed.agentMessages,
            };
        }
    } catch (e) {
        console.error('[Session] Failed to load:', e);
        // Backup corrupted session
        try {
            const sessionPath = getSessionPath(cwd);
            if (fs.existsSync(sessionPath)) {
                const backupPath = getBackupPath(cwd);
                fs.renameSync(sessionPath, backupPath);
                console.log(`[Session] Backed up corrupted session to ${backupPath}`);
            }
        } catch (backupErr) {
            // Ignore backup errors
        }
    }
    return null;
}

export function clearSession(cwd: string): void {
    try {
        const sessionPath = getSessionPath(cwd);
        if (fs.existsSync(sessionPath)) {
            // Archive instead of delete
            const archivePath = path.join(cwd, `.murphy_session.archived.${Date.now()}.json`);
            fs.renameSync(sessionPath, archivePath);
        }
    } catch (e) {
        console.error('[Session] Failed to clear:', e);
    }
}

/**
 * Check if session exists
 */
export function hasSession(cwd: string): boolean {
    try {
        return fs.existsSync(getSessionPath(cwd));
    } catch {
        return false;
    }
}
