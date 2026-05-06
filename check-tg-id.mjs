import { readFileSync } from 'fs';

readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const eq = line.indexOf('=');
  if (eq > 0 && !line.startsWith('#')) {
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const json = await res.json();

if (!json.ok) {
  console.log('❌ API 錯誤:', json.description);
  process.exit(1);
}

if (json.result.length === 0) {
  console.log('⚠️  Bot 尚未收到任何訊息，請去 Telegram 對 Bot 傳一則訊息後再跑一次');
  process.exit(1);
}

json.result.forEach(update => {
  const msg = update.message || update.channel_post;
  if (msg) {
    console.log('Chat ID:', msg.chat.id);
    console.log('類型:', msg.chat.type);
    console.log('名稱:', msg.chat.first_name ?? msg.chat.title ?? '(無)');
    console.log('---');
  }
});
