import { spawn, ChildProcess } from 'child_process';
import { resolveWorkspacePath } from './paths.js';

export interface DaemonProcess {
    name: string;
    command: string;
    process: ChildProcess;
    logs: string;
    status: 'running' | 'stopped' | 'failed';
    startTime: number;
}

class DaemonManager {
    private daemons: Map<string, DaemonProcess> = new Map();
    private readonly MAX_LOG_SIZE = 50000;

    public startDaemon(name: string, command: string, cwd: string = '.'): string {
        const key = name.toLowerCase().trim();
        if (this.daemons.has(key)) {
            const existing = this.daemons.get(key)!;
            if (existing.status === 'running') {
                return `⚠️ Process '${name}' is already running.`;
            }
        }

        const isWin = process.platform === 'win32';
        const child = spawn(command, {
            shell: isWin ? 'powershell.exe' : true,
            cwd: resolveWorkspacePath(cwd),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const daemon: DaemonProcess = {
            name,
            command,
            process: child,
            logs: `🚀 Process started: ${command}\n`,
            status: 'running',
            startTime: Date.now(),
        };

        this.daemons.set(key, daemon);

        // Capture stdout
        child.stdout?.on('data', (data) => {
            daemon.logs += data.toString();
            if (daemon.logs.length > this.MAX_LOG_SIZE) {
                daemon.logs = daemon.logs.slice(-this.MAX_LOG_SIZE);
            }
        });

        // Capture stderr
        child.stderr?.on('data', (data) => {
            daemon.logs += `[STDERR] ${data.toString()}`;
            if (daemon.logs.length > this.MAX_LOG_SIZE) {
                daemon.logs = daemon.logs.slice(-this.MAX_LOG_SIZE);
            }
        });

        child.on('close', (code) => {
            daemon.status = code === 0 || code === null ? 'stopped' : 'failed';
            daemon.logs += `\n🛑 Process exited with code ${code}\n`;
        });

        child.on('error', (err) => {
            daemon.status = 'failed';
            daemon.logs += `\n💥 Process error: ${err.message}\n`;
        });

        return `✅ Successfully started background daemon '${name}' running command: ${command}`;
    }

    public stopDaemon(name: string): string {
        const key = name.toLowerCase().trim();
        if (!this.daemons.has(key)) {
            return `❌ No daemon found with name '${name}'`;
        }

        const daemon = this.daemons.get(key)!;
        if (daemon.status !== 'running') {
            return `ℹ️ Daemon '${name}' is already stopped.`;
        }

        daemon.process.kill('SIGTERM');
        daemon.status = 'stopped';
        return `✅ Successfully stopped daemon '${name}'`;
    }

    public getDaemonLogs(name: string): string {
        const key = name.toLowerCase().trim();
        if (!this.daemons.has(key)) {
            return `❌ No daemon found with name '${name}'`;
        }

        const daemon = this.daemons.get(key)!;
        const uptime = Math.round((Date.now() - daemon.startTime) / 1000);
        return `📋 Logs for daemon '${daemon.name}' (Status: ${daemon.status}, Uptime: ${uptime}s):\n\n${daemon.logs}`;
    }

    public listDaemons(): string {
        if (this.daemons.size === 0) {
            return `ℹ️ No background daemons are active.`;
        }

        const list: string[] = [];
        for (const daemon of this.daemons.values()) {
            const uptime = Math.round((Date.now() - daemon.startTime) / 1000);
            list.push(`• ${daemon.name} [${daemon.status.toUpperCase()}] - Uptime: ${uptime}s - Command: "${daemon.command}"`);
        }

        return `Background Daemons:\n${list.join('\n')}`;
    }

    public stopAll(): void {
        for (const daemon of this.daemons.values()) {
            if (daemon.status === 'running') {
                try {
                    daemon.process.kill('SIGKILL');
                } catch {
                    // Ignore kill errors
                }
            }
        }
        this.daemons.clear();
    }
}

export const daemonManager = new DaemonManager();
