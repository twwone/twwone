import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// ── 觀察池（台股代表性權值股 + ETF）──────────────────────────
const RADAR_POOL = [
  { symbol: '2330.TW', name: '台積電' },
  { symbol: '2317.TW', name: '鴻海' },
  { symbol: '2454.TW', name: '聯發科' },
  { symbol: '2881.TW', name: '富邦金' },
  { symbol: '2882.TW', name: '國泰金' },
  { symbol: '2891.TW', name: '中信金' },
  { symbol: '2886.TW', name: '兆豐金' },
  { symbol: '3008.TW', name: '大立光' },
  { symbol: '2308.TW', name: '台達電' },
  { symbol: '2303.TW', name: '聯電' },
  { symbol: '2412.TW', name: '中華電' },
  { symbol: '2002.TW', name: '中鋼' },
  { symbol: '0050.TW', name: '元大台灣50' },
  { symbol: '0056.TW', name: '元大高股息' },
  { symbol: '006208.TW', name: '富邦台50' },
];

// ── 常數 ────────────────────────────────────────────────────
const YF         = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

// ── 型別 ────────────────────────────────────────────────────
interface RadarStock {
  symbol: string;
  name:   string;
  price:  number;
  change: number;
  changePct: number;
  ma5:  number;
  ma20: number;
}

// ── 工具函式 ─────────────────────────────────────────────────
function calcMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

const upColor   = (n: number) => (n >= 0 ? '#FF6B6B' : '#4ECDC4');
const arrowChar = (n: number) => (n >= 0 ? '▲' : '▼');

// ── API：抓歷史日K，計算 MA5/MA20，不符合就回傳 null ─────────
async function fetchRadarStock(symbol: string, name: string): Promise<RadarStock | null> {
  try {
    const url = `${YF}/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return null;

    const json   = await res.json();
    const result = json.chart.result[0];
    const m      = result.meta;
    const quote  = result.indicators.quote[0];

    const closes: number[] = (quote.close as (number | null)[])
      .filter((c): c is number => c !== null && !isNaN(c));

    if (closes.length < 21) return null; // 資料不足

    const ma5   = calcMA(closes, 5);
    const ma20  = calcMA(closes, 20);
    const today = closes[closes.length - 1];
    const prev  = closes[closes.length - 2];

    // 過濾條件：MA5 > MA20（多頭排列）且今日收盤 > 昨日收盤（持續上漲）
    if (!(ma5 > ma20 && today > prev)) return null;

    const chg = m.regularMarketPrice - m.previousClose;
    return {
      symbol, name,
      price:     m.regularMarketPrice,
      change:    chg,
      changePct: (chg / m.previousClose) * 100,
      ma5, ma20,
    };
  } catch {
    return null;
  }
}

// ── 主元件 ────────────────────────────────────────────────────
export default function RadarScreen() {
  const [stocks,     setStocks]     = useState<RadarStock[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanned,    setScanned]    = useState(0);

  const scan = async () => {
    setError(null);
    try {
      const results = await Promise.all(
        RADAR_POOL.map(({ symbol, name }) => fetchRadarStock(symbol, name))
      );
      setScanned(RADAR_POOL.length);
      setStocks(results.filter((r): r is RadarStock => r !== null));
    } catch {
      setError('掃描失敗，請確認網路連線後重試');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { scan(); }, []);

  const onRefresh = () => { setRefreshing(true); setScanned(0); scan(); };

  // ── 卡片 ──
  const renderItem = ({ item }: { item: RadarStock }) => (
    <View style={s.card}>
      {/* 左：代號 / 名稱 / 標語 */}
      <View style={s.cardLeft}>
        <View style={s.badge}>
          <Text style={s.badgeText}>強勢</Text>
        </View>
        <Text style={s.cardSymbol}>{item.symbol.replace('.TW', '')}</Text>
        <Text style={s.cardName}>{item.name}</Text>
        <Text style={s.cardTag}>趨勢向上，動能良好</Text>
      </View>

      {/* 右：價格 / 漲跌 / 均線 */}
      <View style={s.cardRight}>
        <Text style={[s.cardPrice, { color: upColor(item.change) }]}>
          {item.price.toLocaleString()}
        </Text>
        <Text style={[s.cardChange, { color: upColor(item.change) }]}>
          {arrowChar(item.change)} {Math.abs(item.change).toFixed(2)}
          {'  '}({item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%)
        </Text>
        <View style={s.maBox}>
          <Text style={s.maLine}>MA5  {item.ma5.toFixed(1)}</Text>
          <Text style={s.maLine}>MA20 {item.ma20.toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      {/* ── Header ── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>🔥 近期強勢股觀望區</Text>
        <Text style={s.headerSub}>自動掃描 · MA5 突破 MA20 · 收盤持續走高</Text>
      </View>

      {/* ── Loading ── */}
      {loading && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F39C12" />
          <Text style={s.loadingTitle}>掃描 {RADAR_POOL.length} 檔股票中...</Text>
          <Text style={s.loadingSub}>正在抓取歷史 K 線並計算 MA5 / MA20</Text>
        </View>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <View style={s.centered}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); scan(); }}>
            <Text style={s.retryText}>重新掃描</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 結果列表 ── */}
      {!loading && !error && (
        <FlatList
          data={stocks}
          keyExtractor={item => item.symbol}
          contentContainerStyle={stocks.length === 0 ? s.emptyWrap : s.listWrap}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F39C12" />
          }
          ListHeaderComponent={
            <View style={s.summaryRow}>
              <Text style={s.summaryText}>
                掃描 {scanned} 檔　·
                <Text style={s.summaryHL}>{stocks.length} 檔符合條件</Text>
              </Text>
              <Text style={s.summaryHint}>下拉重新掃描</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Text style={s.emptyIcon}>📉</Text>
              <Text style={s.emptyTitle}>目前無強勢股</Text>
              <Text style={s.emptySub}>目前所有股票均不符合強勢條件{'\n'}下拉可重新掃描</Text>
            </View>
          }
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

// ── 樣式 ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },

  // Header
  header: {
    backgroundColor: '#0D1B2A',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A5F',
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#F5F5F5' },
  headerSub:   { fontSize: 12, color: '#4A7FA5', marginTop: 4 },

  // Loading / Error center
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  loadingTitle: { fontSize: 16, fontWeight: '600', color: '#E0E0E0' },
  loadingSub:   { fontSize: 13, color: '#4A7FA5' },
  errorText:    { fontSize: 15, color: '#FF6B6B', textAlign: 'center' },
  retryBtn:     { backgroundColor: '#1E3A5F', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText:    { color: '#F39C12', fontWeight: 'bold', fontSize: 15 },

  // Summary bar
  summaryRow:  { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryText: { fontSize: 13, color: '#4A7FA5' },
  summaryHL:   { color: '#F39C12', fontWeight: 'bold' },
  summaryHint: { fontSize: 11, color: '#2C4F6B' },

  // List
  listWrap:  { padding: 12, gap: 10 },
  emptyWrap: { flex: 1 },

  // Empty state
  emptyBox:  { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { fontSize: 52 },
  emptyTitle:{ fontSize: 18, fontWeight: 'bold', color: '#E0E0E0' },
  emptySub:  { fontSize: 13, color: '#4A7FA5', textAlign: 'center', lineHeight: 20 },

  // Card
  card: {
    backgroundColor: '#162535',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  cardLeft:   { flex: 1, gap: 4 },
  cardRight:  { alignItems: 'flex-end', gap: 2 },

  badge:     { backgroundColor: '#F39C1218', borderWidth: 1, borderColor: '#F39C12', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 2 },
  badgeText: { fontSize: 11, color: '#F39C12', fontWeight: 'bold' },

  cardSymbol: { fontSize: 17, fontWeight: 'bold', color: '#F5F5F5' },
  cardName:   { fontSize: 13, color: '#6A9BBF' },
  cardTag:    { fontSize: 11, color: '#F39C12', marginTop: 2 },

  cardPrice:     { fontSize: 22, fontWeight: 'bold' },
  cardChange:    { fontSize: 13, fontWeight: '600', marginTop: 2 },

  maBox:  { marginTop: 8, alignItems: 'flex-end', gap: 2 },
  maLine: { fontSize: 11, color: '#3A6A8A', fontVariant: ['tabular-nums'] },
});
