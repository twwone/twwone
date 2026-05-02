import { kv } from '@vercel/kv';
import { detectSignals, SignalConfig } from '../lib/signals';

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
    settings = await kv.get<Settings>('settings');
  } catch {
    return res.status(500).json({ error: 'Vercel KV not configured' });
  }

  // 合併自選股 + 庫存股（去重）
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

    const signals = detectSignals(
      data.closes, data.volumes, data.highs, data.lows, settings?.signalConfig ?? {} as SignalConfig,
    );

    const holding     = portfolioMap.get(symbol);
    const isHolding   = !!holding;
    const shortSym    = symbol.replace('.TW', '').replace('.TWO', '');

    for (const sig of signals) {
      const coolKey = `alert:${symbol}:${sig.type}`;
      if (await kv.get(coolKey)) continue;

      const icon = sig.category === 'exit' ? '📉' : '📊';
      const lines = [
        `${icon} <b>${sig.label}</b>  ·  ${shortSym}${isHolding ? '  ⭐ 持有中' : ''}`,
        ``,
        `<b>${data.name}</b>  ${data.price.toLocaleString()}`,
        sig.detail,
      ];

      if (isHolding && holding) {
        const pnl    = (data.price - holding.costPrice) * holding.lots * 1000;
        const pnlPct = ((data.price - holding.costPrice) / holding.costPrice) * 100;
        const sign   = pnl >= 0 ? '+' : '';
        lines.push(`成本 ${holding.costPrice.toLocaleString()} → ${sign}${Math.round(pnl).toLocaleString()} 元 (${sign}${pnlPct.toFixed(2)}%)`);
      }

      await sendTelegram(lines.join('\n'));
      await kv.set(coolKey, 1, { ex: 4 * 60 * 60 });
      triggered.push(`${symbol}:${sig.type}`);
    }
  }

  res.json({ ok: true, scanned: allSymbols.length, triggered });
}
