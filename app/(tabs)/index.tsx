import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// ── 型別定義 ──────────────────────────────────────────────
type Tab = 'market' | 'watchlist' | 'search';
type Signal = 'strong_buy' | 'neutral' | 'bearish';

interface IndexData {
  price: number; change: number; changePct: number; high: number; low: number;
}
interface MarketStats {
  upCount: number; downCount: number; flatCount: number; totalValue: number;
}
interface StockItem {
  symbol: string; name: string; price: number; change: number; changePct: number;
  // 技術指標（僅搜尋結果才有）
  ma5?: number; ma20?: number;
  rsi?: number;
  volume?: number; vma5?: number;  // 今日成交量 vs 前 5 日均量
  condA?: boolean;                  // MA5 > MA20
  condB?: boolean;                  // RSI < 50
  condC?: boolean;                  // 今日量 > VMA5
}

// ── 設定 ──────────────────────────────────────────────────
const YF          = '/api/stock';
const TWSE_MARKET = '/api/twse';
const STORAGE_KEY = '@watchlist_v1';
const POLL_MS     = 60_000;

const DEFAULT_SYMBOLS = ['2330.TW', '2317.TW', '0050.TW', '2454.TW'];
const MARKET_STOCKS   = [
  { symbol: '2330.TW', name: '台積電' },
  { symbol: '2317.TW', name: '鴻海' },
  { symbol: '2454.TW', name: '聯發科' },
  { symbol: '0050.TW', name: '元大台灣50' },
  { symbol: '2881.TW', name: '富邦金' },
  { symbol: '2882.TW', name: '國泰金' },
  { symbol: '3008.TW', name: '大立光' },
  { symbol: '2412.TW', name: '中華電' },
];

// ── 工具函式 ──────────────────────────────────────────────
const tColor = (n: number) => (n >= 0 ? '#E74C3C' : '#27AE60');
const arrow  = (n: number) => (n >= 0 ? '▲' : '▼');

function formatValue(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}兆`;
  if (n >= 1e8)  return `${Math.round(n / 1e8)}億`;
  return n.toLocaleString();
}

// 成交量格式化（張：1張=1000股）
function formatVol(shares: number): string {
  const lots = shares / 1000;
  if (lots >= 10_000) return `${(lots / 10_000).toFixed(1)}萬張`;
  if (lots >= 1_000)  return `${Math.round(lots / 1_000)}千張`;
  return `${Math.round(lots)}張`;
}

function normalize(input: string): string {
  const s = input.trim().toUpperCase();
  if (s.includes('.')) return s;
  return /^\d+$/.test(s) ? `${s}.TW` : s;
}

function parseUpDown(s: string): number {
  return parseInt(s.split('(')[0].replace(/,/g, ''), 10) || 0;
}

function isMarketOpen(): boolean {
  const tw   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day  = tw.getDay();
  if (day === 0 || day === 6) return false;
  const mins = tw.getHours() * 60 + tw.getMinutes();
  return mins >= 9 * 60 && mins < 13 * 60 + 30;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('zh-TW', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Taipei',
  });
}

// ── 技術指標計算 ──────────────────────────────────────────

// N 日簡單移動平均
function calcMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// 14 日 RSI（Wilder's Smoothing 指數平滑法）
function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50; // 資料不足回傳中性值

  // 計算每日漲跌幅
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // 初始平均漲幅 / 跌幅（前 period 個）
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's EMA：用剩餘資料繼續平滑，讓 RSI 更穩定
  for (let i = period; i < changes.length; i++) {
    const gain = Math.max(changes[i], 0);
    const loss = Math.abs(Math.min(changes[i], 0));
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// 根據 RSI 數值返回文字說明
function rsiStatus(rsi: number): string {
  if (rsi < 30) return '超賣區';
  if (rsi < 50) return '適合進場';
  if (rsi < 70) return '偏高注意';
  return '超買危險';
}

// 根據三個條件判斷綜合訊號
function getSignal(condA: boolean, condB: boolean, condC: boolean): Signal {
  if (!condA) return 'bearish';
  if (condA && condB && condC) return 'strong_buy';
  return 'neutral';
}

// 訊號對應的樣式設定
const SIGNAL_CONFIG: Record<Signal, { emoji: string; label: string; sub: string; bg: string; border: string; color: string }> = {
  strong_buy: {
    emoji: '🟢', label: '強烈買進',    sub: '多重確認：絕佳進場點',
    bg: '#FDECEA', border: '#C0392B', color: '#C0392B',
  },
  neutral: {
    emoji: '🟡', label: '中立觀望',    sub: '訊號分歧：建議空手觀望',
    bg: '#FEF9E7', border: '#D4AC0D', color: '#9A7D0A',
  },
  bearish: {
    emoji: '🔴', label: '趨勢向下',    sub: '趨勢破滅：嚴格停損 / 離場',
    bg: '#EAFAF1', border: '#27AE60', color: '#1E8449',
  },
};

// ── AsyncStorage ──────────────────────────────────────────
async function loadList(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_SYMBOLS;
  } catch { return DEFAULT_SYMBOLS; }
}
async function saveList(symbols: string[]): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(symbols)); } catch {}
}

// ── API：快速（市場 + 自選股，只抓最新價）────────────────
async function fetchStock(symbol: string): Promise<StockItem | null> {
  try {
    const res  = await fetch(`${YF}?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const m    = json.chart.result[0].meta;
    const chg  = m.regularMarketPrice - m.previousClose;
    return { symbol, name: m.shortName ?? symbol, price: m.regularMarketPrice, change: chg, changePct: (chg / m.previousClose) * 100 };
  } catch { return null; }
}

// ── API：歷史日K（搜尋用，含 MA + RSI + 量能計算）────────
async function fetchStockWithIndicators(symbol: string): Promise<StockItem | null> {
  try {
    // range=3mo 約 60 個交易日，足夠算 MA20 和 RSI14
    const url    = `${YF}?symbol=${encodeURIComponent(symbol)}&interval=1d&range=3mo`;
    const res    = await fetch(url);
    if (!res.ok) return null;

    const json    = await res.json();
    const result  = json.chart.result[0];
    const m       = result.meta;
    const quote   = result.indicators.quote[0];

    // 過濾 Yahoo 可能回傳的 null（停市日沒資料）
    const closes:  number[] = (quote.close  as (number|null)[]).filter((c): c is number => c !== null && !isNaN(c));
    const volumes: number[] = (quote.volume as (number|null)[]).filter((v): v is number => v !== null && !isNaN(v) && v > 0);

    // ── 計算均線 ──
    const ma5  = calcMA(closes, 5);
    const ma20 = calcMA(closes, 20);

    // ── 計算 RSI(14) ──
    const rsi = calcRSI(closes, 14);

    // ── 計算成交量動能 ──
    // 今日成交量 vs 前 5 日均量（排除今日，避免自我比較）
    const todayVol = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
    const prev5    = volumes.length >= 6 ? volumes.slice(-6, -1) : volumes.slice(0, -1);
    const vma5     = prev5.length > 0 ? prev5.reduce((a, b) => a + b, 0) / prev5.length : 0;

    // ── 三個條件 ──
    const condA = ma5 > ma20;      // 均線多頭排列
    const condB = rsi < 50;        // RSI 未超買
    const condC = todayVol > vma5; // 量能放大

    const chg = m.regularMarketPrice - m.previousClose;
    return {
      symbol, name: m.shortName ?? symbol,
      price: m.regularMarketPrice, change: chg, changePct: (chg / m.previousClose) * 100,
      ma5, ma20, rsi, volume: todayVol, vma5, condA, condB, condC,
    };
  } catch { return null; }
}

async function fetchMultiple(symbols: string[]): Promise<StockItem[]> {
  const results = await Promise.all(symbols.map(fetchStock));
  return results.filter((r): r is StockItem => r !== null);
}

// ── 主元件 ────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('market');

  const [indexData,     setIndexData]     = useState<IndexData | null>(null);
  const [marketStats,   setMarketStats]   = useState<MarketStats | null>(null);
  const [marketStocks,  setMarketStocks]  = useState<StockItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketRefresh, setMarketRefresh] = useState(false);

  const [watchSymbols, setWatchSymbols] = useState<string[]>([]);
  const [watchStocks,  setWatchStocks]  = useState<StockItem[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchRefresh, setWatchRefresh] = useState(false);

  const [query,         setQuery]         = useState('');
  const [searchResult,  setSearchResult]  = useState<StockItem | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError,   setSearchError]   = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [marketOpen,  setMarketOpen]  = useState(isMarketOpen());

  const watchSymbolsRef = useRef<string[]>([]);
  useEffect(() => { watchSymbolsRef.current = watchSymbols; }, [watchSymbols]);

  // ── 從 searchResult 推導綜合訊號（不需要額外 state）
  const hasIndicators = searchResult?.condA !== undefined;
  const signal: Signal = hasIndicators
    ? getSignal(searchResult!.condA!, searchResult!.condB!, searchResult!.condC!)
    : 'neutral';
  const sig    = SIGNAL_CONFIG[signal];
  const score  = hasIndicators ? [searchResult!.condA, searchResult!.condB, searchResult!.condC].filter(Boolean).length : 0;

  // ── 載入市場 ─────────────────────────────────────────
  const loadMarket = async () => {
    try {
      const [idxRes, twseRes, ...stkRes] = await Promise.all([
        fetch(`${YF}?symbol=%5ETWII`),
        fetch(TWSE_MARKET),
        ...MARKET_STOCKS.map(s => fetch(`${YF}?symbol=${encodeURIComponent(s.symbol)}`)),
      ]);
      const idxJson = await idxRes.json();
      const m   = idxJson.chart.result[0].meta;
      const chg = m.regularMarketPrice - m.previousClose;
      setIndexData({ price: m.regularMarketPrice, change: chg, changePct: (chg / m.previousClose) * 100, high: m.regularMarketDayHigh, low: m.regularMarketDayLow });

      const twse     = await twseRes.json();
      const t7       = twse.tables[7]?.data ?? [];
      const t6       = twse.tables[6]?.data ?? [];
      const totalRow = t6.find((r: string[]) => r[0].includes('總計')) ?? t6[t6.length - 1];
      setMarketStats({
        upCount:    t7[0] ? parseUpDown(t7[0][1]) : 0,
        downCount:  t7[1] ? parseUpDown(t7[1][1]) : 0,
        flatCount:  t7[2] ? parseInt(t7[2][1].replace(/,/g, ''), 10) : 0,
        totalValue: totalRow ? parseInt(totalRow[1].replace(/,/g, ''), 10) : 0,
      });

      const items: StockItem[] = [];
      for (let i = 0; i < stkRes.length; i++) {
        try {
          const sj = await stkRes[i].json();
          const sm = sj.chart.result[0].meta;
          const sc = sm.regularMarketPrice - sm.previousClose;
          items.push({ symbol: MARKET_STOCKS[i].symbol, name: MARKET_STOCKS[i].name, price: sm.regularMarketPrice, change: sc, changePct: (sc / sm.previousClose) * 100 });
        } catch {}
      }
      setMarketStocks(items);
      setLastUpdated(new Date());
    } catch {}
    finally { setMarketLoading(false); setMarketRefresh(false); }
  };

  const loadWatchlist = async (symbols?: string[]) => {
    const list = symbols ?? watchSymbols;
    if (list.length > 0) setWatchLoading(true);
    setWatchStocks(await fetchMultiple(list));
    setWatchLoading(false);
    setWatchRefresh(false);
  };

  useEffect(() => {
    loadMarket();
    loadList().then(syms => { setWatchSymbols(syms); watchSymbolsRef.current = syms; loadWatchlist(syms); });
    const pollTimer   = setInterval(() => { const o = isMarketOpen(); setMarketOpen(o); if (!o) return; loadMarket(); const s = watchSymbolsRef.current; if (s.length > 0) fetchMultiple(s).then(setWatchStocks); }, POLL_MS);
    const statusTimer = setInterval(() => setMarketOpen(isMarketOpen()), 30_000);
    return () => { clearInterval(pollTimer); clearInterval(statusTimer); };
  }, []);

  const addStock = async (symbol: string) => {
    if (watchSymbols.includes(symbol)) return;
    const u = [...watchSymbols, symbol];
    setWatchSymbols(u); await saveList(u); loadWatchlist(u);
  };

  const removeStock = async (symbol: string) => {
    const u = watchSymbols.filter(s => s !== symbol);
    setWatchSymbols(u); await saveList(u);
    setWatchStocks(prev => prev.filter(s => s.symbol !== symbol));
  };

  const doSearch = async () => {
    const sym = normalize(query);
    if (!sym) return;
    setSearchLoading(true); setSearchResult(null); setSearchError(null);
    const result = await fetchStockWithIndicators(sym);
    if (result) setSearchResult(result);
    else setSearchError(`找不到「${sym}」，請確認代號是否正確`);
    setSearchLoading(false);
  };

  // ── 畫面 ─────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}><Text style={s.headerTitle}>我的股票分析器</Text></View>

      <View style={s.tabBar}>
        {(['market', 'watchlist', 'search'] as Tab[]).map(t => (
          <Pressable key={t} style={[s.tabItem, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'market' ? '市場' : t === 'watchlist' ? '自選股' : '搜尋 / 訊號'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={s.statusBar}>
        <View style={[s.statusDot, { backgroundColor: marketOpen ? '#2ECC71' : '#95A5A6' }]} />
        <Text style={s.statusText}>{marketOpen ? '交易中' : '已收盤'}</Text>
        {marketOpen && <Text style={s.statusSub}>　每 60 秒自動更新</Text>}
        {lastUpdated && <Text style={s.statusUpdated}>　更新：{formatTime(lastUpdated)}</Text>}
      </View>

      {/* ─── 市場 Tab ──────────────────────────────────── */}
      {tab === 'market' && (
        marketLoading
          ? <Center><ActivityIndicator size="large" color="#2C3E50" /><Text style={s.hint}>載入中...</Text></Center>
          : <ScrollView contentContainerStyle={s.scroll}
              refreshControl={<RefreshControl refreshing={marketRefresh} tintColor="#2C3E50" onRefresh={() => { setMarketRefresh(true); loadMarket(); }} />}>
              {indexData   && <IndexCard data={indexData} />}
              {marketStats && <StatsRow stats={marketStats} />}
              <Text style={s.sectionTitle}>重點個股</Text>
              {marketStocks.map(st => <StockCard key={st.symbol} stock={st} />)}
              <Text style={s.footer}>資料來源：Yahoo Finance / TWSE　下拉重新整理</Text>
            </ScrollView>
      )}

      {/* ─── 自選股 Tab ────────────────────────────────── */}
      {tab === 'watchlist' && (
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={s.addBtn} onPress={() => setTab('search')}>
            <Text style={s.addBtnText}>＋ 新增自選股</Text>
          </TouchableOpacity>
          {watchLoading
            ? <Center><ActivityIndicator size="large" color="#2C3E50" /></Center>
            : watchStocks.length === 0
              ? <Center><Text style={s.hint}>尚無自選股{'\n'}點上方按鈕前往搜尋新增</Text></Center>
              : <FlatList data={watchStocks} keyExtractor={i => i.symbol}
                  contentContainerStyle={{ padding: 16, gap: 10 }}
                  refreshControl={<RefreshControl refreshing={watchRefresh} tintColor="#2C3E50" onRefresh={() => { setWatchRefresh(true); loadWatchlist(); }} />}
                  renderItem={({ item }) => <StockCard stock={item} onDelete={() => removeStock(item.symbol)} />}
                />
          }
        </View>
      )}

      {/* ─── 搜尋 + 綜合訊號 Tab ───────────────────────── */}
      {tab === 'search' && (
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: 20 }]} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionTitle}>查詢股票</Text>
          <Text style={s.hint}>台股輸入數字代號（2330）；美股輸入英文代號（AAPL）</Text>
          <View style={s.searchRow}>
            <TextInput style={s.searchInput} placeholder="2330 / 0050 / AAPL / TSLA"
              placeholderTextColor="#bbb" value={query} onChangeText={setQuery}
              onSubmitEditing={doSearch} autoCapitalize="characters" returnKeyType="search" />
            <TouchableOpacity style={s.searchBtn} onPress={doSearch}>
              <Text style={s.searchBtnText}>查詢</Text>
            </TouchableOpacity>
          </View>

          {searchLoading && (
            <View style={{ alignItems: 'center', marginTop: 24, gap: 10 }}>
              <ActivityIndicator size="large" color="#2C3E50" />
              <Text style={s.hint}>正在抓取歷史 K 線並計算指標...</Text>
            </View>
          )}
          {searchError && <Text style={s.searchError}>{searchError}</Text>}

          {searchResult && (
            <>
              <StockCard stock={searchResult} />

              <TouchableOpacity
                style={[s.watchlistBtn, watchSymbols.includes(searchResult.symbol) && s.watchlistBtnDone]}
                onPress={() => addStock(searchResult!.symbol)}
                disabled={watchSymbols.includes(searchResult.symbol)}
              >
                <Text style={s.watchlistBtnText}>
                  {watchSymbols.includes(searchResult.symbol) ? '✓ 已在自選股' : '＋ 加入自選股'}
                </Text>
              </TouchableOpacity>

              {/* ── 系統自動趨勢分析（MA + RSI + 量能儀表板）── */}
              {hasIndicators && (
                <View style={s.maCard}>
                  <View style={s.maCardHeader}>
                    <Text style={s.maCardTitle}>系統自動趨勢分析</Text>
                    <Text style={s.maCardSub}>依近 3 個月日K自動計算</Text>
                  </View>

                  {/* MA 數值列 */}
                  <View style={s.maRow}>
                    <View style={s.maItem}>
                      <Text style={s.maLabel}>MA5（5日均線）</Text>
                      <Text style={[s.maValue, { color: tColor(searchResult.ma5! - searchResult.ma20!) }]}>
                        {searchResult.ma5!.toFixed(2)}
                      </Text>
                    </View>
                    <View style={s.maDivider} />
                    <View style={s.maItem}>
                      <Text style={s.maLabel}>MA20（20日均線）</Text>
                      <Text style={[s.maValue, { color: tColor(searchResult.ma20! - searchResult.ma5!) }]}>
                        {searchResult.ma20!.toFixed(2)}
                      </Text>
                    </View>
                  </View>

                  <View style={s.indDivider} />

                  {/* 三個指標明細列 */}
                  <Text style={s.indSectionLabel}>指標明細</Text>

                  <IndRow
                    pass={searchResult.condA!}
                    label="均線趨勢（MA5 vs MA20）"
                    detail={searchResult.condA!
                      ? `MA5 ${searchResult.ma5!.toFixed(1)} > MA20 ${searchResult.ma20!.toFixed(1)}　✦ 黃金交叉`
                      : `MA5 ${searchResult.ma5!.toFixed(1)} ≤ MA20 ${searchResult.ma20!.toFixed(1)}　✦ 死亡交叉`}
                  />
                  <IndRow
                    pass={searchResult.condB!}
                    label={`RSI 動能（RSI < 50 為適合進場）`}
                    detail={`RSI ${searchResult.rsi!.toFixed(1)} · ${rsiStatus(searchResult.rsi!)}`}
                  />
                  <IndRow
                    pass={searchResult.condC!}
                    label="成交量動能（今日量 vs VMA5）"
                    detail={searchResult.vma5! > 0
                      ? `今日 ${formatVol(searchResult.volume!)} / 均量 ${formatVol(searchResult.vma5!)}`
                      : '成交量資料不足'}
                  />

                  <View style={s.indDivider} />

                  {/* 綜合決策燈號 */}
                  <View style={[s.signalBox, { backgroundColor: sig.bg, borderColor: sig.border }]}>
                    <Text style={[s.signalScore, { color: sig.color }]}>{score} / 3 條件達成</Text>
                    <Text style={[s.signalMain,  { color: sig.color }]}>{sig.emoji} {sig.label}</Text>
                    <Text style={[s.signalSub,   { color: sig.color }]}>{sig.sub}</Text>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 子元件 ────────────────────────────────────────────────
function Center({ children }: { children: React.ReactNode }) {
  return <View style={s.centered}>{children}</View>;
}

// 指標明細列：傳入是否通過、標題、詳細說明
function IndRow({ pass, label, detail }: { pass: boolean; label: string; detail: string }) {
  return (
    <View style={s.indRow}>
      <Text style={s.indIcon}>{pass ? '✅' : '❌'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.indLabel}>{label}</Text>
        <Text style={[s.indDetail, { color: pass ? '#2C3E50' : '#999' }]}>{detail}</Text>
      </View>
    </View>
  );
}

function IndexCard({ data }: { data: IndexData }) {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <View style={s.indexCard}>
      <Text style={s.indexLabel}>台股加權指數</Text>
      <Text style={[s.indexPrice, { color: tColor(data.change) }]}>{fmt(data.price)}</Text>
      <Text style={[s.indexChange, { color: tColor(data.change) }]}>
        {arrow(data.change)} {Math.abs(data.change).toFixed(2)}{'  '}
        ({data.changePct >= 0 ? '+' : ''}{data.changePct.toFixed(2)}%)
      </Text>
      <View style={s.indexHiLo}>
        <Text style={s.indexSub}>最高 {fmt(data.high)}</Text>
        <Text style={s.indexSub}>最低 {fmt(data.low)}</Text>
      </View>
    </View>
  );
}

function StatsRow({ stats }: { stats: MarketStats }) {
  return (
    <View style={s.statsRow}>
      <StatCard value={stats.upCount.toLocaleString()}   label="上漲" accent="#E74C3C" />
      <StatCard value={stats.downCount.toLocaleString()} label="下跌" accent="#27AE60" />
      <StatCard value={stats.flatCount.toLocaleString()} label="持平" accent="#95A5A6" />
      <StatCard value={formatValue(stats.totalValue)}    label="成交金額" accent="#3498DB" />
    </View>
  );
}

function StatCard({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <View style={[s.statCard, { borderTopColor: accent }]}>
      <Text style={s.statNum} numberOfLines={1}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function StockCard({ stock, onDelete }: { stock: StockItem; onDelete?: () => void }) {
  return (
    <View style={s.stockCard}>
      <View style={{ flex: 1 }}>
        <Text style={s.stockSymbol}>{stock.symbol}</Text>
        <Text style={s.stockName}>{stock.name}</Text>
      </View>
      <View style={s.stockRight}>
        <Text style={[s.stockPrice, { color: tColor(stock.change) }]}>{stock.price.toLocaleString()}</Text>
        <Text style={[s.stockChange, { color: tColor(stock.change) }]}>
          {arrow(stock.change)} {Math.abs(stock.change).toFixed(2)}{'  '}
          ({stock.changePct >= 0 ? '+' : ''}{stock.changePct.toFixed(2)}%)
        </Text>
      </View>
      {onDelete && (
        <TouchableOpacity style={s.deleteBtn} onPress={onDelete}>
          <Text style={s.deleteBtnText}>－</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── 樣式 ─────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F0F2F5' },
  header:       { backgroundColor: '#2C3E50', paddingVertical: 16, alignItems: 'center' },
  headerTitle:  { fontSize: 20, fontWeight: 'bold', color: 'white' },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  hint:         { fontSize: 13, color: '#999', textAlign: 'center', marginBottom: 4 },
  scroll:       { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#2C3E50', marginTop: 4 },
  footer:       { fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 4 },

  tabBar:       { flexDirection: 'row', backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#E8E8E8' },
  tabItem:      { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabActive:    { borderBottomWidth: 2.5, borderBottomColor: '#2C3E50' },
  tabText:      { fontSize: 13, color: '#aaa' },
  tabTextActive:{ fontSize: 13, color: '#2C3E50', fontWeight: 'bold' },

  statusBar:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAFAFA', paddingHorizontal: 14, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#EFEFEF' },
  statusDot:    { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  statusText:   { fontSize: 12, color: '#555', fontWeight: '600' },
  statusSub:    { fontSize: 11, color: '#aaa' },
  statusUpdated:{ fontSize: 11, color: '#aaa', marginLeft: 'auto' },

  indexCard:   { backgroundColor: 'white', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  indexLabel:  { fontSize: 13, color: '#999', marginBottom: 4 },
  indexPrice:  { fontSize: 44, fontWeight: 'bold', lineHeight: 52 },
  indexChange: { fontSize: 18, fontWeight: '600', marginBottom: 10 },
  indexHiLo:   { flexDirection: 'row', gap: 24 },
  indexSub:    { fontSize: 13, color: '#888' },

  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 12, padding: 10, alignItems: 'center', borderTopWidth: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  statNum:  { fontSize: 13, fontWeight: 'bold', color: '#2C3E50' },
  statLabel:{ fontSize: 10, color: '#999', marginTop: 3 },

  stockCard:     { backgroundColor: 'white', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  stockSymbol:   { fontSize: 15, fontWeight: 'bold', color: '#2C3E50' },
  stockName:     { fontSize: 12, color: '#999', marginTop: 2 },
  stockRight:    { alignItems: 'flex-end', marginRight: 8 },
  stockPrice:    { fontSize: 20, fontWeight: 'bold' },
  stockChange:   { fontSize: 12, fontWeight: '500', marginTop: 2 },
  deleteBtn:     { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FDECEA', justifyContent: 'center', alignItems: 'center' },
  deleteBtnText: { fontSize: 18, color: '#E74C3C', lineHeight: 22 },

  addBtn:     { margin: 16, marginBottom: 8, backgroundColor: '#2C3E50', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  addBtnText: { color: 'white', fontSize: 15, fontWeight: 'bold' },

  searchRow:        { flexDirection: 'row', gap: 10, marginBottom: 4 },
  searchInput:      { flex: 1, backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: '#DDD', color: '#333' },
  searchBtn:        { backgroundColor: '#2C3E50', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  searchBtnText:    { color: 'white', fontWeight: 'bold', fontSize: 15 },
  searchError:      { color: '#E74C3C', textAlign: 'center', marginTop: 24, fontSize: 14 },
  watchlistBtn:     { backgroundColor: '#2C3E50', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  watchlistBtnDone: { backgroundColor: '#B2BABB' },
  watchlistBtnText: { color: 'white', fontWeight: 'bold', fontSize: 15 },

  // ── 技術分析卡片 ──
  maCard: { backgroundColor: 'white', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3, gap: 14 },
  maCardHeader: { gap: 2 },
  maCardTitle:  { fontSize: 16, fontWeight: 'bold', color: '#2C3E50' },
  maCardSub:    { fontSize: 12, color: '#aaa' },
  maRow:        { flexDirection: 'row', alignItems: 'center' },
  maItem:       { flex: 1, alignItems: 'center', gap: 4 },
  maDivider:    { width: 1, height: 48, backgroundColor: '#EEE' },
  maLabel:      { fontSize: 12, color: '#999' },
  maValue:      { fontSize: 26, fontWeight: 'bold' },

  // 指標明細
  indDivider:      { height: 1, backgroundColor: '#F0F0F0' },
  indSectionLabel: { fontSize: 13, fontWeight: '600', color: '#888' },
  indRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  indIcon:         { fontSize: 18, lineHeight: 24 },
  indLabel:        { fontSize: 13, color: '#555', fontWeight: '600' },
  indDetail:       { fontSize: 12, marginTop: 2 },

  // 綜合訊號框
  signalBox:   { borderWidth: 2, borderRadius: 14, padding: 18, alignItems: 'center', gap: 4 },
  signalScore: { fontSize: 13, fontWeight: '600' },
  signalMain:  { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  signalSub:   { fontSize: 13, textAlign: 'center', opacity: 0.85 },
});
