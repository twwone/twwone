import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
const KEY = 'settings';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    try {
      const raw = await redis.get(KEY);
      return res.json(raw ? JSON.parse(raw) : {});
    } catch {
      return res.status(500).json({ error: 'Redis not configured' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const raw     = await redis.get(KEY);
      const current = raw ? JSON.parse(raw) : {};
      const updatedAt = Date.now();
      const merged  = { ...current, ...req.body, updatedAt };
      await redis.set(KEY, JSON.stringify(merged));
      return res.json({ ok: true, updatedAt });
    } catch {
      return res.status(500).json({ error: 'Redis not configured' });
    }
  }

  res.status(405).end();
}
