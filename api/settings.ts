import { kv } from '@vercel/kv';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    try {
      const settings = await kv.get('settings') ?? {};
      return res.json(settings);
    } catch {
      return res.status(500).json({ error: 'KV not configured' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const current = (await kv.get<any>('settings')) ?? {};
      const merged  = { ...current, ...req.body, updatedAt: Date.now() };
      await kv.set('settings', merged);
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'KV not configured' });
    }
  }

  res.status(405).end();
}
