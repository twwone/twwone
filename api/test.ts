import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });

async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: 'TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID 未設定' };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const json = await res.json();
  return res.ok ? { ok: true } : { ok: false, error: json.description };
}

export default async function handler(req: any, res: any) {
  const results: Record<string, { ok: boolean; detail?: string }> = {};

  // 測試 Redis
  try {
    await redis.set('__test__', 1, 'EX', 10);
    const val = await redis.get('__test__');
    results.kv = val === '1' ? { ok: true } : { ok: false, detail: '寫入後讀取值不符' };
  } catch (e: any) {
    results.kv = { ok: false, detail: e?.message ?? 'Redis 連線失敗' };
  }

  // 測試 Telegram
  const tgResult = await sendTelegram(
    `✅ <b>連線測試成功</b>\n\nRedis：${results.kv.ok ? '正常 ✓' : '異常 ✗'}\nTelegram Bot：正常 ✓\n\n股票盯盤系統運作中`
  );
  results.telegram = tgResult.ok
    ? { ok: true }
    : { ok: false, detail: tgResult.error };

  const allOk = Object.values(results).every(r => r.ok);
  res.status(allOk ? 200 : 500).json({ ok: allOk, results });
}
