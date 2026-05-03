import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Holding } from './portfolio';
import { getNameMap, resolveName } from '@/lib/stockNames';

const PORTFOLIO_KEY = '@portfolio_v1';
const CUSTOM_KEY    = '@radar_custom_pool';
const YF            = '/api/stock';

// ── 預設觀察池 ────────────────────────────────────────────────
const DEFAULT_POOL = [
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

// ── 型別 ────────────────────────────────────────────────────
type SignalLevel = '金叉' | '多頭排列' | '強勢' | '觀察中';

interface CustomStock { symbol: string; name: string; }

interface RadarStock {
  symbol:    string;
  name:      string;
  price:     number;
  change:    number;
  changePct: number;
  ma5:       number;
  ma20:      number;
  ma60:      number;
  signal:    SignalLevel;
  score:     number;
}

// ── 信號設定 ──────────────────────────────────────────────────
const SIG: Record<SignalLevel, { tag: string; badgeLabel: string; color: string }> = {
  '金叉':    { tag: 'MA5 剛穿越 MA20', badgeLabel: '金叉突破', color: '#FF6B6B' },
  '多頭排列': { tag: 'MA5 > MA20 > MA60', badgeLabel: '多頭排列', color: '#F39C12' },
  '強勢':    { tag: 'MA5 站上 MA20',     badgeLabel: '強勢',    color: '#4ECDC4' },
  '觀察中':  { tag: '即將突破 MA20',     badgeLabel: '觀察中',  color: '#A29BFE' },
};

// ── 工具 ─────────────────────────────────────────────────────
function calcMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function normalize(s: string): string {
  const t = s.trim().toUpperCase();
  if (t.includes('.')) return t;
  return /^\d+[A-Z]?$/.test(t) ? `${t}.TW` : t;
}

// ── API ──────────────────────────────────────────────────────
async function fetchRadarStock(symbol: string, name: string): Promise<RadarStock | null> {
  try {
    const res    = await fetch(`${YF}?symbol=${encodeURIComponent(symbol)}&interval=1d&range=6mo`);
    if (!res.ok) return null;
    const json   = await res.json();
    const result = json.chart.result?.[0];
    if (!result) return null;
    const m      = result.meta;
    const quote  = result.indicators.quote[0];

    const closes: number[] = (quote.close as (number | null)[])
      .filter((c): c is number => c !== null && !isNaN(c));
    if (closes.length < 62) return null;

    const ma5t  = calcMA(closes, 5);
    const ma5p  = calcMA(closes.slice(0, -1), 5);
    const ma20t = calcMA(closes, 20);
    const ma20p = calcMA(closes.slice(0, -1), 20);
    const ma60t = calcMA(closes, 60);
    const today = closes[closes.length - 1];
    const prev  = closes[closes.length - 2];

    const justCrossed = ma5t > ma20t && ma5p <= ma20p;
    const bullAlign   = ma5t > ma20t && ma20t > ma60t;
    const nearBreak   = ma5t < ma20t && (ma20t - ma5t) / ma20t < 0.01;

    let signal: SignalLevel | null = null;
    let score = 0;

    if (justCrossed) {
      signal = '金叉';
      score  = 85 + (today > prev ? 5 : 0) + (bullAlign ? 5 : 0);
    } else if (bullAlign && today > prev) {
      signal = '多頭排列';
      score  = 75;
    } else if (ma5t > ma20t && today > prev) {
      signal = '強勢';
      score  = 55;
    } else if (nearBreak) {
      signal = '觀察中';
      score  = 30 + Math.round((1 - (ma20t - ma5t) / ma20t / 0.01) * 10);
    }

    if (!signal) return null;

    const chg = m.regularMarketPrice - m.previousClose;
    return {
      symbol, name,
      price:     m.regularMarketPrice,
      change:    chg,
      changePct: (chg / m.previousClose) * 100,
      ma5: ma5t, ma20: ma20t, ma60: ma60t,
      signal, score,
    };
  } catch { return null; }
}

async function fetchStockName(symbol: string): Promise<string | null> {
  try {
    const res  = await fetch(`${YF}?symbol=${encodeURIComponent(symbol)}`);
    const json = await res.json();
    return json.chart.result?.[0]?.meta?.shortName ?? null;
  } catch { return null; }
}

// ── 主元件 ────────────────────────────────────────────────────
export default function RadarScreen() {
  const [stocks,       setStocks]       = useState<RadarStock[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [scanned,      setScanned]      = useState(0);
  const [customPool,   setCustomPool]   = useState<CustomStock[]>([]);
  const [showManage,   setShowManage]   = useState(false);
  const [newSymbol,    setNewSymbol]    = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [nameMap,      setNameMap]      = useState<Record<string, string>>({});

  // 加入庫存 modal
  const [addTarget, setAddTarget] = useState<{ symbol: string; name: string } | null>(null);
  const [pLots,     setPLots]     = useState('');
  const [pUnit,     setPUnit]     = useState<'張' | '股'>('張');
  const [pCost,     setPCost]     = useState('');
  const [pDate,     setPDate]     = useState('');
  const [pSaving,   setPSaving]   = useState(false);

  const scan = async (custom?: CustomStock[]) => {
    const pool = [
      ...DEFAULT_POOL,
      ...(custom ?? customPool).filter(c => !DEFAULT_POOL.some(d => d.symbol === c.symbol)),
    ];
    setError(null);
    try {
      const results = await Promise.all(pool.map(({ symbol, name }) => fetchRadarStock(symbol, name)));
      setScanned(pool.length);
      setStocks(
        results
          .filter((r): r is RadarStock => r !== null)
          .sort((a, b) => b.score - a.score)
      );
    } catch {
      setError('掃描失敗，請確認網路連線後重試');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadFromServer = useCallback(async (silent = false) => {
    try {
      const res = await fetch('/api/settings', { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.radarCustomPool)) return;
      const serverUpdatedAt: number = data.radarCustomPoolUpdatedAt ?? 0;
      // 比對本地時戳，本地較新時不覆蓋
      let localUpdatedAt = 0;
      try {
        const raw = await AsyncStorage.getItem(CUSTOM_KEY);
        if (raw) { const parsed = JSON.parse(raw); localUpdatedAt = parsed.updatedAt ?? 0; }
      } catch {}
      if (serverUpdatedAt < localUpdatedAt) return;
      const serverCustom: CustomStock[] = data.radarCustomPool;
      setCustomPool(serverCustom);
      await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify({ pool: serverCustom, updatedAt: serverUpdatedAt }));
      if (!silent) scan(serverCustom);
    } catch {}
  }, []);

  const initialized = useRef(false);

  useEffect(() => {
    getNameMap().then(setNameMap);
    (async () => {
      let custom: CustomStock[] = [];
      try {
        const raw = await AsyncStorage.getItem(CUSTOM_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          custom = Array.isArray(parsed) ? parsed : (parsed.pool ?? []);
          setCustomPool(custom);
        }
      } catch {}
      scan(custom);
      await loadFromServer();
      initialized.current = true;
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    if (!initialized.current) return;
    loadFromServer(true);
  }, [loadFromServer]));

  const onRefresh = () => { setRefreshing(true); setScanned(0); scan(); };

  const syncCustomPoolToServer = (pool: CustomStock[], updatedAt: number) => {
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ radarCustomPool: pool, radarCustomPoolUpdatedAt: updatedAt }),
    }).catch(() => {});
  };

  const addCustomStock = async () => {
    const symbol = normalize(newSymbol);
    if (!symbol) return;
    if (DEFAULT_POOL.some(d => d.symbol === symbol) || customPool.some(c => c.symbol === symbol)) {
      Alert.alert('已存在', `${symbol} 已在觀察清單中`);
      return;
    }
    setAddingCustom(true);
    const yahooName = await fetchStockName(symbol);
    setAddingCustom(false);
    if (!yahooName) { Alert.alert('找不到', `請確認代號「${newSymbol}」是否正確`); return; }
    const map  = await getNameMap();
    const name = resolveName(symbol, map, yahooName);
    const next = [...customPool, { symbol, name }];
    const ts   = Date.now();
    setCustomPool(next);
    await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify({ pool: next, updatedAt: ts }));
    syncCustomPoolToServer(next, ts);
    setNewSymbol('');
  };

  const removeCustomStock = async (symbol: string) => {
    const next = customPool.filter(c => c.symbol !== symbol);
    const ts   = Date.now();
    setCustomPool(next);
    await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify({ pool: next, updatedAt: ts }));
    syncCustomPoolToServer(next, ts);
  };

  const saveToPortfolio = async () => {
    const lots = parseFloat(pLots);
    const cost = parseFloat(pCost);
    if (!addTarget || isNaN(lots) || lots <= 0 || isNaN(cost) || cost <= 0) {
      Alert.alert('請填寫完整', '數量、成本價為必填');
      return;
    }
    setPSaving(true);
    try {
      const raw = await AsyncStorage.getItem(PORTFOLIO_KEY);
      let existing: Holding[] = [];
      if (raw) {
        const parsed = JSON.parse(raw);
        existing = Array.isArray(parsed) ? parsed : (parsed.holdings ?? []);
      }
      const h: Holding = {
        id: Date.now().toString(),
        symbol: addTarget.symbol, name: resolveName(addTarget.symbol, nameMap, addTarget.name),
        lots, unit: pUnit, costPrice: cost, buyDate: pDate.trim(),
      };
      const next = [...existing, h];
      const updatedAt = Date.now();
      await AsyncStorage.setItem(PORTFOLIO_KEY, JSON.stringify({ holdings: next, updatedAt }));
      // 同步到伺服器
      fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings: next, updatedAt }),
      }).catch(() => {});
      Alert.alert('已加入庫存', `${addTarget.name} 已成功加入持股`);
      setAddTarget(null);
      setPLots(''); setPUnit('張'); setPCost(''); setPDate('');
    } catch {
      Alert.alert('儲存失敗', '請重試');
    } finally {
      setPSaving(false);
    }
  };

  // ── 卡片 ──
  const renderItem = ({ item }: { item: RadarStock }) => {
    const sig    = SIG[item.signal];
    const isUp   = item.change >= 0;
    const pColor = isUp ? '#FF6B6B' : '#4ECDC4';
    return (
      <View style={[s.card, { borderColor: sig.color + '44' }]}>
        <View style={s.cardTopRow}>
          <View style={[s.badge, { borderColor: sig.color, backgroundColor: sig.color + '22' }]}>
            <Text style={[s.badgeText, { color: sig.color }]}>{sig.badgeLabel}</Text>
          </View>
          <View style={s.scoreBadge}>
            <Text style={s.scoreText}>分數 {item.score}</Text>
          </View>
        </View>
        <View style={s.cardBody}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.cardSymbol}>{item.symbol.replace('.TW', '')}</Text>
            <Text style={s.cardName}>{resolveName(item.symbol, nameMap, item.name)}</Text>
            <Text style={[s.cardTag, { color: sig.color }]}>{sig.tag}</Text>
          </View>
          <View style={s.cardRight}>
            <Text style={[s.cardPrice, { color: pColor }]}>{item.price.toLocaleString()}</Text>
            <Text style={[s.cardChange, { color: pColor }]}>
              {isUp ? '▲' : '▼'} {Math.abs(item.change).toFixed(2)}{'  '}
              {isUp ? '+' : ''}{item.changePct.toFixed(2)}%
            </Text>
            <View style={s.maBox}>
              <Text style={s.maLine}>MA5　 {item.ma5.toFixed(1)}</Text>
              <Text style={s.maLine}>MA20  {item.ma20.toFixed(1)}</Text>
              <Text style={s.maLine}>MA60  {item.ma60.toFixed(1)}</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity
          style={[s.addBtn, { borderColor: sig.color + '66' }]}
          onPress={() => setAddTarget({ symbol: item.symbol, name: item.name })}
        >
          <Text style={[s.addBtnText, { color: sig.color }]}>＋ 加入庫存</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <Text style={s.headerTitle}>強勢雷達</Text>
          <TouchableOpacity style={s.manageBtn} onPress={() => setShowManage(true)}>
            <Text style={s.manageBtnText}>管理清單</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.headerSub}>自動掃描 · 金叉 / 多頭排列 / 強勢 / 觀察中 · 依分數排序</Text>
      </View>

      {loading && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F39C12" />
          <Text style={s.loadingTitle}>掃描 {DEFAULT_POOL.length + customPool.length} 檔股票中...</Text>
          <Text style={s.loadingSub}>計算 MA5 / MA20 / MA60 信號中</Text>
        </View>
      )}

      {!loading && error && (
        <View style={s.centered}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); scan(); }}>
            <Text style={s.retryText}>重新掃描</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={stocks}
          keyExtractor={item => item.symbol}
          contentContainerStyle={stocks.length === 0 ? s.emptyWrap : s.listWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F39C12" />}
          ListHeaderComponent={
            <View style={s.summaryRow}>
              <Text style={s.summaryText}>
                掃描 {scanned} 檔　·　<Text style={s.summaryHL}>{stocks.length} 檔符合條件</Text>
              </Text>
              <Text style={s.summaryHint}>下拉重新掃描</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Text style={s.emptyIcon}>📉</Text>
              <Text style={s.emptyTitle}>目前無符合條件</Text>
              <Text style={s.emptySub}>所有股票均不符合篩選條件{'\n'}下拉可重新掃描</Text>
            </View>
          }
          renderItem={renderItem}
        />
      )}

      {/* ── 管理觀察清單 Modal ── */}
      <Modal visible={showManage} animationType="slide" transparent onRequestClose={() => setShowManage(false)}>
        <View style={s.overlay}>
          <View style={[s.modalBox, { paddingBottom: 32 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>觀察清單管理</Text>
              <TouchableOpacity onPress={() => { setShowManage(false); setNewSymbol(''); }}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.manageSection}>預設（{DEFAULT_POOL.length} 檔，不可刪）</Text>
            <Text style={s.manageDefaultList}>
              {DEFAULT_POOL.map(d => d.symbol.replace('.TW', '')).join('　')}
            </Text>

            {customPool.length > 0 && (
              <>
                <Text style={s.manageSection}>自訂（{customPool.length} 檔）</Text>
                <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                  {customPool.map(c => (
                    <View key={c.symbol} style={s.manageRow}>
                      <Text style={s.manageSymbol}>{c.symbol.replace('.TW', '')}</Text>
                      <Text style={s.manageName}>{resolveName(c.symbol, nameMap, c.name)}</Text>
                      <TouchableOpacity onPress={() => removeCustomStock(c.symbol)}>
                        <Text style={s.manageDelete}>刪除</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={s.manageSection}>新增自訂股票</Text>
            <View style={s.manageAddRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="代號 (2330 / AAPL)"
                placeholderTextColor="#3A6A8A"
                value={newSymbol}
                onChangeText={setNewSymbol}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[s.manageAddBtn, addingCustom && { opacity: 0.5 }]}
                onPress={addCustomStock}
                disabled={addingCustom}
              >
                {addingCustom
                  ? <ActivityIndicator size="small" color="#0D1B2A" />
                  : <Text style={s.manageAddBtnText}>新增</Text>
                }
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.confirmBtn} onPress={() => {
              setShowManage(false);
              setNewSymbol('');
              setLoading(true);
              setScanned(0);
              scan(customPool);
            }}>
              <Text style={s.confirmBtnText}>儲存並重新掃描</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 加入庫存 Modal ── */}
      <Modal visible={addTarget !== null} animationType="slide" transparent onRequestClose={() => setAddTarget(null)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>加入庫存</Text>
                {addTarget && (
                  <Text style={s.modalSubtitle}>
                    {addTarget.symbol.replace('.TW', '')}　·　{resolveName(addTarget.symbol, nameMap, addTarget.name)}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setAddTarget(null)}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={s.labelRow}>
              <Text style={s.label}>數量</Text>
              <View style={s.unitToggle}>
                {(['張', '股'] as const).map(u => (
                  <TouchableOpacity key={u} style={[s.unitBtn, pUnit === u && s.unitBtnActive]} onPress={() => setPUnit(u)}>
                    <Text style={[s.unitBtnText, pUnit === u && s.unitBtnTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TextInput style={s.input} placeholder={pUnit === '張' ? '2' : '100'}
              placeholderTextColor="#3A6A8A" value={pLots} onChangeText={setPLots} keyboardType="numeric" />

            <Text style={s.label}>成本價（每股，元）</Text>
            <TextInput style={s.input} placeholder="985.00"
              placeholderTextColor="#3A6A8A" value={pCost} onChangeText={setPCost} keyboardType="decimal-pad" />

            <Text style={s.label}>買進日期（選填）</Text>
            <TextInput style={s.input} placeholder="2026-04-15"
              placeholderTextColor="#3A6A8A" value={pDate} onChangeText={setPDate} />

            <TouchableOpacity
              style={[s.confirmBtn, pSaving && { opacity: 0.5 }]}
              onPress={saveToPortfolio}
              disabled={pSaving}
            >
              {pSaving
                ? <ActivityIndicator size="small" color="#0D1B2A" />
                : <Text style={s.confirmBtnText}>確認加入庫存</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── 樣式 ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1B2A' },

  header:     { backgroundColor: '#0D1B2A', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  headerTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle:{ fontSize: 22, fontWeight: 'bold', color: '#F5F5F5' },
  headerSub:  { fontSize: 12, color: '#4A7FA5', marginTop: 4 },
  manageBtn:  { backgroundColor: '#1E3A5F', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  manageBtnText: { fontSize: 13, color: '#F39C12', fontWeight: '600' },

  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  loadingTitle: { fontSize: 16, fontWeight: '600', color: '#E0E0E0' },
  loadingSub:   { fontSize: 13, color: '#4A7FA5' },
  errorText:    { fontSize: 15, color: '#FF6B6B', textAlign: 'center' },
  retryBtn:     { backgroundColor: '#1E3A5F', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText:    { color: '#F39C12', fontWeight: 'bold', fontSize: 15 },

  summaryRow:  { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryText: { fontSize: 13, color: '#4A7FA5' },
  summaryHL:   { color: '#F39C12', fontWeight: 'bold' },
  summaryHint: { fontSize: 11, color: '#2C4F6B' },

  listWrap:  { padding: 12, gap: 10 },
  emptyWrap: { flex: 1 },
  emptyBox:  { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: { fontSize: 52 },
  emptyTitle:{ fontSize: 18, fontWeight: 'bold', color: '#E0E0E0' },
  emptySub:  { fontSize: 13, color: '#4A7FA5', textAlign: 'center', lineHeight: 20 },

  // Card
  card:       { backgroundColor: '#162535', borderRadius: 16, padding: 16, borderWidth: 1, gap: 10 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardBody:   { flexDirection: 'row', alignItems: 'flex-start' },
  cardRight:  { alignItems: 'flex-end', gap: 2 },

  badge:     { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: 'bold' },
  scoreBadge:{ backgroundColor: '#1E3A5F', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  scoreText: { fontSize: 11, color: '#4A7FA5', fontWeight: '600' },

  cardSymbol: { fontSize: 17, fontWeight: 'bold', color: '#F5F5F5' },
  cardName:   { fontSize: 13, color: '#6A9BBF' },
  cardTag:    { fontSize: 11, marginTop: 2 },
  cardPrice:  { fontSize: 22, fontWeight: 'bold' },
  cardChange: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  maBox:      { marginTop: 8, alignItems: 'flex-end', gap: 2 },
  maLine:     { fontSize: 11, color: '#3A6A8A', fontVariant: ['tabular-nums'] },

  addBtn:     { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  addBtnText: { fontSize: 13, fontWeight: '700' },

  // Modals
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:      { backgroundColor: '#0D1B2A', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8, borderTopWidth: 1, borderColor: '#1E3A5F' },
  modalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle:    { fontSize: 18, fontWeight: 'bold', color: '#F5F5F5' },
  modalSubtitle: { fontSize: 12, color: '#4A7FA5', marginTop: 2 },
  modalClose:    { fontSize: 18, color: '#4A7FA5', fontWeight: 'bold' },
  label:         { fontSize: 13, color: '#4A7FA5', fontWeight: '600', marginTop: 4 },
  labelRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  unitToggle:    { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#F39C12' },
  unitBtn:       { paddingHorizontal: 14, paddingVertical: 4, backgroundColor: '#162535' },
  unitBtnActive: { backgroundColor: '#F39C12' },
  unitBtnText:   { fontSize: 13, color: '#F39C12', fontWeight: '600' },
  unitBtnTextActive: { color: '#0D1B2A' },
  input:         { backgroundColor: '#162535', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#F5F5F5', borderWidth: 1, borderColor: '#1E3A5F' },
  confirmBtn:    { backgroundColor: '#F39C12', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  confirmBtnText:{ color: '#0D1B2A', fontSize: 16, fontWeight: 'bold' },

  // Manage modal
  manageSection:     { fontSize: 12, color: '#4A7FA5', fontWeight: '600', marginTop: 8 },
  manageDefaultList: { fontSize: 12, color: '#3A6A8A', lineHeight: 20 },
  manageRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E3A5F', gap: 10 },
  manageSymbol:      { fontSize: 14, fontWeight: 'bold', color: '#F5F5F5', width: 52 },
  manageName:        { fontSize: 13, color: '#6A9BBF', flex: 1 },
  manageDelete:      { fontSize: 12, color: '#FF6B6B', fontWeight: '600' },
  manageAddRow:      { flexDirection: 'row', gap: 8, alignItems: 'center' },
  manageAddBtn:      { backgroundColor: '#F39C12', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  manageAddBtnText:  { color: '#0D1B2A', fontWeight: 'bold', fontSize: 14 },
});
