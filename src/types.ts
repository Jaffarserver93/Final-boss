export type BotStatus = 'STOPPED' | 'STARTING' | 'ACTIVE' | 'PAUSED' | 'ERROR';

export interface TelemetryData {
  status: BotStatus;
  currentUrl: string;
  uptime: number; // in seconds
  reloadCount: number;
  actionCount: number;
  lastAction: string;
  error?: string;
  viewportWidth: number;
  viewportHeight: number;
  browserCpuUsage: number; // mock or calculated
  browserMemoryUsage: number; // mock or calculated
}

export interface LogMessage {
  id: string;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'browser-log';
  text: string;
}

export interface BotConfig {
  url: string;
  actionInterval: number; // in seconds
  enableAutoScroll: boolean;
  enableAutoClick: boolean;
  enableNetworkMonitoring: boolean;
  userAgent: string;
  engine: 'puppeteer' | 'puppeteer-real-browser';
}
