import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const raw = await redis.get('market:top_signals');
    if (!raw) return res.json({ top: [], updatedAt: null });
    const top = JSON.parse(raw);
    res.json({ top, updatedAt: top[0]?.updatedAt ?? null });
  } catch {
    res.status(500).json({ error: 'Redis error' });
  }
}
