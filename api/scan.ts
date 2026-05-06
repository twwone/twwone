export const maxDuration = 90;

import Redis from 'ioredis';
import { calcMA, calcMACD, detectSignals, SignalConfig, DEFAULT_SIGNAL_CONFIG } from '../lib/signals';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });

const YF         = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CHUNK      = 5;
const POOL_SIZE  = 100;
const TOP_N      = 20;
const POOL_KEY   = 'market:pool:v1';
const TOP_KEY    = 'market:top_signals';
const US_TOP_KEY = 'market:top_signals:us';
const RADAR_KEY  = 'market:radar_picks';

const US_POOL = [
  'NVDA', 'AAPL', 'TSLA', 'AMD',  'AMZN', 'META', 'MSFT', 'GOOGL', 'PLTR', 'INTC',
  'BAC',  'C',    'WFC',  'JPM',  'GS',   'MS',   'SOFI', 'HOOD',
  'F',    'AAL',  'DAL',  'UAL',  'RIVN', 'NIO',  'LCID', 'UBER',  'LYFT',
  'COIN', 'MARA', 'RIOT',
  'SNAP', 'NFLX', 'DIS',  'PARA',
  'MU',   'QCOM', 'AVGO', 'TSM',  'ON',   'MRVL',
  'ORCL', 'CRM',  'ADBE', 'PYPL', 'SQ',   'SHOP',
  'XOM',  'CVX',
  'GME',  'AMC',
];

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
  signalConfig?:   SignalConfig;
  signalProfiles?: SignalProfile[];
  activeProfileId?: string;
}

function resolveSignalConfig(s: Settings): SignalConfig {
  if (s.signalConfig) return { ...DEFAULT_SIGNAL_CONFIG, ...s.signalConfig };
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

function isUSMarketOpen(): boolean {
  const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
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

async function getTWIndexStatus(): Promise<{ aboveMA20: boolean; price: number; ma20: number }> {
  try {
    const res = await fetch(
      `${YF}/%5ETWII?interval=1d&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) return { aboveMA20: true, price: 0, ma20: 0 };
    const json   = await res.json();
    const result = json.chart.result[0];
    const q      = result.indicators.quote[0];
    const closes = (q.close as (number | null)[]).filter((v): v is number => v !== null && !isNaN(v));
    const price  = result.meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0;
    const ma20   = calcMA(closes, 20);
    return { aboveMA20: price > ma20, price, ma20 };
  } catch {
    return { aboveMA20: true, price: 0, ma20: 0 };
  }
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

async function runFastScan(settings: Settings, twAboveMA20 = true): Promise<string[]> {
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

    // 買進：KD 低檔黃金交叉（主）+ RSI 超賣反彈（確認）+ MA20 上方
    const hasKDEntry      = entrySignals.some(s => s.type === 'kdGoldenCross');
    const hasConfirmEntry = entrySignals.some(s => s.type === 'rsiOversold');

    if (twAboveMA20 && hasKDEntry && hasConfirmEntry && aboveMA20) {
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

    // 止盈提醒（持有中才檢查，漲幅達 +10%）
    if (holding) {
      const takeProfitPrice = holding.costPrice * 1.10;
      if (price >= takeProfitPrice) {
        const coolKey = `takeprofit:${symbol}`;
        if (!await redis.get(coolKey)) {
          const gain    = (price - holding.costPrice) * holding.lots * 1000;
          const gainPct = ((price - holding.costPrice) / holding.costPrice) * 100;
          await sendTelegram([
            `🎯 <b>止盈提醒</b>  ·  ${shortSym}`,
            ``,
            `<b>${data.name}</b>  現價 ${price.toLocaleString()}`,
            `已達成本 +10%　成本 ${holding.costPrice.toLocaleString()}`,
            `獲利約 ${Math.round(gain).toLocaleString()} 元 (+${gainPct.toFixed(2)}%)　持有 ${holding.lots} 張`,
            ``,
            `💡 建議考慮減碼或設移動停利保護獲利`,
          ].join('\n'));
          await redis.set(coolKey, 1, 'EX', 4 * 60 * 60);
          triggered.push(`${symbol}:takeprofit`);
        }
      }
    }
  }

  // 雷達追蹤：監控 full scan 推薦標的的出場訊號
  const radarRaw   = await redis.get(RADAR_KEY);
  const radarPicks = radarRaw ? JSON.parse(radarRaw) as string[] : [];
  const allSet     = new Set(allSymbols);
  const radarOnly  = radarPicks.filter(s => !allSet.has(s));

  for (const symbol of radarOnly) {
    const data = await fetchStockData(symbol);
    if (!data) continue;
    const cfg      = resolveSignalConfig(settings);
    const signals  = detectSignals(data.closes, data.volumes, data.highs, data.lows, cfg);
    const exit     = signals.filter(s => s.category === 'exit');
    const price    = data.price;
    const ma20     = calcMA(data.closes, 20);
    const shortSym = symbol.replace('.TW', '').replace('.TWO', '');

    if (exit.length > 0 || price < ma20) {
      const coolKey = `radar:exit:${symbol}`;
      if (!await redis.get(coolKey)) {
        const reason = price < ma20
          ? `跌破 MA20 ${ma20.toFixed(2)}`
          : exit.map(s => s.label).join(' + ');
        await sendTelegram([
          `📡 <b>雷達追蹤警示</b>  ·  ${shortSym}`,
          ``,
          `<b>${data.name}</b>  現價 ${price.toLocaleString()}`,
          `⚠️ 強勢條件出現變化：${reason}`,
          `建議重新評估是否進場或繼續持有`,
        ].join('\n'));
        await redis.set(coolKey, 1, 'EX', 8 * 60 * 60);
        triggered.push(`${symbol}:radar-exit`);
      }
    }
  }

  return triggered;
}

// ── Mode: full ─────────────────────────────────────────────────────

// ── 強勢雷達計分函數 ────────────────────────────────────────────────
// 策略：小本金・只做多頭趨勢・尋找量縮回踩 MA10 的精準買點
// 架構：漏斗型 — 先硬性濾網（門票）→ 再計加分項目
//
// 分數參考：
//   100 = 只觸發核心條件
//   120 = 核心 + MA 黃金交叉
//   110 = 核心 + MACD 上穿
//   130 = 三條件全中（最強訊號）

// 5日均量底限（2000張；Yahoo Finance 單位為股，1張 = 1000股）
const RADAR_MIN_AVG_VOL = 2_000_000;
// 量縮回踩 MA10 最大偏差容忍度（1.5%）
const RADAR_MA10_TOL    = 0.015;

function calculateRadarScore(data: StockData): { score: number; signalLabels: string[] } {
  const { closes, volumes } = data;

  // 資料長度不足（MACD 需要 26+9 = 35 根以上才穩定）
  if (closes.length < 35 || volumes.length < 6) return { score: 0, signalLabels: [] };

  const price = data.price;
  const ma5   = calcMA(closes, 5);
  const ma10  = calcMA(closes, 10);
  const ma20  = calcMA(closes, 20);

  // ── 硬性濾網 ①：完整多頭排列（三層確認，缺一不可）────────────────
  // 比舊版「Price > MA20」更嚴格：均線本身也必須向上發散
  if (!(price > ma20 && ma5 > ma10 && ma10 > ma20)) return { score: 0, signalLabels: [] };

  // ── 硬性濾網 ②：流動性底限（5日均量 >= 2000張）────────────────────
  // 取前 5 根（不含今日）以避免今日量縮誤殺流動性評估
  const avgVol5 = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
  if (avgVol5 < RADAR_MIN_AVG_VOL) return { score: 0, signalLabels: [] };

  // ── 加分計算 ─────────────────────────────────────────────────────────
  let score = 0;
  const signalLabels: string[] = [];

  // 【+100 核心狙擊條件】量縮回踩 MA10
  // 兩個子條件同時成立才算：
  //   1. 股價與 MA10 偏差絕對值 <= 1.5%（已在多頭排列近均線）
  //   2. 今日成交量 < 5日均量（量縮代表空方無力，非強制出貨）
  const todayVol  = volumes[volumes.length - 1];
  const nearMA10  = ma10 > 0 && Math.abs(price - ma10) / ma10 <= RADAR_MA10_TOL;
  const volShrink = todayVol < avgVol5;
  if (nearMA10 && volShrink) {
    score += 100;
    signalLabels.push('量縮回踩MA10');
  }

  // 【+20 輔助動能確認】MA5 剛上穿 MA20 黃金交叉
  // 必須是「今日才發生的交叉」，排除早已成立的多頭走勢
  if (closes.length > 21) {
    const prev    = closes.slice(0, -1);
    const prevMa5 = calcMA(prev, 5);
    const prevMa20 = calcMA(prev, 20);
    if (prevMa5 <= prevMa20 && ma5 > ma20) {
      score += 20;
      signalLabels.push('MA黃金交叉');
    }
  }

  // 【+10 輔助動能確認】MACD 零軸以上，柱狀體由負翻正
  // 代表短線動能從遲緩轉為加速，且位於零軸上方確認多頭格局
  const { histogram, macd: macdLine } = calcMACD(closes);
  if (histogram.length >= 2) {
    const hPrev = histogram[histogram.length - 2];
    const hCurr = histogram[histogram.length - 1];
    const mCurr = macdLine[macdLine.length - 1];
    if (hPrev <= 0 && hCurr > 0 && mCurr > 0) {
      score += 10;
      signalLabels.push('MACD零軸上交叉');
    }
  }

  // 沒有任何加分項目觸發 → 通過濾網但無精準買點，不列入推薦
  if (score === 0) return { score: 0, signalLabels: [] };
  return { score, signalLabels };
}

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

async function runFullScan(): Promise<{ poolSize: number; stored: number; top: TopSignalItem[]; filtered?: boolean }> {
  const idxStatus = await getTWIndexStatus();
  if (!idxStatus.aboveMA20) {
    const notifKey = 'filter:tw:index:below:ma20';
    if (!await redis.get(notifKey)) {
      await sendTelegram([
        `⚠️ <b>大盤濾網啟動</b>`,
        ``,
        `加權指數 ${idxStatus.price.toFixed(0)} 低於月線 ${idxStatus.ma20.toFixed(0)}`,
        `今日暫停多頭進場海選，保護本金安全`,
        `出場與停損訊號仍持續監控中`,
        `━━━━━━━━━━━━━━`,
        `🤖 StockApp 雲端策略引擎`,
      ].join('\n'));
      await redis.set(notifKey, 1, 'EX', 23 * 60 * 60);
    }
    return { poolSize: 0, stored: 0, top: [], filtered: true };
  }

  const pool    = await fetchMarketPool();
  const results: TopSignalItem[] = [];

  for (let i = 0; i < pool.length; i += CHUNK) {
    const chunk   = pool.slice(i, i + CHUNK);
    const fetched = await Promise.all(
      chunk.map(async ({ code, name }) => {
        const data = await fetchStockData(`${code}.TW`);
        if (!data) return null;
        const { score, signalLabels } = calculateRadarScore(data);
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

  // 儲存雷達推薦標的供 fast scan 追蹤出場
  const radarSymbols = top.map(item => item.symbol);
  await redis.set(RADAR_KEY, JSON.stringify(radarSymbols), 'EX', 26 * 60 * 60);

  return { poolSize: pool.length, stored: top.length, top };
}

async function runFullScanUS(): Promise<{ poolSize: number; stored: number; top: TopSignalItem[] }> {
  const results: TopSignalItem[] = [];

  for (let i = 0; i < US_POOL.length; i += CHUNK) {
    const chunk   = US_POOL.slice(i, i + CHUNK);
    const fetched = await Promise.all(
      chunk.map(async (code) => {
        const data = await fetchStockData(code);
        if (!data) return null;
        const { score, signalLabels } = calculateRadarScore(data);
        if (score === 0) return null;
        return {
          symbol:    code,
          code,
          name:      data.name || code,
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
  await redis.set(US_TOP_KEY, JSON.stringify(top), 'EX', 26 * 60 * 60);

  return { poolSize: US_POOL.length, stored: top.length, top };
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

  const mode   = (req.query?.mode   as string) ?? 'fast';
  const market = (req.query?.market as string) ?? 'tw';
  const force  = req.query?.force === 'true';

  if (mode !== 'fast' && mode !== 'full') {
    return res.status(400).json({ error: 'invalid mode', valid: ['fast', 'full'] });
  }

  if (!force) {
    const open = (mode === 'full' && market === 'us') ? isUSMarketOpen() : isMarketOpen();
    if (!open) return res.json({ skipped: 'market closed', mode, market, ts: new Date().toISOString() });
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
      const idxStatus = await getTWIndexStatus();
      const triggered = await runFastScan(settings!, idxStatus.aboveMA20);
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
    if (market === 'us') {
      const result = await runFullScanUS();
      return res.json({ ok: true, mode, market, ...result });
    }
    const result = await runFullScan();
    return res.json({ ok: true, mode, market, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'full scan failed' });
  }
}
