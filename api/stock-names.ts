import type { VercelRequest, VercelResponse } from '@vercel/node';
import Redis from 'ioredis';

const CACHE_KEY = 'twse:stock-names-v1';
const TTL       = 6 * 60 * 60;

let redis: Redis | null = null;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
  return redis;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=21600');

  try {
    const r      = getRedis();
    const cached = await r.get(CACHE_KEY);
    if (cached) return res.json(JSON.parse(cached));

    const twseRes = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
    if (!twseRes.ok) throw new Error('TWSE fetch failed');
    const data = await twseRes.json() as any[];

    const names: { code: string; name: string }[] = data
      .filter(item => item['公司代號'] && item['公司簡稱'])
      .map(item => ({ code: item['公司代號'].trim(), name: item['公司簡稱'].trim() }));

    const payload = JSON.stringify({ names });
    await r.set(CACHE_KEY, payload, 'EX', TTL);
    return res.json({ names });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch stock names' });
  }
}
