import { kv } from '@vercel/kv';
import type { SignalConfig } from '../lib/signals';

interface Settings {
  watchlist:    string[];
  signalConfig: SignalConfig;
  updatedAt:    number;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const { watchlist, signalConfig } = req.body as Settings;
  if (!Array.isArray(watchlist)) {
    return res.status(400).json({ error: 'watchlist is required' });
  }

  try {
    await kv.set('settings', { watchlist, signalConfig, updatedAt: Date.now() });
    res.json({ ok: true, watchlist: watchlist.length });
  } catch (err) {
    console.error('[register] KV error:', err);
    res.status(500).json({ error: 'Vercel KV not configured' });
  }
}
