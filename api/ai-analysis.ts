const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';

function calcMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.abs(Math.min(changes[i], 0))) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export default async function handler(req: any, res: any) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set' });

  // 抓 3 個月日 K 資料
  const yfRes = await fetch(`${YF}/${encodeURIComponent(symbol)}?interval=1d&range=3mo`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!yfRes.ok) return res.status(502).json({ error: 'Failed to fetch stock data' });

  const json    = await yfRes.json();
  const r       = json.chart.result[0];
  const m       = r.meta;
  const q       = r.indicators.quote[0];

  const closes:  number[] = (q.close  as (number | null)[]).filter((c): c is number => c != null && !isNaN(c));
  const volumes: number[] = (q.volume as (number | null)[]).filter((v): v is number => v != null && !isNaN(v) && v > 0);

  const ma5  = calcMA(closes, 5);
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);
  const rsi  = calcRSI(closes, 14);

  const price    = m.regularMarketPrice;
  const prev     = m.previousClose;
  const change   = price - prev;
  const changePct = (change / prev) * 100;

  const todayVol = volumes.at(-1) ?? 0;
  const vma5     = volumes.length >= 6
    ? volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5
    : 0;

  const recent10 = closes.slice(-10).map(c => c.toFixed(2)).join('、');

  const maOrder = ma5 > ma20 && ma20 > ma60 ? '多頭排列（MA5 > MA20 > MA60）'
    : ma5 < ma20 && ma20 < ma60             ? '空頭排列（MA5 < MA20 < MA60）'
    : '整理中';

  const volStr = vma5 > 0 ? `今日量為5日均量的 ${(todayVol / vma5 * 100).toFixed(0)}%` : '量能資料不足';

  const prompt = `你是專業股票技術分析師，根據以下技術數據給出操作建議，請用繁體中文回答。

股票：${m.shortName ?? symbol}（${symbol}）
當前價格：${price.toFixed(2)}
今日漲跌：${change >= 0 ? '+' : ''}${change.toFixed(2)}（${changePct.toFixed(2)}%）
52週最高：${(m.fiftyTwoWeekHigh ?? 0).toFixed(2)}
52週最低：${(m.fiftyTwoWeekLow ?? 0).toFixed(2)}

技術指標：
- MA5：${ma5.toFixed(2)}
- MA20：${ma20.toFixed(2)}
- MA60：${ma60.toFixed(2)}
- 均線排列：${maOrder}
- RSI(14)：${rsi.toFixed(1)}
- 成交量動能：${volStr}
- 近10日收盤：${recent10}

請按照以下格式回答，不要加其他內容：
【操作建議】買進 / 觀望 / 賣出（只選一個）
【信心程度】高 / 中 / 低
【理由】2-3句說明主要原因
【風險提示】1句提醒主要風險
【短期目標價】給出合理目標價區間`;

  const groqRes = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 400,
      }),
    }
  );

  if (!groqRes.ok) {
    const errBody = await groqRes.text();
    return res.status(502).json({ error: 'Groq API error', status: groqRes.status, detail: errBody.slice(0, 300) });
  }
  const gj   = await groqRes.json();
  const text = gj.choices?.[0]?.message?.content ?? '分析失敗，請稍後再試';

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
  res.json({ analysis: text, symbol, name: m.shortName ?? symbol, price });
}
