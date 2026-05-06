import { readFileSync } from 'fs';

// 載入 .env.local
readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=');
  if (eq > 0 && !line.startsWith('#')) {
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
    process.env[key] = val;
  }
});

const token  = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

console.log('Token: ', token  ? '✓ 有值' : '✗ 缺少');
console.log('ChatID:', chatId ? '✓ 有值' : '✗ 缺少');

if (!token || !chatId) {
  console.log('❌ 環境變數未設定，請檢查 .env.local');
  process.exit(1);
}

const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: '🚀 系統廣播：技術主管查勤！您的 StockApp Telegram 推播管線 100% 暢通，準備好迎接明天的開盤了！',
  }),
});

const json = await res.json();
if (json.ok) {
  console.log('✅ 發送成功！請查看 Telegram');
} else {
  console.log('❌ 失敗：', json.description);
}
