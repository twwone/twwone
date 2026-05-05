import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
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
import KLineChart from '@/components/KLineChart';
import { useSyncData } from '@/hooks/useSyncData';
import { getNameMap, resolveName } from '@/lib/stockNames';

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
  return /^\d+[A-Z]?$/.test(s) ? `${s}.TW` : s;
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

// ── AsyncStorage + Server Sync ────────────────────────────
interface StoredWatchlist { watchlist: string[]; updatedAt: number; }

async function loadList(): Promise<StoredWatchlist> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { watchlist: DEFAULT_SYMBOLS, updatedAt: 0 };
    const parsed = JSON.parse(raw);
    // backward compat：舊版只存 string[]
    if (Array.isArray(parsed)) return { watchlist: parsed, updatedAt: 0 };
    return parsed as StoredWatchlist;
  } catch { return { watchlist: DEFAULT_SYMBOLS, updatedAt: 0 }; }
}
async function saveList(symbols: string[]): Promise<void> {
  const updatedAt = Date.now();
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ watchlist: symbols, updatedAt })); } catch {}
  fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchlist: symbols, watchlistUpdatedAt: updatedAt }),
  }).catch(() => {});
}
async function loadListFromServer(): Promise<StoredWatchlist | null> {
  try {
    const res = await fetch('/api/settings', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.watchlist) || data.watchlist.length === 0) return null;
    return { watchlist: data.watchlist, updatedAt: data.watchlistUpdatedAt ?? data.updatedAt ?? 0 };
  } catch { return null; }
}

// ── API：快速（市場 + 自選股，只抓最新價）────────────────
async function fetchStock(symbol: string, forceRefresh = false): Promise<StockItem | null> {
  const init: RequestInit = forceRefresh ? { headers: { 'Cache-Control': 'no-cache' } } : {};
  try {
    const res  = await fetch(`${YF}?symbol=${encodeURIComponent(symbol)}`, init);
    if (!res.ok) return null;
    const json = await res.json();
    const m    = json.chart.result[0].meta;
    const chg  = m.regularMarketPrice - m.previousClose;
    const map  = await getNameMap();
    const name = resolveName(symbol, map, m.shortName ?? symbol);
    return { symbol, name, price: m.regularMarketPrice, change: chg, changePct: m.previousClose ? (chg / m.previousClose) * 100 : 0 };
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

    const chg  = m.regularMarketPrice - m.previousClose;
    const map2 = await getNameMap();
    const name = resolveName(symbol, map2, m.shortName ?? symbol);
    return {
      symbol, name,
      price: m.regularMarketPrice, change: chg, changePct: m.previousClose ? (chg / m.previousClose) * 100 : 0,
      ma5, ma20, rsi, volume: todayVol, vma5, condA, condB, condC,
    };
  } catch { return null; }
}

async function fetchMultiple(symbols: string[], forceRefresh = false): Promise<StockItem[]> {
  const results = await Promise.all(symbols.map(s => fetchStock(s, forceRefresh)));
  return results.filter((r): r is StockItem => r !== null);
}

// ── 主元件 ────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('market');

  const [indexData,     setIndexData]     = useState<IndexData | null>(null);
  const [marketStats,   setMarketStats]   = useState<MarketStats | null>(null);
  const [marketStocks,  setMarketStocks]  = useState<StockItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);

  const [watchSymbols, setWatchSymbols] = useState<string[]>([]);
  const [watchStocks,  setWatchStocks]  = useState<StockItem[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);

  const [query,         setQuery]         = useState('');
  const [searchResult,  setSearchResult]  = useState<StockItem | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError,   setSearchError]   = useState<string | null>(null);
  const [suggestions,   setSuggestions]   = useState<{ code: string; name: string }[]>([]);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [marketOpen,  setMarketOpen]  = useState(isMarketOpen());
  const [selectedStock, setSelectedStock] = useState<StockItem | null>(null);
  const [aiText,        setAiText]        = useState<string | null>(null);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [aiError,       setAiError]       = useState<string | null>(null);

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
  const loadMarket = async (forceRefresh = false) => {
    const init: RequestInit = forceRefresh ? { headers: { 'Cache-Control': 'no-cache' } } : {};
    try {
      const [idxRes, twseRes, ...stkRes] = await Promise.all([
        fetch(`${YF}?symbol=%5ETWII`, init),
        fetch(TWSE_MARKET, init),
        ...MARKET_STOCKS.map(s => fetch(`${YF}?symbol=${encodeURIComponent(s.symbol)}`, init)),
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
    finally { setMarketLoading(false); }
  };

  const loadWatchlist = async (symbols?: string[], forceRefresh = false) => {
    const list = symbols ?? watchSymbols;
    if (list.length > 0) setWatchLoading(true);
    setWatchStocks(await fetchMultiple(list, forceRefresh));
    setWatchLoading(false);
  };

  // ── 靜默同步：比對 updatedAt，雲端 >= 本地才覆蓋；無論如何都刷新報價 ──
  const silentSyncWatchlist = useCallback(async (forceRefresh = false) => {
    const [local, server] = await Promise.all([loadList(), loadListFromServer()]);
    if (server && server.updatedAt >= local.updatedAt) {
      setWatchSymbols(server.watchlist);
      watchSymbolsRef.current = server.watchlist;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(server));
      await loadWatchlist(server.watchlist, forceRefresh);
    } else {
      await loadWatchlist(watchSymbolsRef.current, forceRefresh);
    }
  }, []);

  useEffect(() => {
    loadMarket();
    loadList().then(async local => {
      setWatchSymbols(local.watchlist);
      watchSymbolsRef.current = local.watchlist;
      loadWatchlist(local.watchlist);
      const server = await loadListFromServer();
      if (server && server.updatedAt >= local.updatedAt) {
        setWatchSymbols(server.watchlist);
        watchSymbolsRef.current = server.watchlist;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(server));
        loadWatchlist(server.watchlist);
      }
    });
    // 只保留市場開收盤狀態輪詢（每 30 秒），不再自行管 fetch 定時器
    const statusTimer = setInterval(() => setMarketOpen(isMarketOpen()), 30_000);
    return () => clearInterval(statusTimer);
  }, []);

  // ── useSyncData：三合一刷新（30s interval + Tab 焦點 + 手動按鈕）──
  const syncAll = useCallback(async (forceRefresh: boolean) => {
    setMarketOpen(isMarketOpen());
    await Promise.all([loadMarket(forceRefresh), silentSyncWatchlist(forceRefresh)]);
  }, [silentSyncWatchlist]);

  const { isSyncing, triggerSync } = useSyncData(syncAll, 30_000);

  // ── 動態設定 Navigation Header 右側刷新按鈕 ──────────────
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={triggerSync}
          disabled={isSyncing}
          style={{ marginRight: 14, width: 34, height: 34, justifyContent: 'center', alignItems: 'center' }}
        >
          {isSyncing
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Text style={{ fontSize: 22, color: '#FFFFFF', fontWeight: 'bold' }}>↻</Text>
          }
        </TouchableOpacity>
      ),
    });
  }, [navigation, isSyncing, triggerSync]);

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

  const handleQueryChange = async (text: string) => {
    setQuery(text);
    if (/[一-鿿]/.test(text) && text.length >= 1) {
      const map = await getNameMap();
      const hits = Object.entries(map)
        .filter(([, name]) => name.includes(text))
        .slice(0, 6)
        .map(([code, name]) => ({ code, name }));
      setSuggestions(hits);
    } else {
      setSuggestions([]);
    }
  };

  const searchByCode = async (code: string) => {
    const sym = normalize(code);
    setSuggestions([]);
    setSearchLoading(true); setSearchResult(null); setSearchError(null);
    const result = await fetchStockWithIndicators(sym);
    if (result) setSearchResult(result);
    else setSearchError(`找不到「${sym}」，請確認代號是否正確`);
    setSearchLoading(false);
  };

  const doSearch = async () => {
    const isChinese = /[一-鿿]/.test(query);
    if (isChinese) {
      const map   = await getNameMap();
      const entry = Object.entries(map).find(([, name]) => name === query || name.includes(query));
      if (!entry) { setSearchError(`找不到「${query}」，請確認名稱是否正確`); return; }
      await searchByCode(entry[0]);
      return;
    }
    const sym = normalize(query);
    if (!sym) return;
    setSuggestions([]);
    setSearchLoading(true); setSearchResult(null); setSearchError(null);
    const result = await fetchStockWithIndicators(sym);
    if (result) setSearchResult(result);
    else setSearchError(`找不到「${sym}」，請確認代號是否正確`);
    setSearchLoading(false);
  };

  // ── 畫面 ─────────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* K 線 Modal */}
      <Modal visible={!!selectedStock} animationType="slide" onRequestClose={() => {
        setSelectedStock(null); setAiText(null); setAiError(null);
      }}>
        <SafeAreaView style={s.modalWrap}>
          <ScrollView>
            <View style={s.modalHeader}>
              <TouchableOpacity style={s.modalClose} onPress={() => {
                setSelectedStock(null); setAiText(null); setAiError(null);
              }}>
                <Text style={s.modalCloseTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={s.modalMeta}>
              <Text style={s.modalName}>{selectedStock?.name}</Text>
              <Text style={s.modalSymbol}>{selectedStock?.symbol}</Text>
              <Text style={s.modalPriceNum}>{selectedStock?.price.toLocaleString()}</Text>
              <Text style={[s.modalPriceChg, { color: tColor(selectedStock?.change ?? 0) }]}>
                {arrow(selectedStock?.change ?? 0)} {Math.abs(selectedStock?.change ?? 0).toFixed(2)}{'  '}
                ({(selectedStock?.changePct ?? 0) >= 0 ? '+' : ''}{(selectedStock?.changePct ?? 0).toFixed(2)}%)
              </Text>
            </View>
            {selectedStock && <KLineChart symbol={selectedStock.symbol} />}

            {/* AI 分析區塊 */}
            <View style={s.aiWrap}>
              {!aiText && !aiLoading && (
                <TouchableOpacity
                  style={s.aiBtn}
                  onPress={async () => {
                    if (!selectedStock) return;
                    setAiLoading(true); setAiText(null); setAiError(null);
                    try {
                      const res = await fetch(`/api/ai-analysis?symbol=${encodeURIComponent(selectedStock.symbol)}`);
                      const json = await res.json();
                      if (json.analysis) setAiText(json.analysis);
                      else setAiError('分析失敗，請稍後再試');
                    } catch {
                      setAiError('連線失敗，請稍後再試');
                    }
                    setAiLoading(false);
                  }}
                >
                  <Text style={s.aiBtnText}>✨ AI 智能分析</Text>
                </TouchableOpacity>
              )}

              {aiLoading && (
                <View style={s.aiLoading}>
                  <ActivityIndicator color="#BF5AF2" />
                  <Text style={s.aiLoadingText}>AI 分析中，請稍候...</Text>
                </View>
              )}

              {aiError && (
                <Text style={s.aiError}>{aiError}</Text>
              )}

              {aiText && (
                <View style={s.aiCard}>
                  <Text style={s.aiCardTitle}>✨ AI 智能分析</Text>
                  <Text style={s.aiCardSub}>由 Gemini 根據技術指標生成，僅供參考</Text>
                  <View style={s.aiDivider} />
                  {aiText.split('\n').filter(l => l.trim()).map((line, i) => {
                    const isHeader = line.startsWith('【');
                    return (
                      <Text key={i} style={isHeader ? s.aiLine : s.aiLineSub}>
                        {line}
                      </Text>
                    );
                  })}
                  <TouchableOpacity onPress={() => { setAiText(null); setAiError(null); }} style={s.aiResetBtn}>
                    <Text style={s.aiResetTxt}>重新分析</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

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
        {marketOpen && <Text style={s.statusSub}>　每 30 秒自動更新</Text>}
        {lastUpdated && <Text style={s.statusUpdated}>　{formatTime(lastUpdated)}</Text>}
      </View>

      {/* ─── 市場 Tab ──────────────────────────────────── */}
      {tab === 'market' && (
        marketLoading
          ? <Center><ActivityIndicator size="large" color="#2C3E50" /><Text style={s.hint}>載入中...</Text></Center>
          : <ScrollView contentContainerStyle={s.scroll}
              refreshControl={<RefreshControl refreshing={isSyncing} tintColor="#2C3E50" onRefresh={triggerSync} />}>
              {indexData   && <IndexCard data={indexData} />}
              {marketStats && <StatsRow stats={marketStats} />}
              <Text style={s.sectionTitle}>重點個股</Text>
              {marketStocks.map(st => <StockCard key={st.symbol} stock={st} onPress={() => setSelectedStock(st)} />)}
              <Text style={s.footer}>資料來源：Yahoo Finance / TWSE</Text>
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
                  refreshControl={<RefreshControl refreshing={isSyncing} tintColor="#2C3E50" onRefresh={triggerSync} />}
                  renderItem={({ item }) => <StockCard stock={item} onPress={() => setSelectedStock(item)} onDelete={() => removeStock(item.symbol)} />}
                />
          }
        </View>
      )}

      {/* ─── 搜尋 + 綜合訊號 Tab ───────────────────────── */}
      {tab === 'search' && (
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: 20 }]} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionTitle}>查詢股票</Text>
          <Text style={s.hint}>台股：輸入代號（2330）或中文名稱（台積電）；美股：輸入英文代號（AAPL）</Text>
          <View style={s.searchRow}>
            <TextInput style={s.searchInput} placeholder="2330 / 台積電 / AAPL"
              placeholderTextColor="#bbb" value={query} onChangeText={handleQueryChange}
              onSubmitEditing={doSearch} autoCapitalize="characters" returnKeyType="search" />
            <TouchableOpacity style={s.searchBtn} onPress={doSearch}>
              <Text style={s.searchBtnText}>查詢</Text>
            </TouchableOpacity>
          </View>

          {suggestions.length > 0 && (
            <View style={s.suggestBox}>
              {suggestions.map(sg => (
                <TouchableOpacity key={sg.code} style={s.suggestItem} onPress={() => {
                  setQuery(sg.name); searchByCode(sg.code);
                }}>
                  <Text style={s.suggestCode}>{sg.code}</Text>
                  <Text style={s.suggestName}>{sg.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {searchLoading && (
            <View style={{ alignItems: 'center', marginTop: 24, gap: 10 }}>
              <ActivityIndicator size="large" color="#2C3E50" />
              <Text style={s.hint}>正在抓取歷史 K 線並計算指標...</Text>
            </View>
          )}
          {searchError && <Text style={s.searchError}>{searchError}</Text>}

          {searchResult && (
            <>
              <StockCard stock={searchResult} onPress={() => setSelectedStock(searchResult)} />

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
    </View>
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

function StockCard({ stock, onPress, onDelete }: { stock: StockItem; onPress?: () => void; onDelete?: () => void }) {
  return (
    <Pressable style={s.stockCard} onPress={onPress} android_ripple={{ color: '#eee' }}>
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
        <TouchableOpacity style={s.deleteBtn} onPress={(e) => { e.stopPropagation?.(); onDelete(); }}>
          <Text style={s.deleteBtnText}>－</Text>
        </TouchableOpacity>
      )}
    </Pressable>
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
  statusUpdated:{ fontSize: 11, color: '#aaa', marginLeft: 'auto', marginRight: 8 },
  refreshBtn:   { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFEFEF', justifyContent: 'center', alignItems: 'center' },
  refreshIcon:  { fontSize: 16, color: '#2C3E50', fontWeight: 'bold' },

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

  modalWrap:     { flex: 1, backgroundColor: '#000' },
  modalHeader:   { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  modalClose:    { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2C2C2E', justifyContent: 'center', alignItems: 'center' },
  modalCloseTxt: { fontSize: 15, color: '#FFF', fontWeight: 'bold' },
  modalMeta:     { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  modalName:     { fontSize: 28, fontWeight: 'bold', color: '#FFF' },
  modalSymbol:   { fontSize: 14, color: '#888', marginTop: 2, marginBottom: 8 },
  modalPriceNum: { fontSize: 36, fontWeight: 'bold', color: '#FFF' },
  modalPriceChg: { fontSize: 15, fontWeight: '500', marginTop: 4 },

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

  suggestBox:  { backgroundColor: 'white', borderRadius: 10, borderWidth: 1, borderColor: '#DDD', overflow: 'hidden', marginBottom: 4 },
  suggestItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', gap: 10 },
  suggestCode: { fontSize: 13, fontWeight: 'bold', color: '#2C3E50', width: 60 },
  suggestName: { fontSize: 14, color: '#555' },

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

  // AI 分析
  aiWrap:       { padding: 16, paddingTop: 0, paddingBottom: 32 },
  aiBtn:        { backgroundColor: '#2D1B69', borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#BF5AF2' },
  aiBtnText:    { color: '#BF5AF2', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  aiLoading:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 20 },
  aiLoadingText:{ color: '#BF5AF2', fontSize: 14 },
  aiError:      { color: '#FF6B6B', textAlign: 'center', paddingVertical: 16, fontSize: 13 },
  aiCard:       { backgroundColor: '#1A0A2E', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#3D1F6B', gap: 8 },
  aiCardTitle:  { fontSize: 16, fontWeight: 'bold', color: '#BF5AF2' },
  aiCardSub:    { fontSize: 11, color: '#666' },
  aiDivider:    { height: 1, backgroundColor: '#2D1B69', marginVertical: 4 },
  aiLine:       { fontSize: 14, color: '#E8E8FF', fontWeight: '600', marginTop: 4 },
  aiLineSub:    { fontSize: 13, color: '#BBB', marginLeft: 4, lineHeight: 20 },
  aiResetBtn:   { marginTop: 8, alignSelf: 'flex-end' },
  aiResetTxt:   { fontSize: 12, color: '#666' },
});
