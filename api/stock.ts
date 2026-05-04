const YF     = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FUGLE  = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote';

// 解析台股代號（2330.TW / 0050.TWO → "2330" / "0050"）
function toFugleCode(symbol: string): string | null {
  const m = symbol.match(/^(\w+)\.TWO?$/i);
  return m ? m[1].toUpperCase() : null;
}

// Fugle Market Data：台股即時報價（官方 API，不會被擋）
async function fromFugle(symbol: string, code: string) {
  const key = process.env.FUGLE_API_KEY;
  if (!key) throw new Error('Fugle: no API key');

  const r = await fetch(`${FUGLE}/${code}`, {
    headers: { 'X-API-KEY': key },
  });
  if (!r.ok) throw new Error(`Fugle ${r.status}`);
  const d = await r.json();

  const price     = d.lastPrice ?? d.closePrice ?? 0;
  const prevClose = d.referencePrice ?? d.previousClose ?? 0;
  if (!price || !prevClose) throw new Error('Fugle: no price data');

  return {
    chart: {
      result: [{
        meta: {
          regularMarketPrice:   price,
          previousClose:        prevClose,
          shortName:            d.name ?? symbol,
          regularMarketDayHigh: d.highPrice ?? price,
          regularMarketDayLow:  d.lowPrice  ?? price,
        },
        indicators: { quote: [{}] },
        timestamp:  [],
      }],
      error: null,
    },
  };
}

// Yahoo Finance：歷史 K 線、指標、非台股、fallback
async function fromYahoo(symbol: string, interval?: string, range?: string) {
  let url = `${YF}/${encodeURIComponent(symbol)}`;
  if (interval && range) url += `?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo ${r.status}`);
  return r.json();
}

export default async function handler(req: any, res: any) {
  const { symbol, interval, range } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=10');

  const fugleCode   = toFugleCode(symbol);
  const needsHistory = !!(interval && range);

  // 歷史資料 或 非台股 → Yahoo Finance
  if (needsHistory || !fugleCode) {
    try {
      return res.json(await fromYahoo(symbol, interval, range));
    } catch {
      return res.status(502).json({ error: 'upstream error' });
    }
  }

  // 台股即時現價 → Fugle，失敗 fallback Yahoo
  try {
    return res.json(await fromFugle(symbol, fugleCode));
  } catch {
    try {
      return res.json(await fromYahoo(symbol));
    } catch {
      return res.status(502).json({ error: 'upstream error' });
    }
  }
}
