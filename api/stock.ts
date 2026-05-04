const YF  = 'https://query1.finance.yahoo.com/v8/finance/chart';
const MIS = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

// 解析 .TW / .TWO 代號，回傳 MIS 格式（tse_0050.tw）
function toMisCode(symbol: string): string | null {
  const m = symbol.match(/^(\w+)\.(TW)(O?)$/i);
  if (!m) return null;
  const exchange = m[3] ? 'otc' : 'tse';
  return `${exchange}_${m[1].toLowerCase()}.tw`;
}

// Yahoo Finance：歷史 K 線、指標、非台股、fallback
async function fromYahoo(symbol: string, interval?: string, range?: string) {
  let url = `${YF}/${encodeURIComponent(symbol)}`;
  if (interval && range) url += `?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  return r.json();
}

// TWSE MIS：台股即時現價（<1 分鐘延遲）
async function fromMis(symbol: string, misCode: string) {
  const url = `${MIS}?ex_ch=${encodeURIComponent(misCode)}&json=1&delay=0`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://mis.twse.com.tw/stock/index.jsp',
    },
  });
  if (!r.ok) throw new Error(`MIS ${r.status}`);
  const json = await r.json();
  const item = json.msgArray?.[0];
  if (!item) throw new Error('MIS: empty');

  const parse = (v: string) => (v && v !== '-' ? parseFloat(v) : null);
  const price     = parse(item.z) ?? parse(item.y) ?? 0;
  const prevClose = parse(item.y) ?? 0;

  // 兩個欄位都是 '-'（停牌、尚未開盤、不存在）→ fallback Yahoo
  if (price === 0) throw new Error('MIS: invalid price');

  // 回傳 Yahoo Finance 相容格式，不讓前端改任何一行
  return {
    chart: {
      result: [{
        meta: {
          regularMarketPrice:  price,
          previousClose:       prevClose,
          shortName:           item.n ?? symbol,
          regularMarketDayHigh: parse(item.h) ?? price,
          regularMarketDayLow:  parse(item.l) ?? price,
        },
        indicators: { quote: [{}] },
        timestamp:  [],
      }],
      error: null,
    },
  };
}

export default async function handler(req: any, res: any) {
  const { symbol, interval, range } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=15');

  const misCode    = toMisCode(symbol);
  const needsHistory = !!(interval && range);

  // 歷史資料 或 非台股 → Yahoo Finance
  if (needsHistory || !misCode) {
    try {
      return res.json(await fromYahoo(symbol, interval, range));
    } catch {
      return res.status(502).json({ error: 'upstream error' });
    }
  }

  // 台股即時現價 → MIS，失敗自動 fallback Yahoo
  try {
    return res.json(await fromMis(symbol, misCode));
  } catch {
    try {
      return res.json(await fromYahoo(symbol));
    } catch {
      return res.status(502).json({ error: 'upstream error' });
    }
  }
}
