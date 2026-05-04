export const maxDuration = 60;

import Redis from 'ioredis';
import { calcMA, detectSignals, SignalConfig, DEFAULT_SIGNAL_CONFIG } from '../lib/signals';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });

const YF           = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CHUNK        = 5;
const POOL_SIZE    = 30;
const TOP_N        = 20;
const POOL_KEY     = 'market:pool:v1';
const TOP_KEY      = 'market:top_signals';

// ── Types ──────────────────────────────────────────────────────────

interface StockData {
  name:    string;
  closes:  number[];
  volumes: number[];
  highs:   number[];
  lows:    number[];
  price:   number;
}

interface PortfolioItem {
  symbol:    string;
  name:      string;
  lots:      number;
  costPrice: number;
}

interface SignalProfile {
  id:     string;
  name:   string;
  config: SignalConfig;
}

interface Settings {
  watchlist:       string[];
  portfolio:       PortfolioItem[];
  // 舊格式
  signalConfig?:   SignalConfig;
  // 新格式（alerts.tsx 重構後）
  signalProfiles?: SignalProfile[];
  activeProfileId?: string;
}

function resolveSignalConfig(s: Settings): SignalConfig {
  if (s.signalConfig) return s.signalConfig;
  if (s.signalProfiles?.length) {
    const active = s.signalProfiles.find(p => p.id === s.activeProfileId)
      ?? s.signalProfiles[0];
    return { ...DEFAULT_SIGNAL_CONFIG, ...active.config };
  }
  return DEFAULT_SIGNAL_CONFIG;
}

export interface TopSignalItem {
  symbol:    string;
  code:      string;
  name:      string;
  price:     number;
  score:     number;
  signals:   string[];
  updatedAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function isMarketOpen(): boolean {
  const tw   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day  = tw.getDay();
  if (day === 0 || day === 6) return false;
  const mins = tw.getHours() * 60 + tw.getMinutes();
  return mins >= 9 * 60 && mins < 13 * 60 + 30;
}

async function sendTelegram(text: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

async function fetchStockData(symbol: string): Promise<StockData | null> {
  try {
    const res = await fetch(
      `${YF}/${encodeURIComponent(symbol)}?interval=1d&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) return null;
    const json   = await res.json();
    const result = json.chart.result[0];
    const q      = result.indicators.quote[0];
    const clean  = (arr: (number | null)[]): number[] =>
      arr.filter((v): v is number => v !== null && !isNaN(v));
    return {
      name:    result.meta.shortName ?? symbol,
      price:   result.meta.regularMarketPrice ?? 0,
      closes:  clean(q.close  as (number | null)[]),
      volumes: clean(q.volume as (number | null)[]),
      highs:   clean(q.high   as (number | null)[]),
      lows:    clean(q.low    as (number | null)[]),
    };
  } catch { return null; }
}

// ── Mode: fast ─────────────────────────────────────────────────────

async function runFastScan(settings: Settings): Promise<string[]> {
  const portfolioMap = new Map<string, PortfolioItem>(
    (settings.portfolio ?? []).map(p => [p.symbol, p]),
  );
  const allSymbols = Array.from(new Set([
    ...(settings.watchlist ?? []),
    ...portfolioMap.keys(),
  ]));

  const triggered: string[] = [];

  for (const symbol of allSymbols) {
    const data = await fetchStockData(symbol);
    if (!data) continue;

    const cfg       = resolveSignalConfig(settings);
    const signals   = detectSignals(data.closes, data.volumes, data.highs, data.lows, cfg);
    const holding   = portfolioMap.get(symbol);
    const shortSym  = symbol.replace('.TW', '').replace('.TWO', '');
    const price     = data.price;
    const ma20      = calcMA(data.closes, 20);
    const aboveMA20 = price > ma20;

    const entrySignals = signals.filter(s => s.category === 'entry');
    const exitSignals  = signals.filter(s => s.category === 'exit');

    // 買進：KD 低檔黃金交叉（主）+ 帶量突破 或 RSI 超賣反彈（確認）+ MA20 上方
    const hasKDEntry      = entrySignals.some(s => s.type === 'kdGoldenCross');
    const hasConfirmEntry = entrySignals.some(s => s.type === 'volumeBreak' || s.type === 'rsiOversold');

    if (hasKDEntry && hasConfirmEntry && aboveMA20) {
      const coolKey = `direct:buy:${symbol}`;
      if (!await redis.get(coolKey)) {
        const stopLoss = (price * 0.95).toFixed(2);
        const label    = entrySignals.map(s => s.label).join(' + ');
        const detail   = entrySignals.map(s => s.detail).join('\n💡 ');
        await sendTelegram([
          `🟢 <b>【多頭進場指令】</b>`,
          `━━━━━━━━━━━━━━`,
          `🎯 <b>標的：</b> ${shortSym} ${data.name}`,
          `💰 <b>目前市價：</b> ${price.toLocaleString()} 元`,
          `📈 <b>觸發條件：</b> ${label}`,
          `💡 <b>指標細節：</b> ${detail}`,
          ``,
          `🛡️ <b>【系統紀律建議】</b>`,
          `1. <b>執行：</b> 建議於今日收盤前以「限價單」買進。`,
          `2. <b>防守：</b> 硬性停損點設為 <b>${stopLoss} 元</b> (跌破無條件離場)。`,
          `━━━━━━━━━━━━━━`,
          `🤖 StockApp 雲端策略引擎`,
        ].join('\n'));
        await redis.set(coolKey, 1, 'EX', 8 * 60 * 60);
        triggered.push(`${symbol}:buy`);
      }
    }

    // 賣出：KD 死亡交叉（主）+ RSI 超買 或 布林上軌（確認）/ 跌破 MA20
    const hasKDExit      = exitSignals.some(s => s.type === 'kdDeathCross');
    const hasConfirmExit = exitSignals.some(s => s.type === 'rsiOverbought' || s.type === 'bollingerUpper');
    const sellByKD       = hasKDExit && hasConfirmExit;
    const sellByMA       = !aboveMA20 && exitSignals.length >= 1;

    if (sellByKD || sellByMA) {
      const coolKey = `direct:sell:${symbol}`;
      if (!await redis.get(coolKey)) {
        const label  = exitSignals.length ? exitSignals.map(s => s.label).join(' + ') : `跌破 MA20`;
        const detail = exitSignals.length
          ? exitSignals.map(s => s.detail).join('\n💡 ')
          : `股價 ${price.toLocaleString()} 跌破 MA20 ${ma20.toFixed(2)}`;
        await sendTelegram([
          `🔴 <b>【空頭離場指令】</b>`,
          `━━━━━━━━━━━━━━`,
          `🎯 <b>標的：</b> ${shortSym} ${data.name}`,
          `💰 <b>目前市價：</b> ${price.toLocaleString()} 元`,
          `📉 <b>觸發條件：</b> ${label}`,
          `💡 <b>指標細節：</b> ${detail}`,
          ``,
          `🛡️ <b>【系統紀律建議】</b>`,
          `1. <b>執行：</b> 建議立即清空手上所有 ${shortSym} 的部位。`,
          `2. <b>狀態：</b> 強制獲利了結或停損，收回現金等待下次訊號。`,
          `━━━━━━━━━━━━━━`,
          `🤖 StockApp 雲端策略引擎`,
        ].join('\n'));
        await redis.set(coolKey, 1, 'EX', 8 * 60 * 60);
        triggered.push(`${symbol}:sell`);
      }
    }

    // 停損提醒（持有中才檢查，跌破成本 -5%）
    if (holding) {
      const stopLossPrice = holding.costPrice * 0.95;
      if (price < stopLossPrice) {
        const coolKey = `stoploss:${symbol}`;
        if (!await redis.get(coolKey)) {
          const loss    = (price - holding.costPrice) * holding.lots * 1000;
          const lossPct = ((price - holding.costPrice) / holding.costPrice) * 100;
          await sendTelegram([
            `🛑 <b>停損提醒</b>  ·  ${shortSym}`,
            ``,
            `<b>${data.name}</b>  現價 ${price.toLocaleString()}`,
            `已跌破成本 -5%　成本 ${holding.costPrice.toLocaleString()}`,
            `損失約 ${Math.round(loss).toLocaleString()} 元 (${lossPct.toFixed(2)}%)　持有 ${holding.lots} 張`,
          ].join('\n'));
          await redis.set(coolKey, 1, 'EX', 4 * 60 * 60);
          triggered.push(`${symbol}:stoploss`);
        }
      }
    }
  }

  return triggered;
}

// ── Mode: full ─────────────────────────────────────────────────────

interface MarketCandidate { code: string; name: string; volume: number; }

async function fetchMarketPool(): Promise<MarketCandidate[]> {
  const cached = await redis.get(POOL_KEY);
  if (cached) return JSON.parse(cached);

  const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error('TWSE STOCK_DAY_ALL fetch failed');
  const data = await res.json() as any[];

  const pool: MarketCandidate[] = data
    .filter(item => /^\d{4,6}$/.test((item.Code ?? '').trim()))
    .map(item => ({
      code:   item.Code.trim(),
      name:   item.Name.trim(),
      volume: parseInt((item.TradeVolume ?? '0').replace(/,/g, ''), 10),
    }))
    .filter(item => item.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, POOL_SIZE);

  await redis.set(POOL_KEY, JSON.stringify(pool), 'EX', 30 * 60);
  return pool;
}

// 全市場海選使用全開的進場訊號，離場訊號不影響評分
const FULL_CONFIG: SignalConfig = {
  ...DEFAULT_SIGNAL_CONFIG,
  kdGoldenCross:   { enabled: true, oversoldThreshold: 20 },
  rsiOversold:     { enabled: true, threshold: 30 },
  maGoldenCross:   { enabled: true, shortPeriod: 5, longPeriod: 20 },
  bollingerBounce: { enabled: true, stdDev: 2 },
  volumeBreak:     { enabled: true, volumeMultiplier: 1.5, breakDays: 5 },
  macdAboveZero:   { enabled: true },
  kdDeathCross:    { enabled: false, overboughtThreshold: 80 },
  rsiOverbought:   { enabled: false, threshold: 70 },
  maDeathCross:    { enabled: false, shortPeriod: 5, longPeriod: 20 },
  bollingerUpper:  { enabled: false, stdDev: 2 },
  macdBelowZero:   { enabled: false },
};

function scoreStock(data: StockData): { score: number; signalLabels: string[] } {
  const signals      = detectSignals(data.closes, data.volumes, data.highs, data.lows, FULL_CONFIG);
  const entrySignals = signals.filter(s => s.category === 'entry');

  const ma5  = calcMA(data.closes, 5);
  const ma20 = calcMA(data.closes, 20);

  if (data.price <= ma20) return { score: 0, signalLabels: [] };
  if (entrySignals.length < 2) return { score: 0, signalLabels: [] };

  const bullish = data.price > ma5 && ma5 > ma20;

  return {
    score:        entrySignals.length * 30 + (bullish ? 15 : 0),
    signalLabels: entrySignals.map(s => s.label),
  };
}

async function runFullScan(): Promise<{ poolSize: number; stored: number; top: TopSignalItem[] }> {
  const pool    = await fetchMarketPool();
  const results: TopSignalItem[] = [];

  for (let i = 0; i < pool.length; i += CHUNK) {
    const chunk   = pool.slice(i, i + CHUNK);
    const fetched = await Promise.all(
      chunk.map(async ({ code, name }) => {
        const data = await fetchStockData(`${code}.TW`);
        if (!data) return null;
        const { score, signalLabels } = scoreStock(data);
        if (score === 0) return null;
        return {
          symbol:    `${code}.TW`,
          code,
          name:      data.name || name,
          price:     data.price,
          score,
          signals:   signalLabels,
          updatedAt: Date.now(),
        };
      }),
    );
    for (const item of fetched) {
      if (item) results.push(item);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const top = results.sort((a, b) => b.score - a.score).slice(0, TOP_N);
  await redis.set(TOP_KEY, JSON.stringify(top), 'EX', 26 * 60 * 60);

  return { poolSize: pool.length, stored: top.length, top };
}

// ── Handler ────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const valid =
      req.headers['authorization'] === `Bearer ${cronSecret}` ||
      req.query?.key === cronSecret;
    if (!valid) return res.status(401).json({ error: 'unauthorized' });
  }

  const mode = (req.query?.mode as string) ?? 'fast';
  if (mode !== 'fast' && mode !== 'full') {
    return res.status(400).json({ error: 'invalid mode', valid: ['fast', 'full'] });
  }

  const force = req.query?.force === 'true';
  if (!force && !isMarketOpen()) {
    return res.json({ skipped: 'market closed', mode, ts: new Date().toISOString() });
  }

  let settings: Settings | null = null;
  try {
    const raw = await redis.get('settings');
    settings  = raw ? JSON.parse(raw) : null;
  } catch {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  if (mode === 'fast') {
    if (!settings?.watchlist?.length && !settings?.portfolio?.length) {
      return res.json({ skipped: 'no symbols configured', mode });
    }
    try {
      const triggered = await runFastScan(settings!);
      const scanned   = new Set([
        ...(settings?.watchlist ?? []),
        ...(settings?.portfolio?.map(p => p.symbol) ?? []),
      ]).size;
      return res.json({ ok: true, mode, scanned, triggered });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'fast scan failed' });
    }
  }

  try {
    const result = await runFullScan();
    return res.json({ ok: true, mode, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'full scan failed' });
  }
}
