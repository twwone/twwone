import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
const KEY = 'price_alerts';

export interface PriceAlert {
  id: string;
  symbol: string;
  name: string;
  targetPrice: number;
  direction: 'above' | 'below';
  createdAt: number;
}

async function getAlerts(): Promise<PriceAlert[]> {
  try {
    const raw = await redis.get(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveAlerts(alerts: PriceAlert[]): Promise<void> {
  await redis.set(KEY, JSON.stringify(alerts));
}

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const alerts = await getAlerts();
    const { symbol } = req.query;
    return res.json(symbol ? alerts.filter(a => a.symbol === symbol) : alerts);
  }

  if (req.method === 'POST') {
    const { symbol, name, targetPrice, direction } = req.body;
    if (!symbol || !targetPrice || !direction) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const alerts = await getAlerts();
    const newAlert: PriceAlert = {
      id: `${symbol}_${direction}_${targetPrice}_${Date.now()}`,
      symbol,
      name: name ?? symbol,
      targetPrice: parseFloat(targetPrice),
      direction,
      createdAt: Date.now(),
    };
    alerts.push(newAlert);
    await saveAlerts(alerts);
    return res.json(newAlert);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const alerts = await getAlerts();
    await saveAlerts(alerts.filter(a => a.id !== (id as string)));
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'method not allowed' });
}
