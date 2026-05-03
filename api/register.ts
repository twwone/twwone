import Redis from 'ioredis';
import type { SignalConfig } from '../lib/signals';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
const KEY = 'settings';

interface PortfolioItem {
  symbol:    string;
  name:      string;
  lots:      number;
  costPrice: number;
}

interface Settings {
  watchlist:        string[];
  signalConfig:     SignalConfig;
  portfolio:        PortfolioItem[];
  signalProfiles?:  unknown[];
  activeProfileId?: string;
  updatedAt:        number;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  const { watchlist, signalConfig, portfolio = [], signalProfiles, activeProfileId } = req.body as Settings;
  if (!Array.isArray(watchlist)) {
    return res.status(400).json({ error: 'watchlist is required' });
  }

  try {
    const raw     = await redis.get(KEY);
    const current = raw ? JSON.parse(raw) : {};
    await redis.set(KEY, JSON.stringify({
      ...current,
      watchlist, signalConfig, portfolio,
      ...(signalProfiles   ? { signalProfiles }   : {}),
      ...(activeProfileId  ? { activeProfileId }  : {}),
      updatedAt: Date.now(),
    }));
    res.json({ ok: true, watchlist: watchlist.length, portfolio: portfolio.length });
  } catch (err) {
    console.error('[register] Redis error:', err);
    res.status(500).json({ error: 'Redis not configured' });
  }
}
