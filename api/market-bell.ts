async function sendTelegram(text: string): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

const MESSAGES: Record<string, string> = {
  'tw-open': [
    `🔔 <b>台股開盤</b>  09:00`,
    ``,
    `台灣證券交易所正式開市`,
    `交易時間：09:00 ～ 13:30`,
    `祝今日操作順利 📈`,
  ].join('\n'),

  'tw-close': [
    `🔕 <b>台股收盤</b>  13:30`,
    ``,
    `台灣證券交易所今日收市`,
    `明日 09:00 再見 👋`,
  ].join('\n'),

  'us-open': [
    `🔔 <b>美股開盤</b>  09:30 ET`,
    ``,
    `NYSE / NASDAQ 正式開市`,
    `交易時間：09:30 ～ 16:00 ET`,
    `祝今日操作順利 📈`,
  ].join('\n'),

  'us-close': [
    `🔕 <b>美股收盤</b>  16:00 ET`,
    ``,
    `NYSE / NASDAQ 今日收市`,
    `明日 09:30 ET 再見 👋`,
  ].join('\n'),
};

export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const valid =
      req.headers['authorization'] === `Bearer ${cronSecret}` ||
      req.query?.key === cronSecret;
    if (!valid) return res.status(401).json({ error: 'unauthorized' });
  }

  const type = req.query?.type as string;
  const msg  = MESSAGES[type];

  if (!msg) {
    return res.status(400).json({ error: 'invalid type', valid: Object.keys(MESSAGES) });
  }

  await sendTelegram(msg);
  res.json({ ok: true, type });
}
