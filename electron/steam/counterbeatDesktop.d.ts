/** Typed renderer API exposed by electron/preload.js as window.counterbeatDesktop.steam (all calls async over IPC). */
export interface SteamStatus {
    available: boolean;
    achievements: boolean;
    /** No cloud save implementation exists yet, so this is always false. */
    cloud: boolean;
    appId: number | null;
    reason: string | null;
}
export interface SteamBridge {
    getStatus(): Promise<SteamStatus>;
    getPlayerName(): Promise<string | null>;
    unlockAchievement(name: string): Promise<boolean>;
    isAchievementUnlocked(name: string): Promise<boolean>;
}
declare global {
    interface Window {
        counterbeatDesktop?: {
            platform: 'desktop';
            setWindowed(windowed: boolean): void;
            onWindowedChange(cb: (windowed: boolean) => void): void;
            steam: SteamBridge;
            quit(): void;
        };
    }
}
