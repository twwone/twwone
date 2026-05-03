import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
import { calcMA, detectSignals, SignalConfig } from '../lib/signals';

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';

function isMarketOpen(): boolean {
  const tw   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day  = tw.getDay();
  if (day === 0 || day === 6) return false;
  const mins = tw.getHours() * 60 + tw.getMinutes();
  return mins >= 9 * 60 && mins < 13 * 60 + 30;
}

interface StockData {
  name:    string;
  closes:  number[];
  volumes: number[];
  highs:   number[];
  lows:    number[];
  price:   number;
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

interface PortfolioItem {
  symbol:    string;
  name:      string;
  lots:      number;
  costPrice: number;
}

interface Settings {
  watchlist:    string[];
  signalConfig: SignalConfig;
  portfolio:    PortfolioItem[];
}

export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const valid =
      req.headers['authorization'] === `Bearer ${cronSecret}` ||
      req.query?.key === cronSecret;
    if (!valid) return res.status(401).json({ error: 'unauthorized' });
  }

  if (!isMarketOpen()) {
    return res.json({ skipped: 'market closed', ts: new Date().toISOString() });
  }

  let settings: Settings | null = null;
  try {
    const raw = await redis.get('settings');
    settings = raw ? JSON.parse(raw) : null;
  } catch {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  const portfolioMap = new Map<string, PortfolioItem>(
    (settings?.portfolio ?? []).map(p => [p.symbol, p]),
  );
  const allSymbols = Array.from(new Set([
    ...(settings?.watchlist ?? []),
    ...portfolioMap.keys(),
  ]));

  if (!allSymbols.length) {
    return res.json({ skipped: 'no symbols configured' });
  }

  const triggered: string[] = [];

  for (const symbol of allSymbols) {
    const data = await fetchStockData(symbol);
    if (!data) continue;

    const cfg      = settings?.signalConfig ?? {} as SignalConfig;
    const signals  = detectSignals(data.closes, data.volumes, data.highs, data.lows, cfg);
    const holding  = portfolioMap.get(symbol);
    const shortSym = symbol.replace('.TW', '').replace('.TWO', '');
    const price    = data.price;
    const ma20     = calcMA(data.closes, 20);
    const aboveMA20 = price > ma20;

    const entrySignals = signals.filter(s => s.category === 'entry');
    const exitSignals  = signals.filter(s => s.category === 'exit');

    // ── 第一層：趨勢過濾 + 第二層：主訊號 + 確認訊號 ─────

    // 買進：KD 低檔黃金交叉（主）+ 帶量突破 或 RSI 超賣反彈（確認）+ MA20 上方
    const hasKDEntry      = entrySignals.some(s => s.type === 'kdGoldenCross');
    const hasConfirmEntry = entrySignals.some(s => s.type === 'volumeBreak' || s.type === 'rsiOversold');

    if (hasKDEntry && hasConfirmEntry && aboveMA20) {
      const coolKey = `direct:buy:${symbol}`;
      if (!await redis.get(coolKey)) {
        const currentPrice = price;
        const stopLoss     = (currentPrice * 0.95).toFixed(2);
        const label        = entrySignals.map(s => s.label).join(' + ');
        const detail       = entrySignals.map(s => s.detail).join('\n💡 ');
        const msg = [
          `🟢 <b>【多頭進場指令】</b>`,
          `━━━━━━━━━━━━━━`,
          `🎯 <b>標的：</b> ${shortSym} ${data.name}`,
          `💰 <b>目前市價：</b> ${currentPrice.toLocaleString()} 元`,
          `📈 <b>觸發條件：</b> ${label}`,
          `💡 <b>指標細節：</b> ${detail}`,
          ``,
          `🛡️ <b>【系統紀律建議】</b>`,
          `1. <b>執行：</b> 建議於今日收盤前以「限價單」買進。`,
          `2. <b>防守：</b> 硬性停損點設為 <b>${stopLoss} 元</b> (跌破無條件離場)。`,
          `━━━━━━━━━━━━━━`,
          `🤖 StockApp 雲端策略引擎`,
        ].join('\n');
        await sendTelegram(msg);
        await redis.set(coolKey, 1, 'EX', 8 * 60 * 60);
        triggered.push(`${symbol}:buy`);
      }
    }

    // 賣出：KD 高檔死亡交叉（主）+ RSI 超買 或 布林上軌（確認）
    //       或：股價跌破 MA20 + 任一離場訊號
    const hasKDExit      = exitSignals.some(s => s.type === 'kdDeathCross');
    const hasConfirmExit = exitSignals.some(s => s.type === 'rsiOverbought' || s.type === 'bollingerUpper');
    const sellByKD       = hasKDExit && hasConfirmExit;
    const sellByMA       = !aboveMA20 && exitSignals.length >= 1;

    if (sellByKD || sellByMA) {
      const coolKey = `direct:sell:${symbol}`;
      if (!await redis.get(coolKey)) {
        const currentPrice = price;
        const label = exitSignals.length
          ? exitSignals.map(s => s.label).join(' + ')
          : `跌破 MA20`;
        const detail = exitSignals.length
          ? exitSignals.map(s => s.detail).join('\n💡 ')
          : `股價 ${currentPrice.toLocaleString()} 跌破 MA20 ${ma20.toFixed(2)}`;
        const msg = [
          `🔴 <b>【空頭離場指令】</b>`,
          `━━━━━━━━━━━━━━`,
          `🎯 <b>標的：</b> ${shortSym} ${data.name}`,
          `💰 <b>目前市價：</b> ${currentPrice.toLocaleString()} 元`,
          `📉 <b>觸發條件：</b> ${label}`,
          `💡 <b>指標細節：</b> ${detail}`,
          ``,
          `🛡️ <b>【系統紀律建議】</b>`,
          `1. <b>執行：</b> 建議立即清空手上所有 ${shortSym} 的部位。`,
          `2. <b>狀態：</b> 強制獲利了結或停損，收回現金等待下次訊號。`,
          `━━━━━━━━━━━━━━`,
          `🤖 StockApp 雲端策略引擎`,
        ].join('\n');
        await sendTelegram(msg);
        await redis.set(coolKey, 1, 'EX', 8 * 60 * 60);
        triggered.push(`${symbol}:sell`);
      }
    }

    // ── 第三層：停損提醒（持有中才檢查，跌破成本 -5%）────
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

  res.json({ ok: true, scanned: allSymbols.length, triggered });
}
