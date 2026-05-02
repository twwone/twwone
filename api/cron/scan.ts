import { kv } from '@vercel/kv';
import { detectSignals, SignalConfig } from '../../lib/signals';

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
      closes:  clean(q.close  as (number | null)[]),
      volumes: clean(q.volume as (number | null)[]),
      highs:   clean(q.high   as (number | null)[]),
      lows:    clean(q.low    as (number | null)[]),
    };
  } catch { return null; }
}

async function sendPush(token: string, title: string, body: string): Promise<void> {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title, body, sound: 'default', priority: 'high' }),
  });
}

interface UserRecord {
  pushToken:    string;
  watchlist:    string[];
  signalConfig: SignalConfig;
}

export default async function handler(req: any, res: any) {
  // 驗證：Vercel Cron 自動附帶 Authorization header（設定 CRON_SECRET 後生效）
  // 外部 cron 服務（如 cron-job.org）可用 ?key=YOUR_SECRET 觸發
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    const queryKey   = req.query?.key;
    const valid      = authHeader === `Bearer ${cronSecret}` || queryKey === cronSecret;
    if (!valid) return res.status(401).json({ error: 'unauthorized' });
  }

  if (!isMarketOpen()) {
    return res.json({ skipped: 'market closed', ts: new Date().toISOString() });
  }

  let tokens: string[] = [];
  try {
    tokens = (await kv.smembers('push_tokens')) as string[];
  } catch {
    return res.status(500).json({ error: 'Vercel KV not configured' });
  }

  const triggered: string[] = [];

  for (const token of tokens) {
    const user = await kv.get<UserRecord>(`user:${token}`);
    if (!user?.watchlist?.length) continue;

    for (const symbol of user.watchlist) {
      const data = await fetchStockData(symbol);
      if (!data) continue;

      const signals = detectSignals(
        data.closes, data.volumes, data.highs, data.lows, user.signalConfig,
      );

      for (const sig of signals) {
        // 4 小時冷卻，同一支股票同一訊號不重複推播
        const coolKey = `alert:${token}:${symbol}:${sig.type}`;
        if (await kv.get(coolKey)) continue;

        const shortSym = symbol.replace('.TW', '').replace('.TWO', '');
        await sendPush(token, `${sig.label}  ${shortSym}`, `${data.name} — ${sig.detail}`);
        await kv.set(coolKey, 1, { ex: 4 * 60 * 60 });
        triggered.push(`${symbol}:${sig.type}`);
      }
    }
  }

  res.json({ ok: true, scanned: tokens.length, triggered });
}
