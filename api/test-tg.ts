export default async function handler(req: any, res: any) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(500).json({
      status: 'error',
      message: '環境變數未設定',
      detail: `TELEGRAM_BOT_TOKEN: ${token ? '✓' : '✗ 缺少'}，TELEGRAM_CHAT_ID: ${chatId ? '✓' : '✗ 缺少'}`,
    });
  }

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🚀 系統廣播：技術主管查勤！您的 StockApp Telegram 推播管線 100% 暢通，準備好迎接明天的開盤了！',
        parse_mode: 'HTML',
      }),
    });

    const json = await tgRes.json();

    if (!tgRes.ok) {
      return res.status(500).json({
        status: 'error',
        message: 'Telegram API 回傳錯誤',
        detail: json.description ?? JSON.stringify(json),
      });
    }

    return res.status(200).json({ status: 'success', message: 'Telegram 測試訊息已發送' });
  } catch (e: any) {
    return res.status(500).json({
      status: 'error',
      message: '網路請求失敗',
      detail: e?.message ?? String(e),
    });
  }
}
