export default async function handler(req: any, res: any) {
  try {
    const r = await fetch(
      'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.json(data);
  } catch {
    res.status(502).json({ error: 'upstream error' });
  }
}
