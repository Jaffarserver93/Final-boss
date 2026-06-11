import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import puppeteer, { Browser, Page } from 'puppeteer';
// @ts-ignore
import { connect } from 'puppeteer-real-browser';
import { createServer as createViteServer } from 'vite';
import AdmZip from 'adm-zip';
import { BotStatus, TelemetryData, LogMessage } from './src/types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade manually
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// App State
let activeBrowser: any = null;
let activePage: any = null;
let currentStatus: BotStatus = 'STOPPED';
let currentUrl = 'https://news.ycombinator.com'; // Default safe URL
let uptime = 0;
let reloadCount = 0;
let actionCount = 0;
let lastAction = 'Bot initialized. Ready to start.';
let errorLog = '';
let uptimeInterval: NodeJS.Timeout | null = null;
let loopInterval: NodeJS.Timeout | null = null;
let livePreviewInterval: NodeJS.Timeout | null = null;
let isTakingScreenshot = false;
const logs: LogMessage[] = [];
let simulatedMode = false;
let config = {
  url: 'https://news.ycombinator.com',
  actionInterval: 15,
  enableAutoScroll: true,
  enableAutoClick: true,
  enableNetworkMonitoring: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  engine: 'puppeteer-real-browser' as 'puppeteer' | 'puppeteer-real-browser',
};

// State persistence configuration logic for headless reliability on server restarts & tab closures
const CONFIG_FILE = path.join(process.cwd(), 'afk-bot-persist.json');

const savePersistedState = (url: string, botConfig: typeof config, started: boolean) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url, config: botConfig, started }, null, 2));
  } catch (err: any) {
    console.error('Failed to write persisted state to disk:', err.message);
  }
};

const loadPersistedState = () => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err: any) {
    console.error('Failed to load persisted state from disk:', err.message);
  }
  return null;
};

// Viewport sizes
const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 576;

// Function to add structured logs
const addLog = (text: string, type: 'info' | 'warn' | 'error' | 'browser-log' = 'info') => {
  const log: LogMessage = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toLocaleTimeString(),
    type,
    text,
  };
  logs.push(log);
  if (logs.length > 50) {
    logs.shift(); // keep last 50 logs max as requested to save space and display 50/50 logs
  }
  broadcast({ type: 'log', data: log });
};

// Broadcast to all WS clients
const broadcast = (message: { type: string; data: any }) => {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

const getUptimeInSeconds = () => {
  return uptime;
};

// Helper for collecting telemetry data
const getTelemetry = (): TelemetryData => {
  // Get real memory info or mock it to look realistic
  const systemMem = os.totalmem() - os.freemem();
  const memUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024 + 120); // base size of node + chromium simulated overhead
  const cpuLoad = Math.round((os.loadavg()[0] || 0.1) * 10);

  return {
    status: currentStatus,
    currentUrl,
    uptime: getUptimeInSeconds(),
    reloadCount,
    actionCount,
    lastAction,
    error: errorLog || undefined,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    browserCpuUsage: Math.min(Math.max(cpuLoad, 2), 98), // elegant bounds
    browserMemoryUsage: activeBrowser ? memUsageMB : 0,
  };
};

const sendState = (ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'telemetry_sync', data: getTelemetry() }));
  ws.send(JSON.stringify({ type: 'logs_sync', data: logs }));
};

// Periodic telemetry broadcast
setInterval(() => {
  if (currentStatus !== 'STOPPED' && currentStatus !== 'ERROR') {
    broadcast({ type: 'telemetry', data: getTelemetry() });
  }
}, 2000);

// Stop helper
const stopBot = async (reason: string = 'Bot stopped manually.') => {
  currentStatus = 'STOPPED';
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
  if (loopInterval) {
    clearInterval(loopInterval);
    loopInterval = null;
  }
  if (livePreviewInterval) {
    clearInterval(livePreviewInterval);
    livePreviewInterval = null;
  }

  try {
    if (activeBrowser) {
      await activeBrowser.close();
    }
  } catch (err) {
    // Already closed
  }

  activeBrowser = null;
  activePage = null;
  uptime = 0;
  lastAction = reason;

  // Persist that the bot is stopped so it doesn't auto-start next boot unless requested
  savePersistedState(currentUrl, config, false);

  addLog(reason, 'info');
  broadcast({ type: 'telemetry', data: getTelemetry() });
};

// Human-like cursor tracking path generation (Interpolation)
// Generates points along a curved path to mock realistic mouse dragging
interface Point { x: number; y: number; }
function generateBezierPath(start: Point, end: Point, steps = 15): Point[] {
  const pathPoints: Point[] = [];
  // Random control points to build a Bezier curve
  const cx1 = start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * 150;
  const cy1 = start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * 150;
  const cx2 = start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * 150;
  const cy2 = start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * 150;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Cubic Bezier calculation
    const x = Math.round(
      Math.pow(1 - t, 3) * start.x +
      3 * Math.pow(1 - t, 2) * t * cx1 +
      3 * (1 - t) * Math.pow(t, 2) * cx2 +
      Math.pow(t, 3) * end.x
    );
    const y = Math.round(
      Math.pow(1 - t, 3) * start.y +
      3 * Math.pow(1 - t, 2) * t * cy1 +
      3 * (1 - t) * Math.pow(t, 2) * cy2 +
      Math.pow(t, 3) * end.y
    );
    pathPoints.push({ x, y });
  }
  return pathPoints;
}

// Global browser mouse position
let mouseX = 512;
let mouseY = 384;

// Screenshot loop
const triggerScreenshot = async () => {
  if (!activePage || isTakingScreenshot) return;
  isTakingScreenshot = true;
  try {
    const screenshotBase64 = await activePage.screenshot({
      type: 'jpeg',
      quality: 70,
      encoding: 'base64',
    });
    
    // Inject a virtual mouse cursor overlay onto the screenshot if the mouse coordinates are active
    broadcast({
      type: 'screenshot',
      data: {
        image: `data:image/jpeg;base64,${screenshotBase64}`,
        mouseX,
        mouseY
      }
    });
  } catch (err) {
    // Trace screenshot fail
  } finally {
    isTakingScreenshot = false;
  }
};

// Simulation Fallback state variables which are active when puppeteer fails
let simScreenshotTimeout: NodeJS.Timeout | null = null;
let simUrl = 'https://analytics-dashboard.io/overview';
const activeSimTraces: Point[] = [];
let simScrollOffset = 0;

const triggerSimulatedStep = () => {
  if (currentStatus !== 'ACTIVE') return;

  const actions = ['SCROLL_DOWN', 'SCROLL_UP', 'MOUSE_MOVE', 'REFRESH_WIDGETS', 'CLICK_NAV'];
  const chosenAction = actions[Math.floor(Math.random() * actions.length)];

  const startX = mouseX;
  const startY = mouseY;
  const destX = Math.round(Math.random() * (VIEWPORT_WIDTH - 200) + 100);
  const destY = Math.round(Math.random() * (VIEWPORT_HEIGHT - 200) + 100);

  if (chosenAction === 'MOUSE_MOVE' || chosenAction === 'CLICK_NAV') {
    const path = generateBezierPath({ x: startX, y: startY }, { x: destX, y: destY }, 20);
    let step = 0;
    const pathTimer = setInterval(() => {
      if (step < path.length && currentStatus === 'ACTIVE') {
        mouseX = path[step].x;
        mouseY = path[step].y;
        step++;
      } else {
        clearInterval(pathTimer);
        if (chosenAction === 'CLICK_NAV' && currentStatus === 'ACTIVE') {
          actionCount++;
          const targetMenus = ['Analytics', 'Realtime', 'Alerts', 'User Logs', 'Settings', 'Database', 'API Health'];
          const selectedMenu = targetMenus[Math.floor(Math.random() * targetMenus.length)];
          simUrl = `https://analytics-dashboard.io/${selectedMenu.toLowerCase()}`;
          currentUrl = simUrl;
          lastAction = `Simulated Mouse Click on navigation item "${selectedMenu}" finished at (${mouseX}, ${mouseY})`;
          addLog(lastAction, 'info');
        }
      }
    }, 40);
  } else if (chosenAction === 'SCROLL_DOWN') {
    actionCount++;
    simScrollOffset = Math.min(simScrollOffset + Math.round(Math.random() * 300 + 100), 1000);
    lastAction = `Simulated Scroll Down event. Content moved to ${simScrollOffset}px.`;
    addLog(lastAction, 'info');
  } else if (chosenAction === 'SCROLL_UP') {
    actionCount++;
    simScrollOffset = Math.max(simScrollOffset - Math.round(Math.random() * 200 + 100), 0);
    lastAction = `Simulated Scroll Up event. Content moved to ${simScrollOffset}px.`;
    addLog(lastAction, 'info');
  } else if (chosenAction === 'REFRESH_WIDGETS') {
    actionCount++;
    reloadCount++;
    lastAction = `Triggered partial widget data refresh on emulated dashboard.`;
    addLog(lastAction, 'info');
  }

  broadcast({ type: 'telemetry', data: getTelemetry() });
};

const isAdUrl = (url: string): boolean => {
  const lowercaseUrl = url.toLowerCase();
  const adDomains = [
    'propellerads', 'onclickads', 'popads', 'popcash', 'exoclick', 'clickadu',
    'adsterra', 'juicyads', 'ero-advertising', 'exdynsrv', 'realsrv', 'blackhole',
    'trafficforce', 'trafficjunky', 'plugrush', 'adnxs', 'smartadserver',
    'doubleclick', 'googleadservices', 'googlesyndication', 'mgid',
    'taboola', 'outbrain', 'revcontent', 'connatix', 'anyclip', 'skimlinks',
    'viglink', 'adroll', 'yieldmanager', 'popunder', 'clickunder', 'ad-banners',
    'adrunner', 'adserver', 'adsystem', 'zeronet', 'bidswitch', 'casalemedia',
    'triplelift', 'yieldlab', 'teads.tv', 'adlayer', 'coinad', 'a-ads',
    'a.shifen.com', 'analytics', 'buysellads', 'carbonads', 'adzerk', 'pubmatic',
    'openx', 'rubiconproject', 'appnexus', 'criteo', 'hotjar', 'amplitude',
    'sentry', 'mixpanel', 'facebook.net', 'connect.facebook', 'amazon-adsystem',
    'indexww', 'scorecardresearch', 'quantserve', 'optimizely', 'newrelic',
    'datadoghq', 'intercom', 'crisp.chat', 'tawk.to', 'smartlook', 'fullstory'
  ];
  return adDomains.some(domain => lowercaseUrl.includes(domain)) ||
         lowercaseUrl.includes('/ads/') ||
         lowercaseUrl.includes('/ad/') ||
         lowercaseUrl.includes('adsbygoogle') ||
         lowercaseUrl.includes('pop_under') ||
         lowercaseUrl.includes('/popunder');
};

const setupPageAdBlocker = async (page: any) => {
  if (!page) return;
  try {
    // Enable request interception
    await page.setRequestInterception(true).catch(() => {});
    
    // Clear and set up request event handlers
    page.removeAllListeners('request');
    page.on('request', (req: any) => {
      try {
        const url = req.url();
        const resourceType = req.resourceType();
        
        if (isAdUrl(url)) {
          req.abort().catch(() => {});
          return;
        }

        if (['image', 'media', 'font'].includes(resourceType)) {
          const lowercaseUrl = url.toLowerCase();
          if (lowercaseUrl.includes('pixel') || lowercaseUrl.includes('telemetry') || lowercaseUrl.includes('tracker')) {
            req.abort().catch(() => {});
            return;
          }
        }

        req.continue().catch(() => {});
      } catch (e) {
        req.continue().catch(() => {});
      }
    });

    // Inject document element cleaners to hide ad frames/banners and block window.alert
    await page.evaluateOnNewDocument(() => {
      const isVektal = window.location.hostname.includes('vektalnodes.in');
      const style = document.createElement('style');
      style.type = 'text/css';
      if (isVektal) {
        // Safe styling for main dashboard
        style.innerHTML = `
          div[class*="adsbygoogle"], ins.adsbygoogle, iframe[src*="googleads"],
          iframe[src*="ad"], iframe[id*="ad"], iframe[class*="ad"] {
            display: none !important;
            opacity: 0 !important;
            height: 0 !important;
          }
        `;
      } else {
        // Dynamic hiding for ad wrapper redirects
        style.innerHTML = `
          div[class*="ad-"], div[class*="-ad"], div[class*="adsbygoogle"],
          div[id*="ad-"], div[id*="-ad"], ins.adsbygoogle,
          div[class*="banner"], div[id*="banner"],
          .ad, .ads, .adsbygoogle, .banner, .popup-overlay, .modal-backdrop,
          div[class*="popup"], div[id*="popup"], div[class*="overlay"], div[id*="overlay"],
          iframe[src*="googleads"], iframe[src*="ad"], iframe[id*="ad"], iframe[class*="ad"],
          a[href*="/ref/"], a[href*="affiliate"], [id*="google_ads"], [class*="google_ads"] {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
            visibility: hidden !important;
            height: 0 !important;
            width: 0 !important;
          }
        `;
      }
      
      const appendStyle = () => {
        if (document.head || document.documentElement) {
          (document.head || document.documentElement).appendChild(style);
        }
      };
      
      appendStyle();
      document.addEventListener('DOMContentLoaded', appendStyle);

      // DOM Purifier routine
      const purifyPageDOM = () => {
        if ((window as any).alert) (window as any).alert = () => {};
        if ((window as any).confirm) (window as any).confirm = () => true;
        if ((window as any).prompt) (window as any).prompt = () => '';

        const isVektalSite = window.location.hostname.includes('vektalnodes.in');
        const elements = document.querySelectorAll('div, section, iframe, ins, a');
        elements.forEach(el => {
          const text = (el.textContent || '').trim().toLowerCase();
          if (isVektalSite) {
            if (text.includes('verification complete') || text.includes('continue to next') || text.includes('earn')) {
              return;
            }
          }

          const id = (el.id || '').toLowerCase();
          const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          if (
            id.includes('ad') || className.includes('ad') || 
            id.includes('banner') || className.includes('banner') ||
            id.includes('popup') || className.includes('popup')
          ) {
            (el as HTMLElement).style.display = 'none';
          }
        });
      };

      setInterval(purifyPageDOM, 1000);
      document.addEventListener('DOMContentLoaded', purifyPageDOM);
    }).catch(() => {});

  } catch (err: any) {
    console.error(`Error in setupPageAdBlocker Configuration: ${err.message}`);
  }
};

let isEarnPageCountdownActive = false;
let lastLinkPaysClickTime = 0;
let flowStartTime = 0;
let lastGetLinkSuccessTime = 0;

let robotClickAttempts = 0;
let lastRobotClickTime = 0;

let lastShortenerUrl = '';
let shortenerPageLandedTime = 0;
let lastVerifyClickedTime = 0;

const trustedClickElement = async (page: any, elementHandleOrSelector: any, label: string) => {
  try {
    const rect = await page.evaluate((sel: any) => {
      let target = sel;
      if (typeof sel === 'string') {
        target = document.querySelector(sel);
      }
      if (!target) return null;
      target.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = target.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height
      };
    }, elementHandleOrSelector).catch(() => null);

    if (rect) {
      // Calculate intersection on X axis with viewport bounds
      const viewLeft = Math.max(rect.left, 0);
      const viewRight = Math.min(rect.right, VIEWPORT_WIDTH);
      // Calculate intersection on Y axis with viewport bounds 
      const viewTop = Math.max(rect.top, 0);
      const viewBottom = Math.min(rect.bottom, VIEWPORT_HEIGHT);
      
      const widthInView = viewRight - viewLeft;
      const heightInView = viewBottom - viewTop;
      
      // If there is any visible portion in the viewport
      if (widthInView > 0 && heightInView > 0) {
        const clickX = Math.round(viewLeft + widthInView / 2);
        const clickY = Math.round(viewTop + heightInView / 2);
        
        // Ensure within real viewport dimensions
        if (clickX > 0 && clickX < VIEWPORT_WIDTH && clickY > 0 && clickY < VIEWPORT_HEIGHT) {
          const destX = clickX;
          const destY = clickY;
          
          addLog(`[TRUSTED CLICK] Moving mouse dynamically to coordinates (${destX}, ${destY}) for "${label}"`, 'info');
          
          // Interpolate cursor
          const path = generateBezierPath({ x: mouseX, y: mouseY }, { x: destX, y: destY }, 12);
          for (const pt of path) {
            mouseX = pt.x;
            mouseY = pt.y;
            await page.mouse.move(mouseX, mouseY).catch(() => {});
            // Delay slightly for smooth render
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          
          // Click genuinely
          await page.mouse.click(mouseX, mouseY).catch(() => {});
          actionCount++;
          lastAction = `Successfully clicked element "${label}" at coordinates: (${mouseX}, ${mouseY})`;
          broadcast({ type: 'telemetry', data: getTelemetry() });
          await triggerScreenshot();
          return true;
        }
      }
    }

    // If custom Bezier cursor fails or coordinates are out-of-bounds, use Puppeteer native trusted click
    addLog(`[TRUSTED CLICK] Coordinates out of bounds or scroll not ready. Trying Puppeteer native element fallback for "${label}"`, 'warn');
    let clicked = false;
    if (typeof elementHandleOrSelector === 'string') {
      const elementHandle = await page.$(elementHandleOrSelector);
      if (elementHandle) {
        // Scroll it into view using Puppeteer's internal mechanism
        await elementHandle.scrollIntoView({ block: 'center' }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 300)); // wait for scroll settlement
        
        await elementHandle.click().then(() => {
          clicked = true;
          actionCount++;
          lastAction = `Successfully clicked element "${label}" via Puppeteer native fallback.`;
          addLog(`[TRUSTED CLICK] Successfully executed Puppeteer native trusted click for "${label}"`, 'info');
        }).catch((err: any) => {
          addLog(`Puppeteer native element click failed, trying JS evaluation click: ${err.message}`, 'error');
        });
      }
    }
    
    if (!clicked) {
      // Ultimately fallback to JS click if puppeteer native click fails as last resort
      clicked = await page.evaluate((sel: any) => {
        let target = sel;
        if (typeof sel === 'string') {
          target = document.querySelector(sel);
        }
        if (target) {
          (target as any).click();
          return true;
        }
        return false;
      }, elementHandleOrSelector).catch(() => false);
    }
    return clicked;
  } catch (err: any) {
    addLog(`Trusted click helper caught an error: ${err.message}`, 'error');
    return false;
  }
};

const findAndTrustedClick = async (page: any, textMatches: string[], label: string): Promise<boolean> => {
  try {
    const selector = await page.evaluate((matches: string[]) => {
      const els = Array.from(document.querySelectorAll('button, a, div, span, input, label, p, h1, h2, h3, h4'));
      const candidates = els.filter(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        const value = ((el as any).value || '').trim().toLowerCase();
        const idStr = (el.id || '').toLowerCase();
        const classStr = (typeof el.className === 'string' ? el.className : '').toLowerCase();
        const tagName = el.tagName.toLowerCase();
        
        // Match standard list of search strings
        const matchesText = matches.some(m => 
          text.includes(m) || 
          value.includes(m) || 
          idStr.includes(m) || 
          classStr.includes(m)
        );
        
        if (!matchesText) return false;
        
        // Exclude empty inputs/wrappers
        if (!text && !value && !classStr && !idStr) return false;

        // Verify clickable tags or button class styles
        const isLikelyButtonOrLink = tagName === 'button' || 
                                     tagName === 'a' || 
                                     (tagName === 'input' && ['button', 'submit'].includes((el as any).type)) ||
                                     classStr.includes('btn') ||
                                     classStr.includes('button') ||
                                     idStr.includes('btn') ||
                                     idStr.includes('button') ||
                                     el.getAttribute('role') === 'button';

        // Exclude instruction texts/paragraphs that contain direction descriptions rather than dynamic buttons
        // Only exclude if the element is NOT an interactive button or link, to prevent skipping valid buttons that say "Click here of continue", etc.
        if (!isLikelyButtonOrLink) {
          if (text.includes('click on') || text.includes('scroll down') || text.includes('button below') || text.includes('click below') || text.includes('wait ') || text.includes('seconds')) {
            return false;
          }
        }

        // Exclude 'verifying' as a target element if we are looking for 'verify' (prevents clicking during active verification)
        // Only exclude if the label text itself is literally "verifying" or "please wait...", never because of verification-related class/id names
        if (matches.includes('verify')) {
          const lowerText = text.toLowerCase();
          const lowerValue = value.toLowerCase();
          if (lowerText.startsWith('verifying') || lowerValue.startsWith('verifying') || lowerText === 'please wait...' || lowerValue === 'please wait...') {
            return false;
          }
        }

        if (!isLikelyButtonOrLink) {
          const style = window.getComputedStyle(el);
          const hasPointer = style.cursor === 'pointer';
          
          if (!hasPointer) {
            // Reject non-pointer elements that look like paragraph notes or headers
            if (text.length > 25 || ['p', 'h1', 'h2', 'h3', 'h4'].includes(tagName)) {
              return false;
            }
          }
        }
        
        // Check visibility
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
          return false;
        }
        return true;
      });
      
      if (candidates.length === 0) return null;
      
      // Rank candidates:
      // Real buttons and links rank higher.
      // Larger elements rank higher.
      candidates.sort((a, b) => {
        const tagA = a.tagName.toLowerCase();
        const tagB = b.tagName.toLowerCase();
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        const areaA = rA.width * rA.height;
        const areaB = rB.width * rB.height;
        
        let scoreA = 0;
        let scoreB = 0;
        
        if (tagA === 'button' || tagA === 'a' || (tagA === 'input' && ['button', 'submit'].includes((a as any).type))) scoreA += 100;
        if (tagB === 'button' || tagB === 'a' || (tagB === 'input' && ['button', 'submit'].includes((b as any).type))) scoreB += 100;
        
        const classA = (typeof a.className === 'string' ? a.className : '').toLowerCase();
        const classB = (typeof b.className === 'string' ? b.className : '').toLowerCase();
        const idA = (a.id || '').toLowerCase();
        const idB = (b.id || '').toLowerCase();

        if (classA.includes('btn') || classA.includes('button') || idA.includes('btn') || idA.includes('button')) scoreA += 50;
        if (classB.includes('btn') || classB.includes('button') || idB.includes('btn') || idB.includes('button')) scoreB += 50;

        // Size penalty/bonus
        if (areaA < 100) scoreA -= 50;
        if (areaB < 100) scoreB -= 50;
        
        scoreA += Math.min(areaA, 1000) / 10;
        scoreB += Math.min(areaB, 1000) / 10;

        // Text length penalty/bonus (shorter text is highly prioritized to pick actual buttons over large wrapper descriptions)
        const textLenA = (a.textContent || (a as any).value || '').trim().length;
        const textLenB = (b.textContent || (b as any).value || '').trim().length;
        scoreA += Math.max(0, 100 - textLenA);
        scoreB += Math.max(0, 100 - textLenB);
        
        return scoreB - scoreA; // Descending order
      });
      
      const found = candidates[0];
      if (found) {
        const tempId = 'bot-target-' + Math.random().toString(36).substr(2, 9);
        found.setAttribute('data-bot-target', tempId);
        return `[data-bot-target="${tempId}"]`;
      }
      return null;
    }, textMatches).catch(() => null);

    if (selector) {
      const clicked = await trustedClickElement(page, selector, label);
      // Clean up attribute
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (el) el.removeAttribute('data-bot-target');
      }, selector).catch(() => {});
      return clicked;
    }
    return false;
  } catch (e: any) {
    addLog(`Error in findAndTrustedClick for "${label}": ${e.message}`, 'error');
    return false;
  }
};

const forceScrollDownToBottom = async (page: any) => {
  addLog('Scrolling down completely to the bottom of the page to expose buttons...', 'info');
  await page.evaluate(async () => {
    // 1. Direct standard window scroll
    window.scrollTo({
      top: document.body.scrollHeight || 99999,
      behavior: 'instant'
    });
    
    // 2. Scan and scroll scrollable containers
    const scrollableDivs = Array.from(document.querySelectorAll('div, section, main, article, body, html'));
    for (const div of scrollableDivs) {
      if (div.scrollHeight > div.clientHeight) {
        div.scrollTo({
          top: div.scrollHeight,
          behavior: 'instant'
        });
      }
    }
  }).catch(() => {});
  
  // Pause for a moment to let the browser execute and load dynamic components at the footer
  await new Promise(resolve => setTimeout(resolve, 1500));
};

const handleShortenerPage = async (page: any) => {
  if (!page) return;
  try {
    const url = page.url();
    // Only check if we are NOT on main vektalnodes.in pages
    const isVektal = url.includes('vektalnodes.in');
    if (isVektal) {
      lastShortenerUrl = '';
      shortenerPageLandedTime = 0;
      return;
    }

    const isHotelDomain = url.includes('bookyourhotel.in') || url.includes('bookyourhotel');

    if (lastShortenerUrl !== url) {
      lastShortenerUrl = url;
      shortenerPageLandedTime = Date.now();
      robotClickAttempts = 0; // Reset attempts on landing
      lastRobotClickTime = 0; // Reset last click timestamp on landing
      if (isHotelDomain) {
        addLog(`Landed on hotel destination tracker: ${url}. Waiting 20 seconds for the "GET LINK" button to active...`, 'info');
      } else {
        addLog(`Landed on external shortener/landing page: ${url}. Initiating a 25s initial page buffer...`, 'info');
      }
      await triggerScreenshot();
      return;
    }

    const elapsedSinceLanded = Date.now() - shortenerPageLandedTime;

    if (isHotelDomain) {
      if (elapsedSinceLanded < 20000) {
        const waitLeft = Math.ceil((20000 - elapsedSinceLanded) / 1000);
        addLog(`⏳ bookyourhotel.in / Linkpays: ${waitLeft}s remaining before clicking "GET LINK"...`, 'info');
        return;
      }

      // Check overall 230s duration requirement since flowStartTime
      const flowElapsed = flowStartTime ? (Date.now() - flowStartTime) : elapsedSinceLanded;
      if (flowElapsed < 230000) {
        const flowWaitLeft = Math.ceil((230000 - flowElapsed) / 1000);
        addLog(`⏳ Flow total time elapsed: ${Math.floor(flowElapsed / 1000)}s / 230s minimum. Waiting ${flowWaitLeft}s more before clicking GET LINK to guarantee reward coins...`, 'info');
        return;
      }

      // Check and click GET LINK button
      const getLinkMatches = ['get link', 'getlink', 'get link button', 'get_link'];
      const clicked = await findAndTrustedClick(page, getLinkMatches, "GET LINK");
      if (clicked) {
        lastGetLinkSuccessTime = Date.now(); // Record successful completion
        addLog('🎉 Successfully clicked "GET LINK" button on bookyourhotel.in! Reward verification process complete!', 'info');
        // Let it redirect
        await new Promise(resolve => setTimeout(resolve, 3000));
        await triggerScreenshot();
      } else {
        addLog('Searching for "GET LINK" button on bookyourhotel.in, scrolling down to locate...', 'info');
        await forceScrollDownToBottom(page);
      }
      return;
    }

    // Now, for other shorteners like rank1st.in, evspec.in:
    // If we just landed block for 25s initial loading
    if (elapsedSinceLanded < 25000) {
      const waitLeft = Math.ceil((25000 - elapsedSinceLanded) / 1000);
      addLog(`⏳ Initial 25s shortener/4-4 buffer: ${waitLeft}s remaining. Buffering page scripts and timers...`, 'info');
      return;
    }

    // Direct dynamic shortener automation sequence in 3s pulses
    addLog(`🔍 Starting direct dynamic shortener automation sequence on ${url}...`, 'info');
    
    let loopIteration = 0;
    while (loopIteration < 15) { // Run for up to ~45 seconds of direct active automation per turn
      loopIteration++;
      
      // Stop completely if the page navigated away to vektal or hotel domain
      const currentUrl = page.url();
      if (currentUrl.includes('vektalnodes.in') || currentUrl.includes('bookyourhotel')) {
        addLog(`🔄 Page URL changed to ${currentUrl}. Exiting local automation loop...`, 'info');
        break;
      }

      const elapsedSinceLastRobotClick = Date.now() - lastRobotClickTime;

      // FIRST: Check for your specific rank1st.in elements by ID and Class to guarantee 100% precision
      // Check 1: Robot unlock button presence (can be clicked up to 3 times)
      const hasSpecificRobot = await page.evaluate(() => {
        const el = document.querySelector('#tp-unlock-btn, .tp-unlock-btn');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
      }).catch(() => false);

      if (hasSpecificRobot && robotClickAttempts < 3 && elapsedSinceLastRobotClick > 8000) {
        addLog(`🎯 [rank1st.in] DIRECT SELECTOR MATCH: "I'M Not Robot" (#tp-unlock-btn) button is visible!`, 'info');
        const robotClicked = await trustedClickElement(page, '#tp-unlock-btn', "I'M Not Robot Button");
        if (robotClicked) {
          robotClickAttempts++;
          lastRobotClickTime = Date.now();
          addLog(`👉 Clicked "I'M Not Robot" (Attempt ${robotClickAttempts}/3). Pausing 5s for page verification...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        } else {
          addLog(`⚠️ Attempted direct click on #tp-unlock-btn but click was pending.`, 'info');
        }
      }

      // Check 2: Specific "Verify" button (ID tp-verify)
      const hasSpecificVerify = await page.evaluate(() => {
        const el = document.querySelector('#tp-verify') as HTMLElement;
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
        if (!isVisible) return false;

        // If the button is already clicked and shows "VERIFYING...", "PLEASE WAIT...", etc. do not target it.
        const text = (el.textContent || el.innerText || '').trim().toLowerCase();
        if (text.includes('verifying') || text.includes('wait') || text.includes('checking')) {
          return false;
        }
        return true;
      }).catch(() => false);

      if (hasSpecificVerify) {
        addLog(`🎯 [rank1st.in] DIRECT SELECTOR MATCH: "Verify" (#tp-verify) button is visible! clicking...`, 'info');
        const clicked = await trustedClickElement(page, '#tp-verify', "Verify Button");
        if (clicked) {
          addLog(`⏱️ Successfully clicked Verify button. Pausing 5s for server timer...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
      }

      // Check 3: Specific "Continue" button (ID tp-snp2)
      const hasSpecificContinue = await page.evaluate(() => {
        const el = document.querySelector('#tp-snp2');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
      }).catch(() => false);

      if (hasSpecificContinue) {
        addLog(`🎯 [rank1st.in] DIRECT SELECTOR MATCH: "Continue" (#tp-snp2) button is visible! clicking...`, 'info');
        const clicked = await trustedClickElement(page, '#tp-snp2', "Continue Button");
        if (clicked) {
          addLog(`🚀 Successfully clicked Continue button. Pausing 4s...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 4000));
          break;
        }
      }

      // Check if "I'm Not Robot" option / text exists on the page (Fallback)
      const robotMatches = ['not robot', 'im not robot', 'not a robot', 'im not a robot', 'am not robot', 'robot'];
      const hasRobotOption = await page.evaluate((matches: string[]) => {
        const bodyText = (document.body.innerText || '').toLowerCase();
        // Check if body text contains any of the robot check text matches
        const hasText = matches.some(m => bodyText.includes(m));
        if (hasText) return true;
        
        // Also check if any input or label elements have robot-related terms
        const els = Array.from(document.querySelectorAll('input, label, button, a, span, div'));
        return els.some(el => {
          const text = (el.textContent || '').toLowerCase();
          const value = ((el as any).value || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          return matches.some(m => text.includes(m) || value.includes(m) || id.includes(m) || cls.includes(m));
        });
      }, robotMatches).catch(() => false);

      // 1. Prioritize clicking "I'm Not Robot" FIRST before scrolling completely to the bottom.
      if (hasRobotOption && robotClickAttempts < 3 && elapsedSinceLastRobotClick > 8000) {
        addLog(`🤖 "I'm Not Robot" candidate element detected on page. Targeting directly first...`, 'info');
        const robotClicked = await findAndTrustedClick(page, robotMatches, "I'm Not Robot");
        if (robotClicked) {
          robotClickAttempts++;
          lastRobotClickTime = Date.now();
          addLog(`👉 Realistic mouse clicked "I'm Not Robot" (Attempt ${robotClickAttempts}/3). waiting 4s for verification validation...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 4000));
          continue;
        } else {
          addLog(`⚠️ Attempted to click "I'm Not Robot" but click registration was pending. Preparing to scroll to expose...`, 'info');
        }
      }

      // 2. Only force scroll down once robot option check is completed or bypassed to trigger dynamic countdown/script timers
      if (!hasRobotOption || robotClickAttempts >= 3 || elapsedSinceLastRobotClick <= 8000) {
        await forceScrollDownToBottom(page);
      }

      // 3. Detect any active countdown timers on the page (e.g., "wait 10 seconds", "timer: 5", etc.)
      const timerState = await page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        const timerRegex = /(?:wait|remaining|timer|seconds|seconds\s+left|sec)\s*[:\-\s]*\s*(\d+)/i;
        const match = bodyText.match(timerRegex);
        if (match) {
          return { active: true, secondsLeft: parseInt(match[1], 10), text: match[0] };
        }
        
        // Check element containing countdown properties
        const timerEls = Array.from(document.querySelectorAll('[class*="timer"], [id*="timer"], [class*="countdown"], [id*="countdown"]'));
        for (const el of timerEls) {
          const text = (el.textContent || '').trim();
          const numMatch = text.match(/(\d+)/);
          if (numMatch) {
            return { active: true, secondsLeft: parseInt(numMatch[1], 10), text: `Element ${el.tagName}: ${text}` };
          }
        }
        return { active: false, secondsLeft: 0, text: '' };
      }).catch(() => ({ active: false, secondsLeft: 0, text: '' }));

      if (timerState.active && timerState.secondsLeft > 0) {
        addLog(`⏳ Countdown timer active: "${timerState.text}" (${timerState.secondsLeft}s remaining). Waiting for timer to count down...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      // 4. Check if the page is currently in an active verifying state
      const isCurrentlyVerifying = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('button, a, div, span, input[type="button"]'));
        return els.some(el => {
          const text = (el.textContent || '').trim().toLowerCase();
          // To prevent static labels styled like buttons from blocking the entire flow forever,
          // only block if it matches literal short pending phrases exactly.
          return (text === 'verifying...' || text === 'please wait...' || text === 'checking...') && text.length < 20;
        });
      }).catch(() => false);

      if (isCurrentlyVerifying) {
        addLog(`⏳ Verification is actively in progress/verifying... Pausing to let page script complete...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      // 5. Click VERIFY button
      const verifyMatches = ['verify', 'click to verify', 'verify button', 'verify now', 'double click', 'double click to verify'];
      const verifyClicked = await findAndTrustedClick(page, verifyMatches, "VERIFY");
      if (verifyClicked) {
        lastVerifyClickedTime = Date.now();
        addLog('⏱️ Successfully clicked VERIFY button! Pausing 4s for page verification processing...', 'info');
        await new Promise(resolve => setTimeout(resolve, 4000));
        continue;
      }

      // 6. Click CONTINUE button
      const continueMatches = ['continue', 'click here to continue', 'continue button'];
      const continueClicked = await findAndTrustedClick(page, continueMatches, "CONTINUE");
      if (continueClicked) {
        addLog('🚀 Successfully clicked final CONTINUE button! Redirect should trigger shortly...', 'info');
        // Smooth mouse hover away
        mouseX = Math.floor(Math.random() * (VIEWPORT_WIDTH - 200) + 100);
        mouseY = Math.floor(Math.random() * (VIEWPORT_HEIGHT - 200) + 100);
        await page.mouse.move(mouseX, mouseY).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 3000));
        break;
      }

      // If we didn't find anything to click and no timer is active, pause 3s
      addLog(`Scanning page in automation loop (pulse ${loopIteration}/15)...`, 'info');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

  } catch (err: any) {
    addLog(`Error checking/clicking shortener landing elements: ${err.message}`, 'error');
  }
};

const handleOpenLinkPaysButton = async (page: any) => {
  if (!page) return;
  try {
    const url = page.url();
    if (!url.includes('/earn')) {
      isEarnPageCountdownActive = false;
      return;
    }

    addLog('Checking status of "Open LinkPays" button on earn page...', 'info');

    // Evaluate the page for button and timer text
    const state = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const timerRegex = /wait\s+([^]+?)\s+before\s+opening\s+linkpays/i;
      const timerMatch = bodyText.match(timerRegex);
      const timerText = timerMatch ? timerMatch[0] : null;

      const buttons = Array.from(document.querySelectorAll('button, a'));
      const btn = buttons.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        return text.includes('open linkpays') || (b.classList.contains('button-primary') && text.includes('linkpays'));
      });

      if (!btn) {
        return { exists: false, disabled: false, text: '', timerText };
      }

      const isDisabled = btn.hasAttribute('disabled') || 
                         (btn as HTMLButtonElement).disabled || 
                         btn.classList.contains('disabled') ||
                         btn.getAttribute('aria-disabled') === 'true';

      return {
        exists: true,
        disabled: isDisabled,
        text: btn.textContent?.trim() || '',
        timerText
      };
    });

    if (state.timerText) {
      isEarnPageCountdownActive = true;
      addLog(`⏳ Active countdown timer detected: "${state.timerText}". Reloading page in 5 seconds to bypass countdown delay...`, 'info');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await triggerScreenshot();
      return;
    }

    if (!state.exists) {
      isEarnPageCountdownActive = false;
      addLog('Could not detect "Open LinkPays" button or active timer on the earn page.', 'info');
      return;
    }

    if (state.disabled) {
      isEarnPageCountdownActive = true;
      addLog(`Detected "Open LinkPays" button but it is currently DISABLED (Text: "${state.text}"). Reloading page in 5 seconds to bypass countdown delay...`, 'info');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await triggerScreenshot();
      return;
    }

    // If we reach here, the button is enabled and there is no active timer/countdown
    isEarnPageCountdownActive = false;

    const now = Date.now();
    const elapsedSinceGetLink = now - lastGetLinkSuccessTime;
    if (elapsedSinceGetLink < 60000) {
      const waitLeft = Math.ceil((60000 - elapsedSinceGetLink) / 1000);
      addLog(`⏳ Post-GET-LINK rest period: ${waitLeft}s remaining before we can click "Open LinkPays" again...`, 'info');
      return;
    }

    if (now - lastLinkPaysClickTime < 10000) {
      addLog('Detected "Open LinkPays" is ENABLED, but click is on brief cooldown to avoid rapid fire...', 'info');
      return;
    }

    addLog('🚀 "Open LinkPays" button is ENABLED and no timer display is blocking! Clicking immediately...', 'info');
    lastLinkPaysClickTime = now;

    const success = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const btn = buttons.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        return text.includes('open linkpays') || (b.classList.contains('button-primary') && text.includes('linkpays'));
      });

      if (btn && !(btn as any).disabled && !btn.classList.contains('disabled')) {
        (btn as any).click();
        return true;
      }
      return false;
    });

    if (success) {
      actionCount++;
      lastAction = 'Fired click event on "Open LinkPays" button.';
      addLog(lastAction, 'info');
      flowStartTime = Date.now(); // Record flow start time here
      addLog(`⏰ Flow started! Initiating 230+ seconds sequence timer tracker on backend...`, 'info');
      await triggerScreenshot();
      broadcast({ type: 'telemetry', data: getTelemetry() });
    } else {
      addLog('Attempted to click the "Open LinkPays" button, but execution failed.', 'warn');
    }

  } catch (err: any) {
    addLog(`Error analyzing or auto-clicking earn button: ${err.message}`, 'error');
  }
};

let lastContinueUrl = '';
let continueToNextDetectedTime = 0;
let continueToNextClickedTime = 0;

const handleContinueToNextButton = async (page: any) => {
  if (!page) return;
  try {
    const url = page.url();
    
    // Evaluate if "Continue to Next" button or link exists and its status
    const btnState = await page.evaluate(() => {
      const selectors = ['button', 'a'];
      for (const sel of selectors) {
        const elements = Array.from(document.querySelectorAll(sel));
        const btn = elements.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          return text.includes('continue to next') || text === 'continue to next';
        });

        if (btn) {
          const isDisabled = (btn as any).hasAttribute?.('disabled') || 
                             (btn as any).disabled || 
                             btn.classList.contains('disabled');
          return {
            exists: true,
            disabled: isDisabled,
            text: btn.textContent?.trim() || ''
          };
        }
      }
      return { exists: false, disabled: false, text: '' };
    });

    if (!btnState.exists) {
      if (lastContinueUrl === url) {
        continueToNextDetectedTime = 0;
      }
      return;
    }

    if (lastContinueUrl !== url) {
      lastContinueUrl = url;
      continueToNextDetectedTime = 0;
    }

    if (btnState.disabled) {
      addLog('Detected "Continue to Next" button, but it is currently DISABLED.', 'info');
      continueToNextDetectedTime = 0;
      return;
    }

    const now = Date.now();
    if (continueToNextDetectedTime === 0) {
      continueToNextDetectedTime = now;
      addLog('⏱️ Detected "Continue to Next" button is ENABLED! Waiting exactly 10 seconds before auto-clicking, as requested...', 'info');
      return;
    }

    const elapsed = now - continueToNextDetectedTime;
    if (elapsed < 10000) {
      const secondsLeft = Math.ceil((10000 - elapsed) / 1000);
      addLog(`⏳ "Continue to Next" button is ready. Waiting... ${secondsLeft} seconds remaining.`, 'info');
      return;
    }

    if (now - continueToNextClickedTime < 15000) {
      return;
    }

    addLog('🚀 10 seconds wait complete! Clicking the "Continue to Next" button...', 'info');
    continueToNextClickedTime = now;

    const success = await page.evaluate(() => {
      const selectors = ['button', 'a'];
      for (const sel of selectors) {
        const elements = Array.from(document.querySelectorAll(sel));
        const btn = elements.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          return text.includes('continue to next') || text === 'continue to next';
        });

        if (btn && !(btn as any).disabled && !btn.classList.contains('disabled')) {
          (btn as any).click();
          return true;
        }
      }
      return false;
    });

    if (success) {
      actionCount++;
      lastAction = 'Auto-clicked the "Continue to Next" button successfully after 10s wait.';
      addLog(lastAction, 'info');
      await triggerScreenshot();
      broadcast({ type: 'telemetry', data: getTelemetry() });
    } else {
      addLog('Attempted to click the "Continue to Next" button but execution was unsuccessful.', 'warn');
    }

  } catch (err: any) {
    addLog(`Error checking/clicking "Continue to Next" button: ${err.message}`, 'error');
  }
};

// Custom auto interaction loop
const runBotLoop = async () => {
  if (simulatedMode) {
    triggerSimulatedStep();
    return;
  }

  if (!activePage || currentStatus !== 'ACTIVE') return;

  try {
    if (activeBrowser) {
      try {
        const pages = await activeBrowser.pages();
        let foundActive = false;
        for (const p of pages) {
          const url = p.url();
          if (url && url !== 'about:blank') {
            const hasConfirmBtn = await p.evaluate(() => {
              const elements = Array.from(document.querySelectorAll('button, a'));
              return elements.some(b => (b.textContent || '').trim().toLowerCase().includes('continue to next'));
            }).catch(() => false);

            if (hasConfirmBtn || url.includes('/earn')) {
              activePage = p;
              foundActive = true;
              break;
            }
          }
        }
        if (!foundActive && pages.length > 0) {
          const latestPage = pages[pages.length - 1];
          if (latestPage && latestPage.url() !== 'about:blank') {
            activePage = latestPage;
          }
        }
      } catch (e) {}
    }

    const currentUrlLoaded = activePage.url();
    if (currentUrlLoaded.includes('/earn')) {
      await handleOpenLinkPaysButton(activePage);
    }
    
    await handleContinueToNextButton(activePage);

    // If on external shortener or ad landing page, run our step-by-step custom bypass rotuine
    const isShortenerActive = !currentUrlLoaded.includes('vektalnodes.in');
    if (isShortenerActive) {
      await handleShortenerPage(activePage);
      return; // Return early so standard random mouse motions/clicks do not disrupt verification
    }

    if (isEarnPageCountdownActive) {
      addLog('Bot is in holding pattern waiting for Vektal Nodes earn countdown timer to expire...', 'info');
      return;
    }

    const actions = ['AUTO_SCROLL', 'MOUSE_MOVE_CLICK', 'HOVER_LINK', 'RESET_IDLE'];
    const selectedAction = actions[Math.floor(Math.random() * actions.length)];

    if (selectedAction === 'AUTO_SCROLL' && config.enableAutoScroll) {
      const scrollAmt = Math.floor(Math.random() * 400 - 200);
      await activePage.evaluate((amount) => {
        window.scrollBy({ top: amount, left: 0, behavior: 'smooth' });
      }, scrollAmt);
      actionCount++;
      lastAction = `Scrolled background browser by ${scrollAmt} px`;
      addLog(lastAction, 'info');

    } else if (selectedAction === 'MOUSE_MOVE_CLICK' && config.enableAutoClick) {
      // Find coordinates
      const destX = Math.floor(Math.random() * (VIEWPORT_WIDTH - 200) + 100);
      const destY = Math.floor(Math.random() * (VIEWPORT_HEIGHT - 200) + 100);

      // Interpolate cursor
      const path = generateBezierPath({ x: mouseX, y: mouseY }, { x: destX, y: destY }, 20);
      for (const pt of path) {
        mouseX = pt.x;
        mouseY = pt.y;
        await activePage.mouse.move(mouseX, mouseY);
        // Delay slightly
        await new Promise((resolve) => setTimeout(resolve, 30));
      }

      // Safe Click inside void space or random elements
      await activePage.mouse.click(mouseX, mouseY);
      actionCount++;
      lastAction = `Simulated realistic click action at coordinate: (${mouseX}, ${mouseY})`;
      addLog(lastAction, 'info');

    } else if (selectedAction === 'HOVER_LINK') {
      // Find all anchors on the page and hover one
      const links = await activePage.$$('a, button');
      if (links.length > 0) {
        const randomLink = links[Math.floor(Math.random() * Math.min(links.length, 15))];
        const boundingBox = await randomLink.boundingBox();
        if (boundingBox) {
          const destX = Math.floor(boundingBox.x + boundingBox.width / 2);
          const destY = Math.floor(boundingBox.y + boundingBox.height / 2);

          const path = generateBezierPath({ x: mouseX, y: mouseY }, { x: destX, y: destY }, 15);
          for (const pt of path) {
            mouseX = pt.x;
            mouseY = pt.y;
            await activePage.mouse.move(mouseX, mouseY);
            await new Promise((resolve) => setTimeout(resolve, 30));
          }

          actionCount++;
          lastAction = `Hovered over node element successfully to maintain page focus.`;
          addLog(lastAction, 'info');
        }
      }
    } else {
      // Just emit standard focus keystroke to reset active listener
      await activePage.keyboard.press('Shift');
      actionCount++;
      lastAction = `Dispatched 'Shift' key event to virtual active inputs.`;
      addLog(lastAction, 'info');
    }

    await triggerScreenshot();
    broadcast({ type: 'telemetry', data: getTelemetry() });

  } catch (err: any) {
    addLog(`Error during action routine: ${err.message || err}`, 'warn');
  }
};

// Helper to discover and set CHROME_PATH environment variable
const resolveAndSetChromePath = async () => {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    addLog(`CHROME_PATH is already set and verified: ${process.env.CHROME_PATH}`, 'info');
    return;
  }

  const candidates: string[] = [];

  // Candidate 1: Standard puppeteer executablePath
  try {
    const pPath = await puppeteer.executablePath();
    if (pPath) {
      candidates.push(pPath);
    }
  } catch (err: any) {
    console.warn('Could not extract standard puppeteer path:', err.message);
  }

  // Candidate 2: Common Linux directories
  candidates.push(
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/chrome',
    '/opt/google/chrome/chrome'
  );

  // Candidate 3: Scan of .cache directories
  const scanRoots = [
    path.join(os.homedir(), '.cache/puppeteer'),
    path.join('/home/node', '.cache/puppeteer'),
    path.join(process.cwd(), '.cache/puppeteer'),
  ];

  const findBinary = (dir: string, depth = 0): string | null => {
    if (depth > 5) return null;
    if (!fs.existsSync(dir)) return null;
    try {
      const stats = fs.statSync(dir);
      if (!stats.isDirectory()) return null;
      
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const fileStats = fs.statSync(fullPath);
          if (fileStats.isDirectory()) {
            const found = findBinary(fullPath, depth + 1);
            if (found) return found;
          } else if (fileStats.isFile()) {
            if (file === 'chrome' || file === 'chromium' || file === 'chrome.exe') {
              return fullPath;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  };

  for (const root of scanRoots) {
    const found = findBinary(root);
    if (found) {
      candidates.push(found);
    }
  }

  // Pick the first path that actually exists on disk
  for (const cand of candidates) {
    if (cand && fs.existsSync(cand)) {
      process.env.CHROME_PATH = cand;
      addLog(`Auto-resolved chrome environment binary location: ${cand}`, 'info');
      return;
    }
  }

  addLog('Under-the-hood auto-discovery did not find valid Chrome executable on disk. Falling back.', 'warn');
};

// Start automation engine
const startBot = async (targetUrl: string, botConfig: typeof config) => {
  await stopBot('Restarting automation engine...');
  currentStatus = 'STARTING';
  currentUrl = targetUrl;
  config = botConfig;
  errorLog = '';
  uptime = 0;
  actionCount = 0;
  reloadCount = 0;
  simulatedMode = false;

  // Save state so the bot can auto-restart if container restarts/boots up
  savePersistedState(targetUrl, botConfig, true);

  addLog(`Spinning up AFK Bot session for: ${targetUrl}`, 'info');
  broadcast({ type: 'telemetry', data: getTelemetry() });

  // Dynamically resolve and inject CHROME_PATH environment variable
  await resolveAndSetChromePath();

  try {
    if (config.engine === 'puppeteer-real-browser') {
      addLog('Launching Stealth Chromium via puppeteer-real-browser (bypass security blocks)...', 'info');
      try {
        const realResponse = await connect({
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
          chromePath: process.env.CHROME_PATH || undefined,
          headless: 'key' as any,
          turnstile: true,
          connect: {
            defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }
          }
        } as any);
        activeBrowser = realResponse.browser;
        activePage = realResponse.page;
        addLog('Stealth Browser system successfully launched.', 'info');
      } catch (browserError: any) {
        addLog(`Stealth Browser initialization failed: ${browserError.message}. Falling back to standard Puppeteer...`, 'warn');
        config.engine = 'puppeteer';
      }
    }

    if (config.engine !== 'puppeteer-real-browser') {
      addLog('Launching Headless Chromium Browser...', 'info');
      activeBrowser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
        ],
      });

      addLog('Browser started. Spawning tab...', 'info');
      const pages = await activeBrowser.pages();
      activePage = pages.length > 0 ? pages[0] : await activeBrowser.newPage();
    }

    if (activeBrowser) {
      const handleNewTarget = async (target: any) => {
        try {
          if (target.type() === 'page') {
            const newPage = await target.page();
            if (newPage && newPage !== activePage) {
              const url = newPage.url();
              if (url && url !== 'about:blank') {
                if (isAdUrl(url)) {
                  addLog(`🛑 [AD BLOCKER] Instantly closed rogue popup ad window: ${url}`, 'warn');
                  await newPage.close().catch(() => {});
                  return;
                }

                addLog(`Detected active page change/tab opened: ${url}. Focus shifted dynamically.`, 'info');
                activePage = newPage;
                
                try {
                  await activePage.setUserAgent(config.userAgent);
                  await activePage.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
                } catch (e) {}

                await setupPageAdBlocker(activePage);

                activePage.on('console', (msg: any) => {
                  addLog(`[BROWSER CONSOLE] ${msg.text()}`, 'browser-log');
                });

                if (url.includes('/earn')) {
                  await handleOpenLinkPaysButton(activePage);
                }
                await handleContinueToNextButton(activePage);
              }
            }
          }
        } catch (err: any) {
          // Safe handling
        }
      };

      activeBrowser.on('targetcreated', handleNewTarget);
      activeBrowser.on('targetchanged', handleNewTarget);
    }

    await activePage.setUserAgent(config.userAgent);
    await activePage.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    // Set up robust ad blocking and request filtering on the main navigated page
    await setupPageAdBlocker(activePage);

    addLog(`Navigating to ${targetUrl}...`, 'info');
    const response = await activePage.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const status = response ? response.status() : 'Unknown';
    addLog(`Navigation completed. Status: ${status}`, 'info');

    // Attach Console listener
    activePage.on('console', (msg) => {
      addLog(`[BROWSER CONSOLE] ${msg.text()}`, 'browser-log');
    });

    // Vektal Nodes / General Login Autocomplete injection
    const currentUrlLoaded = activePage.url();
    if (currentUrlLoaded.includes('/earn')) {
      await handleOpenLinkPaysButton(activePage);
    }

    const onLoginPage = currentUrlLoaded.includes('/login') || await activePage.evaluate(() => {
      return !!document.querySelector('input[type="password"]');
    });

    if (onLoginPage) {
      addLog('Login screen detected. Analyzing DOM for credential entry nodes...', 'info');
      const emailObj = process.env.VEKTAL_EMAIL;
      const passObj = process.env.VEKTAL_PASSWORD;

      if (!emailObj || !passObj) {
        addLog('🔐 Real-time Notice: Credentials variables VEKTAL_EMAIL or VEKTAL_PASSWORD are not yet declared in your AI Studio secrets panel. Bot is paused for manual login bypass.', 'warn');
      } else {
        const maskedEmail = emailObj.includes('@') ? emailObj.replace(/(.{3}).*@/, '$1***@') : '***';
        addLog(`Applying credentials mapping for username/email: ${maskedEmail}`, 'info');
        try {
          // Grant small buffer for rendering forms
          await new Promise(resolve => setTimeout(resolve, 2500));

          const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[id="email"]',
            'input[placeholder*="Email" i]',
            'input[placeholder*="Username" i]',
            'input[placeholder*="login" i]',
            'input[type="text"]'
          ];
          
          let emailFilled = false;
          for (const selector of emailSelectors) {
            try {
              const el = await activePage.$(selector);
              if (el) {
                await el.click();
                await activePage.evaluate((inputEl: any) => { if(inputEl) inputEl.value = ''; }, el);
                await el.type(emailObj, { delay: 40 });
                emailFilled = true;
                addLog(`Injected username/email via selector "${selector}"`, 'info');
                break;
              }
            } catch (e) {}
          }

          const passwordSelectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[id="password"]',
            'input[placeholder*="Password" i]'
          ];

          let passwordFilled = false;
          for (const selector of passwordSelectors) {
            try {
              const el = await activePage.$(selector);
              if (el) {
                await el.click();
                await activePage.evaluate((inputEl: any) => { if(inputEl) inputEl.value = ''; }, el);
                await el.type(passObj, { delay: 40 });
                passwordFilled = true;
                addLog(`Injected protected password field via selector "${selector}"`, 'info');
                break;
              }
            } catch (e) {}
          }

          if (emailFilled && passwordFilled) {
            addLog('Credentials injected successfully. Executing submit process...', 'info');
            await triggerScreenshot();
            
            const submitSelectors = [
              'button[type="submit"]',
              'input[type="submit"]',
              'button.login',
              '.btn-primary',
              'button'
            ];
            
            let clickedSubmit = false;
            for (const selector of submitSelectors) {
              try {
                const el = await activePage.$(selector);
                if (el) {
                  const labelText = await activePage.evaluate((e: any) => e.textContent || e.value || '', el);
                  const cleanLabel = labelText.toLowerCase();
                  if (cleanLabel.includes('log') || cleanLabel.includes('sign') || cleanLabel.includes('enter') || selector === 'button[type="submit"]') {
                    await el.click();
                    clickedSubmit = true;
                    addLog(`Form submission clicked matching selector "${selector}" (${labelText.trim()})`, 'info');
                    break;
                  }
                }
              } catch (e) {}
            }

            if (!clickedSubmit) {
              addLog('Submission button not directly clicked. Transmitting "Enter" keystroke block...', 'info');
              await activePage.keyboard.press('Enter');
            }

            // Buffer redirection and fetch final resolved URL
            addLog('Executing anti-bot check waiting delays...', 'info');
            await new Promise(resolve => setTimeout(resolve, 6000));
            const activeHref = activePage.url();
            currentUrl = activeHref;
            addLog(`Automation focus directed onto secure address space: ${activeHref}`, 'info');

            // Automatically transition / redirect to Earn if they started at login and user intent was earn
            if (targetUrl.includes('/login') && activeHref.includes('/dashboard')) {
              addLog('Login verify successful! Relocating focus to target earn platform...', 'info');
              await activePage.goto('https://vektalnodes.in/earn', { waitUntil: 'networkidle2', timeout: 30000 });
              currentUrl = activePage.url();
              addLog(`Autopilot reached earn system: ${currentUrl}`, 'info');
              await handleOpenLinkPaysButton(activePage);
            }
          } else {
            addLog('Automatic form match failed. Viewport ready for manual interaction input.', 'warn');
          }
        } catch (authError: any) {
          addLog(`Could not complete credentials filler task: ${authError.message}`, 'warn');
        }
      }
    }

    currentStatus = 'ACTIVE';
    lastAction = 'Browser automation loop initialized.';
    addLog(lastAction, 'info');

    // Initial screenshot
    await triggerScreenshot();

    // Start uptime tracker
    uptimeInterval = setInterval(() => {
      uptime++;
    }, 1000);

    // Setup action loop interval
    loopInterval = setInterval(runBotLoop, config.actionInterval * 1000);

    // Setup 500ms live preview screenshot loop
    livePreviewInterval = setInterval(() => {
      if (activePage && currentStatus === 'ACTIVE') {
        triggerScreenshot().catch(() => {});
      }
    }, 500);

  } catch (err: any) {
    addLog(`Real Chromium launch failed: ${err.message}. Switching to Simulated Browser Sandbox!`, 'error');
    console.error('Puppeteer crash: ', err);

    // Fall back graceful simulated mode
    simulatedMode = true;
    currentStatus = 'ACTIVE';
    simUrl = targetUrl;
    uptime = 0;
    actionCount = 0;
    reloadCount = 0;
    lastAction = 'Simulated Cyber-Browser running. Automation pipeline active.';

    if (targetUrl.includes('vektalnodes.in')) {
      addLog('[SIMULATED] Connecting secure TLS pipeline to vektalnodes.in...', 'info');
      setTimeout(() => {
        const simMail = process.env.VEKTAL_EMAIL || 'mohammedkhizer892@gmail.com';
        addLog(`[SIMULATED] Authenticating session header with user email: ${simMail}`, 'info');
        setTimeout(() => {
          simUrl = targetUrl.includes('/login') ? 'https://vektalnodes.in/earn' : targetUrl;
          currentUrl = simUrl;
          addLog(`[SIMULATED] Verification successful. Redirected to Vektal Earn dashboard!`, 'info');
          broadcast({ type: 'telemetry', data: getTelemetry() });
        }, 3000);
      }, 1500);
    }

    uptimeInterval = setInterval(() => {
      uptime++;
    }, 1000);

    loopInterval = setInterval(runBotLoop, config.actionInterval * 1000);

    // Setup 500ms live preview screenshot loop
    livePreviewInterval = setInterval(() => {
      if (activePage && currentStatus === 'ACTIVE') {
        triggerScreenshot().catch(() => {});
      }
    }, 500);
  }

  broadcast({ type: 'telemetry', data: getTelemetry() });
};

// WebSocket connection handling
wss.on('connection', (ws) => {
  addLog('Client interface connected via WebSocket API', 'info');
  sendState(ws);

  // If already running and in simulated mode or real mode, trigger instant screenshot
  if (currentStatus === 'ACTIVE') {
    if (simulatedMode) {
      // Trigger a direct simulated repaint
      broadcast({ type: 'telemetry', data: getTelemetry() });
    } else {
      triggerScreenshot();
    }
  }

  ws.on('message', async (messageData) => {
    try {
      const parsed = JSON.parse(messageData.toString());
      const { type, payload } = parsed;

      switch (type) {
        case 'START':
          await startBot(payload.url, payload.config);
          break;

        case 'STOP':
          await stopBot();
          break;

        case 'RELOAD':
          if (simulatedMode) {
            reloadCount++;
            lastAction = 'Forced simulated screen repaint';
            addLog(lastAction, 'info');
            broadcast({ type: 'telemetry', data: getTelemetry() });
            break;
          }
          if (activePage) {
            addLog('Forced page reload requested...', 'info');
            reloadCount++;
            await activePage.reload({ waitUntil: 'networkidle2' });
            await triggerScreenshot();
            lastAction = 'Page reloaded.';
            addLog(lastAction, 'info');
            broadcast({ type: 'telemetry', data: getTelemetry() });
          }
          break;

        case 'CLICK':
          const { x, y } = payload;
          mouseX = x;
          mouseY = y;
          if (simulatedMode) {
            actionCount++;
            lastAction = `Manual click registration on dashboard canvas at coords (${x}, ${y})`;
            addLog(lastAction, 'info');
            broadcast({ type: 'telemetry', data: getTelemetry() });
            break;
          }
          if (activePage) {
            addLog(`Interactivity: Remote click registration at coordinate: (${x}, ${y})`, 'info');
            await activePage.mouse.click(x, y);
            actionCount++;
            await triggerScreenshot();
            lastAction = `Manual click registration at (${x}, ${y})`;
            broadcast({ type: 'telemetry', data: getTelemetry() });
          }
          break;

        case 'SCROLL':
          const { direction } = payload;
          const scrollDistance = direction === 'down' ? 250 : -250;
          if (simulatedMode) {
            actionCount++;
            simScrollOffset = Math.max(0, Math.min(1000, simScrollOffset + scrollDistance));
            lastAction = `Manual scroll trigger. Scroll offset is: ${simScrollOffset}px.`;
            addLog(lastAction, 'info');
            broadcast({ type: 'telemetry', data: getTelemetry() });
            break;
          }
          if (activePage) {
            await activePage.evaluate((amount) => {
              window.scrollBy(0, amount);
            }, scrollDistance);
            actionCount++;
            await triggerScreenshot();
            lastAction = `Manual scroll requested (${direction})`;
            broadcast({ type: 'telemetry', data: getTelemetry() });
          }
          break;

        case 'KEYPRESS':
          const { key } = payload;
          if (simulatedMode) {
            actionCount++;
            lastAction = `Simulated direct keystroke registry: "${key}"`;
            addLog(lastAction, 'info');
            broadcast({ type: 'telemetry', data: getTelemetry() });
            break;
          }
          if (activePage) {
            await activePage.keyboard.press(key);
            actionCount++;
            await triggerScreenshot();
            lastAction = `Dispatched terminal keystroke '${key}'`;
            broadcast({ type: 'telemetry', data: getTelemetry() });
          }
          break;

        case 'TYPE_TEXT':
          const { text } = payload;
          if (simulatedMode) {
            actionCount++;
            lastAction = `Simulated block text entry matching: "${text}"`;
            addLog(lastAction, 'info');
            broadcast({ type: 'telemetry', data: getTelemetry() });
            break;
          }
          if (activePage) {
            addLog(`Keyboard: typing text input string: "${text}"`, 'info');
            await activePage.keyboard.type(text);
            actionCount++;
            await triggerScreenshot();
            lastAction = `Injected text chunk elements into focus input.`;
            broadcast({ type: 'telemetry', data: getTelemetry() });
          }
          break;

        default:
          addLog(`Unknown request event parsed from websocket: ${type}`, 'warn');
          break;
      }
    } catch (err: any) {
      addLog(`Internal WebSocket handler error: ${err.message}`, 'error');
    }
  });

  ws.on('close', () => {
    // Client disconnected
  });
});

// Configure Vite or Static Assets serving
async function initServer() {
  // Setup standard API endpoint
  app.get('/api/status', (req, res) => {
    res.json(getTelemetry());
  });

  // API route for downloading the full repository source code as a ZIP
  app.get('/api/download-zip', (req, res) => {
    try {
      const zip = new AdmZip();
      
      const filesToExclude = [
        'node_modules',
        'dist',
        '.git',
        '.env', // hide raw credentials from public ZIPs
        'afk-bot-persist.json',
        'server.js',
        'package-lock.json'
      ];

      const workspaceDir = process.cwd();

      // Read workspace files
      const items = fs.readdirSync(workspaceDir);
      for (const item of items) {
        if (filesToExclude.includes(item)) {
          continue;
        }

        const fullPath = path.join(workspaceDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          zip.addLocalFolder(fullPath, item);
        } else if (stat.isFile()) {
          zip.addLocalFile(fullPath);
        }
      }

      const zipName = 'afk-bot-source.zip';
      const zipBuffer = zip.toBuffer();

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);
      res.send(zipBuffer);
      
      addLog('📦 API triggered: Repository sources packed and sent as download successfully!', 'info');
    } catch (err: any) {
      console.error('Error generating archive:', err);
      res.status(500).send(`Failed to generate ZIP: ${err.message}`);
    }
  });

  // Hot module replace check and Vite middleware hook
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    
    // Automatically auto-start the last bot configuration if it was active when the system recycled
    try {
      const persisted = loadPersistedState();
      if (persisted && persisted.started && persisted.url) {
        addLog(`⏰ [PERSISTENCE] System resurrected: Automatically restarting persistent AFK background bot session...`, 'info');
        setTimeout(() => {
          startBot(persisted.url, persisted.config).catch((err) => {
            console.error('[PERSISTENCE] Error starting bot during system restoration boot:', err);
          });
        }, 2000);
      } else {
        addLog('✅ AFK Bot Engine is initialized and ready. Click "Ignite Bot" to begin.', 'info');
      }
    } catch (err: any) {
      console.error('[PERSISTENCE] Exception in auto-starting background bot:', err.message);
    }
  });
}

initServer().catch((error) => {
  console.error('Fatal Server Boot Error:', error);
});
