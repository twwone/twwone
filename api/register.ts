import { kv } from '@vercel/kv';
import type { SignalConfig } from '../lib/signals';

interface UserRecord {
  pushToken:    string;
  watchlist:    string[];
  signalConfig: SignalConfig;
  updatedAt:    number;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const { pushToken, watchlist, signalConfig } = req.body as UserRecord;
  if (!pushToken || !Array.isArray(watchlist)) {
    return res.status(400).json({ error: 'pushToken and watchlist are required' });
  }

  try {
    const record: UserRecord = { pushToken, watchlist, signalConfig, updatedAt: Date.now() };
    await kv.set(`user:${pushToken}`, record);
    await kv.sadd('push_tokens', pushToken);
    res.json({ ok: true, watchlist: watchlist.length });
  } catch (err) {
    console.error('[register] KV error:', err);
    res.status(500).json({ error: 'Vercel KV not configured — see README for setup' });
  }
}
