import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });

const KEY = 'portfolio';

interface StoredPortfolio {
  holdings:  unknown[];
  updatedAt: number;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const raw = await redis.get(KEY);
      const data: StoredPortfolio = raw ? JSON.parse(raw) : { holdings: [], updatedAt: 0 };
      res.json(data);
    } catch {
      res.status(500).json({ error: 'Redis unavailable' });
    }
    return;
  }

  if (req.method === 'POST') {
    const { holdings, updatedAt } = req.body ?? {};
    if (!Array.isArray(holdings)) return res.status(400).json({ error: 'invalid' });
    try {
      await redis.set(KEY, JSON.stringify({ holdings, updatedAt: updatedAt ?? Date.now() }));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Redis unavailable' });
    }
    return;
  }

  res.status(405).end();
}
