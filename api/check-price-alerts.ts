import Redis from 'ioredis';
import type { PriceAlert } from './price-alerts';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
const KEY = 'price_alerts';
const YF  = 'https://query1.finance.yahoo.com/v8/finance/chart';

// TW 市場：09:00–13:30 CST = 01:00–05:30 UTC，週一至週五
// US 市場：22:30–05:00 CST = 14:30–21:00 UTC，週一至週五
function isMarketOpen(): boolean {
  const now  = new Date();
  const day  = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const twOpen = mins >= 60  && mins <= 330;  // 01:00–05:30 UTC
  const usOpen = mins >= 870 && mins <= 1260; // 14:30–21:00 UTC
  return twOpen || usOpen;
}

export default async function handler(req: any, res: any) {
  if (!isMarketOpen()) {
    return res.json({ skipped: true, reason: 'market closed' });
  }

  let alerts: PriceAlert[] = [];
  try {
    const raw = await redis.get(KEY);
    alerts = raw ? JSON.parse(raw) : [];
  } catch {
    return res.status(500).json({ error: 'redis error' });
  }

  if (alerts.length === 0) return res.json({ checked: 0, triggered: 0 });

  // 去重後抓現價
  const symbols = [...new Set(alerts.map(a => a.symbol))];
  const priceMap = new Map<string, number>();

  await Promise.all(symbols.map(async sym => {
    try {
      const r = await fetch(`${YF}/${encodeURIComponent(sym)}?interval=1d&range=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const j = await r.json();
      priceMap.set(sym, j.chart.result[0].meta.regularMarketPrice);
    } catch { /* 抓不到就跳過 */ }
  }));

  const triggered: PriceAlert[] = [];
  const remaining: PriceAlert[] = [];

  for (const alert of alerts) {
    const price = priceMap.get(alert.symbol);
    if (price == null) { remaining.push(alert); continue; }
    const hit = alert.direction === 'above'
      ? price >= alert.targetPrice
      : price <= alert.targetPrice;
    if (hit) triggered.push(alert);
    else remaining.push(alert);
  }

  if (triggered.length > 0) {
    await redis.set(KEY, JSON.stringify(remaining));

    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (token && chatId) {
      for (const alert of triggered) {
        const price   = priceMap.get(alert.symbol)!;
        const emoji   = alert.direction === 'above' ? '🚀' : '🔻';
        const dirText = alert.direction === 'above' ? '突破' : '跌破';
        const msg = `🔔 到價通知\n${emoji} ${alert.name}（${alert.symbol}）\n現價 ${price.toFixed(2)}，已${dirText}你設定的 ${alert.targetPrice}`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
        });
      }
    }
  }

  res.json({ checked: alerts.length, triggered: triggered.length });
}
