import { kv } from '@vercel/kv';

interface StoredPortfolio {
  holdings:  unknown[];
  updatedAt: number;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const data = await kv.get<StoredPortfolio>('portfolio');
      res.json(data ?? { holdings: [], updatedAt: 0 });
    } catch {
      res.status(500).json({ error: 'KV unavailable' });
    }
    return;
  }

  if (req.method === 'POST') {
    const { holdings, updatedAt } = req.body ?? {};
    if (!Array.isArray(holdings)) return res.status(400).json({ error: 'invalid' });
    try {
      await kv.set('portfolio', { holdings, updatedAt: updatedAt ?? Date.now() });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'KV unavailable' });
    }
    return;
  }

  res.status(405).end();
}
