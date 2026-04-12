/**
 * Murphy File Lock Manager
 * Prevents race conditions during parallel tool execution.
 */

class LockManager {
    private locks: Map<string, Promise<void>> = new Map();

    /**
     * Acquire a lock for a specific file path.
     * Returns a function to release the lock.
     */
    async acquire(filePath: string): Promise<() => void> {
        const pathKey = filePath.toLowerCase();

        // Wait for existing lock if any
        while (this.locks.has(pathKey)) {
            await this.locks.get(pathKey);
        }

        let resolveLock: () => void;
        const lockPromise = new Promise<void>((resolve) => {
            resolveLock = resolve;
        });

        this.locks.set(pathKey, lockPromise);

        return () => {
            this.locks.delete(pathKey);
            resolveLock();
        };
    }
}

export const lockManager = new LockManager();
