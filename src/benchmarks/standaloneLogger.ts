// Standalone logger for benchmarking (no vscode dependency)
export const logger = {
    log: (message: string, ...args: any[]) => {
        if (process.env.DEBUG) {
            console.log(`[LOG] ${message}`, ...args);
        }
    },
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args);
    },
    info: (message: string, ...args: any[]) => {
        if (process.env.DEBUG) {
            console.log(`[INFO] ${message}`, ...args);
        }
    },
    warn: (message: string, ...args: any[]) => {
        console.warn(`[WARN] ${message}`, ...args);
    }
};