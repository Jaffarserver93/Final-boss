import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, 
  Square, 
  RefreshCw, 
  Terminal, 
  Layers, 
  Globe, 
  Compass, 
  Cpu, 
  Activity, 
  MousePointer, 
  Keyboard, 
  Monitor, 
  CloudLightning,
  Workflow, 
  ShieldCheck, 
  Server, 
  Clock, 
  Link2,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BotStatus, TelemetryData, LogMessage } from './types';

// Pre-defined dashboard target presets for quick launch
const URL_PRESETS = [
  { name: 'Vektal Nodes Login', url: 'https://vektalnodes.in/login' },
  { name: 'Vektal Nodes Coins AFK', url: 'https://vektalnodes.in/earn' },
  { name: 'Hacker News (General Sandbox)', url: 'https://news.ycombinator.com' },
  { name: 'GitHub Trending Dashboard', url: 'https://github.com/trending' }
];

export default function App() {
  // Websocket states
  const [isConnected, setIsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    status: 'STOPPED',
    currentUrl: 'https://vektalnodes.in/login',
    uptime: 0,
    reloadCount: 0,
    actionCount: 0,
    lastAction: 'No active session. Configure settings below and click Ignite to build credentials handshake.',
    viewportWidth: 1024,
    viewportHeight: 576,
    browserCpuUsage: 0,
    browserMemoryUsage: 0
  });
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [liveStreamFrame, setLiveStreamFrame] = useState<string | null>(null);
  const [mouseX, setMouseX] = useState<number>(512);
  const [mouseY, setMouseY] = useState<number>(288);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'browser' | 'error'>('all');

  // Input states
  const [targetUrl, setTargetUrl] = useState('https://vektalnodes.in/login');
  const [actionInterval, setActionInterval] = useState(15);
  const [enableScroll, setEnableScroll] = useState(true);
  const [enableClick, setEnableClick] = useState(true);
  const [enableNetwork, setEnableNetwork] = useState(true);
  const [engine, setEngine] = useState<'puppeteer' | 'puppeteer-real-browser'>('puppeteer-real-browser');
  const [textToType, setTextToType] = useState('');

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const livePreviewRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll terminal disabled per user request

  // Establish real-time WebSocket tunnel with auto-reconnection mechanics
  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Fallback is localhost inside dev/start server environment
      const host = window.location.host || 'localhost:3000';
      const wsUrl = `${protocol}//${host}`;

      console.log(`Connecting to WebSocket: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log('Real-time websocket telemetry tunnel active.');
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data);
          const { type, data } = res;

          switch (type) {
            case 'telemetry_sync':
            case 'telemetry':
              setTelemetry((prev) => ({ ...prev, ...data }));
              break;

            case 'logs_sync':
              setLogs(data);
              break;

            case 'log':
              setLogs((prev) => {
                const updated = [...prev, data];
                return updated.length > 50 ? updated.slice(1) : updated;
              });
              break;

            case 'screenshot':
              setLiveStreamFrame(data.image);
              if (data.mouseX !== undefined) setMouseX(data.mouseX);
              if (data.mouseY !== undefined) setMouseY(data.mouseY);
              break;

            default:
              break;
          }
        } catch (err) {
          console.error('Error parsing WS telemetry packet:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.warn('Telemetry channel socket closed. Requesting reconnection...');
        // Auto-reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.error('Websocket communication fault:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // UI Event dispatches back to Node puppet control loop
  const sendCommand = (type: string, payload?: any) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('Socket inactive. Postponing control frame dispatch.');
      return;
    }
    wsRef.current.send(JSON.stringify({ type, payload }));
  };

  const handleStartBot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl) return;

    // Validate protocol
    let formattedUrl = targetUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }

    sendCommand('START', {
      url: formattedUrl,
      config: {
        url: formattedUrl,
        actionInterval: actionInterval,
        enableAutoScroll: enableScroll,
        enableAutoClick: enableClick,
        enableNetworkMonitoring: enableNetwork,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        engine: engine
      }
    });
  };

  const handleStopBot = () => {
    sendCommand('STOP');
  };

  const handleReload = () => {
    sendCommand('RELOAD');
  };

  const handleInteractiveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (telemetry.status !== 'ACTIVE' || !livePreviewRef.current) return;

    const rect = livePreviewRef.current.getBoundingClientRect();
    // Calculate click coordinates mapped accurately to 1024x576 browser resolution
    const clickXObj = e.clientX - rect.left;
    const clickYObj = e.clientY - rect.top;
    
    // Scale Coordinates
    const targetX = Math.round((clickXObj / rect.width) * telemetry.viewportWidth);
    const targetY = Math.round((clickYObj / rect.height) * telemetry.viewportHeight);

    // Optimistically update pointer positions
    setMouseX(targetX);
    setMouseY(targetY);

    sendCommand('CLICK', { x: targetX, y: targetY });
  };

  const handleKeyboardPress = (key: string) => {
    sendCommand('KEYPRESS', { key });
  };

  const handleTypeTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textToType) return;
    sendCommand('TYPE_TEXT', { text: textToType });
    setTextToType('');
  };

  const handleScrollManual = (direction: 'up' | 'down') => {
    sendCommand('SCROLL', { direction });
  };

  const handleQuickPresetSelection = (url: string) => {
    setTargetUrl(url);
  };

  // Helper formats Uptime to standard clock format
  const formatUptimeValue = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  };

  // Filter Log output securely
  const filteredLogStream = useMemo(() => {
    return logs.filter((log) => {
      if (logFilter === 'all') return true;
      if (logFilter === 'info') return log.type === 'info' || log.type === 'warn';
      if (logFilter === 'browser') return log.type === 'browser-log';
      if (logFilter === 'error') return log.type === 'error';
      return true;
    });
  }, [logs, logFilter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Dynamic Uptime Network Indicator Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-4 py-3 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center p-2 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30">
            <Monitor className="h-5 w-5 text-cyan-400 animate-pulse" />
            <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-white flex items-center gap-2">
              AFK Dashboard Bot
              <span className="text-[10px] font-mono tracking-widest px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-400">
                V1.2
              </span>
            </h1>
            <p className="text-xs text-slate-500">Autonomous loop engine keeping web dashboards persistent</p>
          </div>
        </div>

        {/* Global Runtime Realtime Status Metrics */}
        <div className="flex flex-wrap gap-3 items-center">
          
          {/* Websocket Connection Guard */}
          <div className={`px-2.5 py-1 text-xs font-mono rounded-lg border flex items-center gap-2 ${
            isConnected 
              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40' 
              : 'bg-rose-950/40 text-rose-400 border-rose-800/40'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {isConnected ? 'TELEMETRY LIVE' : 'TUNNEL DOWN'}
          </div>

          {/* Engine Status Indicators */}
          <div className={`px-2.5 py-1 text-xs font-bold rounded-lg border flex items-center gap-2 shadow-sm ${
            telemetry.status === 'ACTIVE' 
              ? 'bg-cyan-950/50 text-cyan-400 border-cyan-500/30' 
              : telemetry.status === 'STARTING' 
              ? 'bg-amber-950/50 text-amber-400 border-amber-500/30' 
              : telemetry.status === 'ERROR'
              ? 'bg-rose-950/50 text-rose-400 border-rose-500/30'
              : 'bg-slate-900/40 text-slate-400 border-slate-800'
          }`}>
            <Workflow className={`h-3.5 w-3.5 ${telemetry.status === 'ACTIVE' ? 'animate-spin' : ''}`} />
            STATUS: {telemetry.status}
          </div>

          <div className="h-6 w-[13px] border-r border-slate-900 hidden sm:block" />

          {/* Core Performance Metric Loops */}
          <div className="hidden sm:flex items-center gap-4 text-xs font-mono text-slate-400 bg-slate-900/30 border border-slate-900 px-3 py-1 rounded-lg">
            <div className="flex items-center gap-1.5" title="Bot active session count">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              <span>UPTIME:</span>
              <span className="font-bold text-white transition-all">
                {formatUptimeValue(telemetry.uptime)}
              </span>
            </div>
            <div className="h-3 w-[1px] bg-slate-800" />
            <div className="flex items-center gap-1.5 text-slate-400" title="Actions executed">
              <Activity className="h-3.5 w-3.5 text-slate-500" />
              <span>ACTIONS:</span>
              <span className="font-bold text-white">{telemetry.actionCount}</span>
            </div>
            <div className="h-3 w-[1px] bg-slate-800" />
            <div className="flex items-center gap-1.5 text-slate-400" title="Reloads forced">
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              <span>RELOADS:</span>
              <span className="font-bold text-white">{telemetry.reloadCount}</span>
            </div>
          </div>

          {/* Download project source ZIP button */}
          <a 
            href="/api/download-zip" 
            download="afk-bot-source.zip"
            className="px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-indigo-500/30 bg-indigo-950/40 hover:bg-indigo-900/60 text-indigo-300 hover:text-white transition-all flex items-center gap-1.5 shadow-[0_0_10px_rgba(99,102,241,0.15)] active:scale-95 cursor-pointer"
            title="Download full project files as ZIP for local execution"
          >
            <Download className="h-3.5 w-3.5" />
            DOWNLOAD ZIP
          </a>
        </div>
      </header>

      {/* Main Grid Workdesk */}
      <main className="flex-1 p-4 grid grid-cols-1 xl:grid-cols-12 gap-4 max-w-[1700px] w-full mx-auto">
        
        {/* Row/Col 1: Session config, Macros & Script Builders (4 cols) */}
        <section id="config-panel" className="xl:col-span-4 flex flex-col gap-4">
          
          {/* Target Host Configurator Card */}
          <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-4 flex flex-col gap-4 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-slate-200">Target Session Configuration</h2>
              </div>
              <ShieldCheck className="h-4 w-4 text-emerald-500/80" />
            </div>

            <form onSubmit={handleStartBot} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 flex items-center justify-between">
                  <span>Dashboard URL</span>
                  <span className="text-[10px] text-slate-500">Includes secure ssl wrapper</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="e.g. news.ycombinator.com"
                    className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2.5 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 text-slate-200"
                    disabled={telemetry.status === 'STARTING'}
                    id="target-url-input"
                  />
                  <Link2 className="absolute left-2.5 top-3 h-3.5 w-3.5 text-slate-600" />
                </div>
              </div>

              {/* Vektal Nodes Custom Action Center */}
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-indigo-950/20 border border-indigo-900/35">
                <span className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  Vektal Nodes Control Desk
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetUrl('https://vektalnodes.in/login')}
                    className={`py-1.5 px-2 rounded text-[11px] font-mono font-medium transition-all border flex items-center justify-center gap-1 bg-slate-950 ${
                      targetUrl === 'https://vektalnodes.in/login'
                        ? 'text-cyan-400 border-cyan-500/50 bg-cyan-950/30'
                        : 'border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50'
                    }`}
                    disabled={telemetry.status === 'STARTING'}
                    id="vektal-control-login"
                  >
                    🔐 Login URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetUrl('https://vektalnodes.in/earn')}
                    className={`py-1.5 px-2 rounded text-[11px] font-mono font-medium transition-all border flex items-center justify-center gap-1 bg-slate-950 ${
                      targetUrl === 'https://vektalnodes.in/earn'
                        ? 'text-indigo-400 border-indigo-500/50 bg-indigo-950/30'
                        : 'border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50'
                    }`}
                    disabled={telemetry.status === 'STARTING'}
                    id="vektal-control-earn"
                  >
                    🪙 AFK Coins Page
                  </button>
                </div>
                <div className="text-[9px] text-slate-500 leading-normal">
                  Toggle target destination with 1-click. Press <span className="text-slate-400 font-semibold">Ignite</span> once selected.
                </div>
              </div>

              {/* URL Quick Selection Presets */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Quick Sandbox Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {URL_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => handleQuickPresetSelection(preset.url)}
                      className={`text-[10px] rounded px-2 py-1 text-left transition-all border ${
                        targetUrl === preset.url
                          ? 'bg-cyan-950/50 text-cyan-400 border-cyan-500/30'
                          : 'bg-slate-950/40 border-slate-900 text-slate-400 hover:text-slate-300 hover:bg-slate-900/50'
                      }`}
                      disabled={telemetry.status === 'STARTING'}
                      id={`preset-btn-${preset.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Loop Interval Parameters slider */}
              <div className="flex flex-col gap-2 bg-slate-950/40 border border-slate-900/60 p-3 rounded-lg mt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                    Action Heartbeat Interval
                  </span>
                  <span className="font-mono text-cyan-400 font-bold">{actionInterval}s</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="120"
                  step="5"
                  value={actionInterval}
                  onChange={(e) => setActionInterval(parseInt(e.target.value))}
                  className="w-full accent-cyan-400 h-1 rounded-lg cursor-pointer bg-slate-800"
                  disabled={telemetry.status === 'STARTING'}
                  id="action-interval-slider"
                />
                <span className="text-[10px] text-slate-500">How often the engine triggers an interactive random bypass action.</span>
              </div>

              {/* Automation Engine Mode Selector */}
              <div className="flex flex-col gap-2 bg-slate-950/40 border border-slate-900/60 p-3 rounded-lg mt-1">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Cpu className="h-3.5 w-3.5 text-slate-500" />
                  Bypass Automation Engine
                </span>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-md border border-slate-900">
                  <button
                    type="button"
                    onClick={() => setEngine('puppeteer')}
                    className={`text-[10px] font-medium font-mono py-1 rounded transition-all flex items-center justify-center gap-1 ${
                      engine === 'puppeteer'
                        ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800/30 font-semibold'
                        : 'text-slate-400 border border-transparent hover:text-slate-300'
                    }`}
                    disabled={telemetry.status === 'ACTIVE' || telemetry.status === 'STARTING'}
                    id="engine-select-puppeteer"
                  >
                    🚀 Puppeteer
                  </button>
                  <button
                    type="button"
                    onClick={() => setEngine('puppeteer-real-browser')}
                    className={`text-[10px] font-medium font-mono py-1 rounded transition-all flex items-center justify-center gap-1 ${
                      engine === 'puppeteer-real-browser'
                        ? 'bg-indigo-950/60 text-indigo-400 border border-indigo-800/30 font-semibold'
                        : 'text-slate-400 border border-transparent hover:text-slate-300'
                    }`}
                    disabled={telemetry.status === 'ACTIVE' || telemetry.status === 'STARTING'}
                    id="engine-select-real-browser"
                  >
                    🛡️ Stealth Mode
                  </button>
                </div>
                <div className="text-[9px] text-slate-500">
                  {engine === 'puppeteer'
                    ? 'Standard sandbox browser simulation loop.'
                    : 'Stealth automation browser (puppeteer-real-browser) designed for reliable auth bypass.'}
                </div>
              </div>

              {/* Behavior parameters options */}
              <div className="flex flex-col gap-2 mt-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Engine Loop Directives:</span>
                
                {/* Scroll Flag */}
                <label className="flex items-center justify-between p-2 rounded bg-slate-950/30 border border-slate-900/50 cursor-pointer select-none">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300 font-medium">Random Smooth Scrolling</span>
                    <span className="text-[9px] text-slate-500">Simulates human mouse scrolls page focus</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableScroll}
                    onChange={(e) => setEnableScroll(e.target.checked)}
                    className="accent-cyan-400 cursor-pointer h-4 w-4 rounded bg-slate-950 border-slate-800"
                    id="enable-scroll-cb"
                  />
                </label>

                {/* Click Flag */}
                <label className="flex items-center justify-between p-2 rounded bg-slate-950/30 border border-slate-900/50 cursor-pointer select-none">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300 font-medium">Auto element clicker</span>
                    <span className="text-[9px] text-slate-500">Hovers & clicks random non-destructive tags</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableClick}
                    onChange={(e) => setEnableClick(e.target.checked)}
                    className="accent-cyan-400 cursor-pointer h-4 w-4 rounded bg-slate-950 border-slate-800"
                    id="enable-click-cb"
                  />
                </label>

                {/* Network Filtering Shield */}
                <label className="flex items-center justify-between p-2 rounded bg-slate-950/30 border border-slate-900/50 cursor-pointer select-none">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300 font-medium">Bandwidth Guard</span>
                    <span className="text-[9px] text-slate-500">Aborts extraneous telemetry, ad servers, & blobs</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableNetwork}
                    onChange={(e) => setEnableNetwork(e.target.checked)}
                    className="accent-cyan-400 cursor-pointer h-4 w-4 rounded bg-slate-950 border-slate-800"
                    id="enable-network-cb"
                  />
                </label>
              </div>

              {/* Bot Controller Button Switchboard */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                {telemetry.status === 'ACTIVE' || telemetry.status === 'STARTING' ? (
                  <button
                    type="button"
                    onClick={handleStopBot}
                    className="col-span-2 py-2.5 rounded-lg border border-rose-950 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 transition-all font-bold text-xs flex items-center justify-center gap-2"
                    id="stop-bot-btn"
                  >
                    <Square className="h-4 w-4" /> Stop Automation Session
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="col-span-2 py-2.5 rounded-lg text-slate-950 bg-gradient-to-r from-cyan-400 to-indigo-500 hover:shadow-cyan-500/10 hover:shadow-md hover:brightness-110 active:brightness-95 transition-all font-extrabold text-xs flex items-center justify-center gap-2"
                    disabled={telemetry.status === 'STARTING'}
                    id="start-bot-btn"
                  >
                    <Play className="h-4 w-4 fill-current" /> Ignite AFK Session
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Manual Keystroke & Interactive Controller Card */}
          <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-4 flex flex-col gap-3 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-slate-200">Interactive Macro Controller</h2>
            </div>
            <p className="text-[11px] text-slate-500">
              Trigger instant browser events on the target viewport page. Target input tags manually using the viewport.
            </p>

            <div className="flex flex-col gap-3 mt-1">
              
              {/* Type string sender */}
              <form onSubmit={handleTypeTextSubmit} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Insert text to type..."
                  value={textToType}
                  onChange={(e) => setTextToType(e.target.value)}
                  className="flex-1 text-xs font-mono bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 focus:border-cyan-500 focus:outline-none text-slate-200"
                  disabled={telemetry.status !== 'ACTIVE'}
                  id="macro-text-input"
                />
                <button
                  type="submit"
                  className="bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white select-none transition-all px-3 py-1.5 rounded text-xs font-bold disabled:opacity-40"
                  disabled={telemetry.status !== 'ACTIVE' || !textToType}
                  id="macro-send-text-btn"
                >
                  Type text
                </button>
              </form>

              {/* Special interactive macros shortcuts */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Dispatched Keystrokes:</span>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { label: 'Enter ↵', key: 'Enter' },
                    { label: 'Space ␣', key: 'Space' },
                    { label: 'Backspace', key: 'Backspace' },
                    { label: 'Tab ⇥', key: 'Tab' },
                    { label: 'Arrow Up', key: 'ArrowUp' },
                    { label: 'Arrow Down', key: 'ArrowDown' },
                    { label: 'Page Down', key: 'PageDown' },
                    { label: 'Escape ⎋', key: 'Escape' }
                  ].map((btn) => (
                    <button
                      key={btn.key}
                      onClick={() => handleKeyboardPress(btn.key)}
                      className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-[10px] font-mono text-slate-300 py-1 rounded text-center transition-all disabled:opacity-45"
                      disabled={telemetry.status !== 'ACTIVE'}
                      id={`macro-key-btn-${btn.key.toLowerCase()}`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scroll Shortcuts */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Force Focus Movement:</span>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => handleScrollManual('up')}
                    className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-400 py-1 rounded.5 text-center flex items-center justify-center gap-1 transition-all disabled:opacity-45"
                    disabled={telemetry.status !== 'ACTIVE'}
                    id="scroll-up-btn"
                  >
                    Scroll Up ▲
                  </button>
                  <button
                    onClick={() => handleScrollManual('down')}
                    className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-[10px] text-slate-400 py-1 rounded.5 text-center flex items-center justify-center gap-1 transition-all disabled:opacity-45"
                    disabled={telemetry.status !== 'ACTIVE'}
                    id="scroll-down-btn"
                  >
                    Scroll Down ▼
                  </button>
                  <button
                    onClick={handleReload}
                    className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-[10px] text-cyan-400 py-1 rounded.5 text-center flex items-center justify-center gap-1 transition-all disabled:opacity-45"
                    disabled={telemetry.status !== 'ACTIVE'}
                    id="force-reload-btn"
                  >
                    Force Reload ↻
                  </button>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Row/Col 2: Interactive Browser Screen Viewport & Live Stream (5 cols) */}
        <section id="viewport-panel" className="xl:col-span-5 flex flex-col gap-4">
          
          {/* Main Visual Terminal / Browser Mockup Box */}
          <div className="bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden flex flex-col shadow-2xl backdrop-blur-sm flex-1">
            
            {/* Mock browser header frame with indicators */}
            <div className="bg-slate-950 px-4 py-2 flex items-center justify-between border-b border-slate-900">
              <div className="flex items-center gap-4">
                {/* Operating system bubble window pins */}
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80 border border-rose-600/50" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-600/50" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80 border border-emerald-600/50" />
                </div>
                <div className="text-xs text-slate-400 font-mono tracking-wide flex items-center gap-1.5">
                  <Monitor className="h-3.5 w-3.5 text-slate-500" />
                  Live Viewport
                </div>
              </div>

              {/* Status flag indicators on viewport */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono tracking-wider text-slate-500 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                  {telemetry.viewportWidth} x {telemetry.viewportHeight}
                </span>
                
                {liveStreamFrame ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Feed active" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-700" title="Feed inactive" />
                )}
              </div>
            </div>

            {/* Simulated Address Bar */}
            <div className="bg-slate-950/80 px-4 py-2 flex items-center gap-2 border-b border-slate-900">
              <button 
                onClick={handleReload}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 disabled:opacity-40 transition-colors"
                disabled={telemetry.status !== 'ACTIVE'}
                title="Reload Target page"
                id="address-reload-btn"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              
              <div className="flex-1 bg-slate-950 border border-slate-800/80 rounded px-3 py-1 flex items-center gap-2 text-xs font-mono text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span className="truncate selection:bg-slate-800">{telemetry.currentUrl}</span>
              </div>

              <div className="p-1 text-slate-500 font-mono text-[10px] hidden sm:block select-none">
                HEADLESS BROWSER ONLINE
              </div>
            </div>

            {/* Core Display canvas with screenshot/mock viewport frame */}
            <div className="relative flex-1 bg-slate-950 flex items-center justify-center p-3 select-none">
              
              {/* Overlay warning if browser fallback is active */}
              {telemetry.status === 'ACTIVE' && (
                <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1 rounded bg-slate-950/95 border border-cyan-500/30 text-cyan-400 text-[10px] font-mono shadow-md">
                  <CloudLightning className="h-3.5 w-3.5 text-cyan-400 animate-bounce" />
                  <span>PREVIEW TUNNEL ACTIVE</span>
                </div>
              )}

              {/* Viewport viewport content container */}
              <div 
                ref={livePreviewRef}
                onClick={handleInteractiveClick}
                className={`w-full max-w-full aspect-[16/9] relative bg-slate-900 border border-slate-800 rounded-lg overflow-hidden transition-all duration-300 shadow-inner ${
                  telemetry.status === 'ACTIVE' ? 'cursor-crosshair hover:border-cyan-500/40' : 'cursor-not-allowed opacity-40'
                }`}
                style={{ imageRendering: 'pixelated' }}
              >
                
                {/* 1. Live stream picture */}
                {liveStreamFrame ? (
                  <img
                    src={liveStreamFrame}
                    alt="Active browser screen viewport screenshot"
                    className="w-full h-full object-contain pointer-events-none"
                    referrerPolicy="no-referrer"
                    id="live-frame-image"
                  />
                ) : (
                  // Elegant loading dashboard screen representation
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950/90 text-center px-6">
                    <AnimatePresence mode="wait">
                      {telemetry.status === 'STARTING' ? (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex flex-col items-center gap-3"
                          key="starting-stage"
                        >
                          <div className="relative flex items-center justify-center h-12 w-12 rounded-full border-2 border-dashed border-cyan-400 animate-spin" />
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-200">Injecting Core Puppeteer Context...</span>
                            <span className="text-xs text-slate-500 tracking-wide">Navigating routing table elements</span>
                          </div>
                        </motion.div>
                      ) : telemetry.status === 'ACTIVE' ? (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex flex-col items-center gap-2"
                          key="active-blank"
                        >
                          <Activity className="h-8 w-8 text-cyan-400 animate-pulse" />
                          <span className="text-xs text-slate-400 font-mono">Initializing connection screenshot frames</span>
                        </motion.div>
                      ) : (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex flex-col items-center gap-3"
                          key="idle-state"
                        >
                          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-full text-slate-600">
                            <Monitor className="h-8 w-8" />
                          </div>
                          <div>
                            <span className="text-sm font-bold text-slate-300 block">AFK Screen Inactive</span>
                            <span className="text-xs text-slate-500 mt-0.5 block max-w-sm">
                              Launch telemetry using the start button. Live interactive rendering viewport active once start protocol is initialized.
                            </span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* 2. Virtual cursor tracker dot */}
                {telemetry.status === 'ACTIVE' && (
                  <div 
                    className="absolute h-5 w-5 pointer-events-none transition-all duration-300 bg-cyan-400/20 border border-cyan-400 rounded-full flex items-center justify-center shadow-lg transform -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${(mouseX / telemetry.viewportWidth) * 100}%`,
                      top: `${(mouseY / telemetry.viewportHeight) * 100}%`,
                    }}
                  >
                    <div className="h-1.5 w-1.5 bg-cyan-400 rounded-full" />
                    <div className="absolute inset-x-0 inset-y-0 bg-cyan-400/35 rounded-full animate-ping opacity-60" />
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Help-Bar with interactive cursor positions */}
            <div className="bg-slate-950 px-4 py-2 border-t border-slate-900/60 flex items-center justify-between text-[11px] font-mono text-slate-500 select-none">
              <div className="flex items-center gap-1">
                <MousePointer className="h-3.5 w-3.5 text-slate-600" />
                <span>Virtual Pointer:</span>
                <span className="text-slate-300 font-bold px-1 rounded bg-slate-900">
                  X: {mouseX}px, Y: {mouseY}px
                </span>
              </div>
              <span className="text-[10px] hidden sm:block text-slate-500">
                💡 Tip: Click inside the frame to execute remote events
              </span>
            </div>

          </div>

          {/* Quick Engine Diagnostics Statistics panel */}
          <div className="bg-slate-900/40 border border-slate-900 rounded-xl p-4 flex flex-col gap-3 shadow-md">
            <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
              <Layers className="h-4 w-4 text-cyan-400" />
              <span>Web Sandbox Health Diagnostics</span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-1.5">
              
              {/* CPU Usage panel */}
              <div className="bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg flex flex-col">
                <span className="text-[10px] text-slate-500 font-mono font-medium flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-cyan-400" /> CPU CORE LOAD
                </span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-lg font-mono font-extrabold text-white">{telemetry.browserCpuUsage}%</span>
                  <span className="text-[9px] text-emerald-400">Stable</span>
                </div>
                <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-cyan-400 h-full rounded-full transition-all duration-500" style={{ width: `${telemetry.browserCpuUsage}%` }} />
                </div>
              </div>

              {/* Memory Usage panel */}
              <div className="bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg flex flex-col">
                <span className="text-[10px] text-slate-500 font-mono font-medium flex items-center gap-1">
                  <Server className="h-3 w-3 text-indigo-400" /> SYSTEM ALLOCAT
                </span>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-lg font-mono font-extrabold text-white">
                    {telemetry.browserMemoryUsage || 28}MB
                  </span>
                  <span className="text-[9px] text-indigo-400">Usage</span>
                </div>
                <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-indigo-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, ((telemetry.browserMemoryUsage || 24) / 512) * 100)}%` }} />
                </div>
              </div>

              {/* Active Tab State */}
              <div className="bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg flex flex-col">
                <span className="text-[10px] text-slate-500 font-mono font-medium flex items-center gap-1">
                  <Globe className="h-3 w-3 text-cyan-400" /> VIRTUAL CONTEXT
                </span>
                <span className="text-sm font-mono mt-1 text-white truncate inline-block">
                  Chromium Local
                </span>
                <span className="text-[9px] text-slate-500 mt-1">Single sandboxed tab</span>
              </div>

              {/* Browser Status */}
              <div className="bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg flex flex-col">
                <span className="text-[10px] text-slate-500 font-mono font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3 text-cyan-400" /> STREAK TIMERS
                </span>
                <span className="text-sm font-mono mt-1 text-emerald-400 font-bold">
                  Bypassing
                </span>
                <span className="text-[9px] text-emerald-400/75 mt-1 animate-pulse">Running active</span>
              </div>

            </div>
          </div>
        </section>

        {/* Row/Col 3: Realtime Console Logs & Terminal output stream (3 cols) */}
        <section id="logs-panel" className="xl:col-span-3 flex flex-col gap-4">
          
          <div className="bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden flex flex-col shadow-xl backdrop-blur-sm flex-1 max-h-[85vh] xl:max-h-none">
            
            {/* Header section console controls */}
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-900 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-cyan-400" />
                  <h2 className="text-sm font-bold text-slate-200">
                    Terminal Telemetry <span className="text-xs text-sky-400 font-normal ml-1">({logs.length}/50)</span>
                  </h2>
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition-all"
                  title="Wipe current log buffer"
                  id="wipe-logs-btn"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Tabs selector */}
              <div className="flex gap-1 bg-slate-900 p-1 rounded-lg">
                {[
                  { value: 'all', label: 'All Log' },
                  { value: 'info', label: 'Engine' },
                  { value: 'browser', label: 'Console' },
                  { value: 'error', label: 'Error' }
                ].map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setLogFilter(tab.value as any)}
                    className={`flex-1 text-[10px] font-mono py-1 rounded transition-all select-none ${
                      logFilter === tab.value
                        ? 'bg-slate-950 text-cyan-400 font-bold border-b border-cyan-500/35'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    id={`log-filter-tab-${tab.value}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Terminal screen text stream */}
            <div className="flex-1 bg-slate-950/80 p-3 overflow-y-auto block font-mono text-[10.5px] leading-relaxed max-h-[400px] xl:max-h-[64vh] min-h-[180px]">
              <div className="flex flex-col gap-2">
                
                {filteredLogStream.length === 0 ? (
                  <div className="text-slate-600 text-center py-10 select-none">
                    No matching telemetry logs. Log events pop in real time as the browser executes commands inside the loop.
                  </div>
                ) : (
                  filteredLogStream.map((log) => {
                    // Decide log colors
                    let colorClass = 'text-slate-400';
                    let label = 'INFO';
                    if (log.type === 'warn') {
                      colorClass = 'text-amber-400';
                      label = 'WARN';
                    } else if (log.type === 'error') {
                      colorClass = 'text-rose-400';
                      label = 'FAIL';
                    } else if (log.type === 'browser-log') {
                      colorClass = 'text-emerald-400';
                      label = 'PAGE';
                    }

                    return (
                      <div key={log.id} className="border-b border-slate-900/40 pb-1.5 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
                          <span>[{log.timestamp}]</span>
                          <span className={`px-1 rounded-sm text-[8px] font-extrabold ${
                            label === 'WARN' ? 'bg-amber-500/10 text-amber-400' :
                            label === 'FAIL' ? 'bg-rose-500/10 text-rose-400' :
                            label === 'PAGE' ? 'bg-emerald-500/10 text-emerald-400' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {label}
                          </span>
                        </div>
                        <div className={`mt-0.5 whitespace-pre-wrap truncate ${colorClass}`}>
                          {log.text}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>

            {/* Running activity diagnostic line */}
            <div className="bg-slate-950 border-t border-slate-900/60 p-3 select-none">
              <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider block">Last Operation Track:</span>
              <p className="text-[11.5px] text-cyan-400 font-mono mt-1 leading-snug line-clamp-2">
                🍳 {telemetry.lastAction}
              </p>
            </div>

          </div>
        </section>

      </main>

      {/* Modern cyber styled footer bar */}
      <footer className="border-t border-slate-900 bg-slate-950 py-3 px-6 flex flex-wrap gap-4 items-center justify-between text-xs text-slate-600 select-none">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-slate-800" />
          <span>Automation Tunnel sandbox active via Cloud Infrastructure</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hover:text-slate-400 cursor-help flex items-center gap-1">
            <Workflow className="h-3 w-3" /> anti-timeout algorithm enabled
          </span>
          <span>© 10-06-2026 AFK Bot</span>
        </div>
      </footer>

    </div>
  );
}
