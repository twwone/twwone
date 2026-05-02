import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';

const STORAGE_KEY = '@portfolio_v1';
const YF          = '/api/stock';

// ── 型別 ──────────────────────────────────────────────────
export interface Holding {
  id:        string;
  symbol:    string;
  name:      string;
  lots:      number;
  unit:      '張' | '股';
  costPrice: number;
  buyDate:   string;
}

interface HoldingWithPrice extends Holding {
  currentPrice: number;
  pnl:          number;
  pnlPct:       number;
  days:         number;
}

interface GroupedHolding {
  symbol:          string;
  name:            string;
  currentPrice:    number;
  transactions:    HoldingWithPrice[];
  totalCost:       number;
  totalValue:      number;
  totalPnl:        number;
  totalPnlPct:     number;
  quantitySummary: string;
}

// ── 工具 ──────────────────────────────────────────────────
function normalize(s: string): string {
  const t = s.trim().toUpperCase();
  if (t.includes('.')) return t;
  return /^\d+$/.test(t) ? `${t}.TW` : t;
}

function holdingDays(buyDate: string): number {
  if (!buyDate) return 0;
  return Math.floor((Date.now() - new Date(buyDate).getTime()) / 86400000);
}

const tColor = (n: number) => (n >= 0 ? '#E74C3C' : '#27AE60');
const sign   = (n: number) => (n >= 0 ? '+' : '');

async function fetchPrice(symbol: string): Promise<{ price: number; name: string } | null> {
  try {
    const res  = await fetch(`${YF}?symbol=${encodeURIComponent(symbol)}`);
    const json = await res.json();
    const m    = json.chart.result[0].meta;
    return { price: m.regularMarketPrice, name: m.shortName ?? symbol };
  } catch { return null; }
}

interface StoredPortfolio { holdings: Holding[]; updatedAt: number; }

async function loadHoldings(): Promise<StoredPortfolio> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { holdings: [], updatedAt: 0 };
    const parsed = JSON.parse(raw);
    // 向下相容：舊格式是純陣列
    if (Array.isArray(parsed)) return { holdings: parsed, updatedAt: 0 };
    return parsed as StoredPortfolio;
  } catch { return { holdings: [], updatedAt: 0 }; }
}

async function saveHoldings(list: Holding[]): Promise<number> {
  const updatedAt = Date.now();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ holdings: list, updatedAt }));
  syncToServer(list, updatedAt); // 背景同步，不等待
  return updatedAt;
}

async function syncToServer(holdings: Holding[], updatedAt: number): Promise<void> {
  try {
    await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings, updatedAt }),
    });
  } catch {} // 本地已存成功，雲端失敗靜默處理
}

async function fetchServerPortfolio(): Promise<StoredPortfolio | null> {
  try {
    const res = await fetch('/api/portfolio');
    if (!res.ok) return null;
    return await res.json() as StoredPortfolio;
  } catch { return null; }
}

async function fetchAllPrices(list: Holding[]): Promise<Record<string, number>> {
  if (!list.length) return {};
  const results = await Promise.all(list.map(h => fetchPrice(h.symbol)));
  const map: Record<string, number> = {};
  list.forEach((h, i) => { if (results[i]) map[h.symbol] = results[i]!.price; });
  return map;
}

// ── 主畫面 ────────────────────────────────────────────────
export default function PortfolioScreen() {
  const [holdings,       setHoldings]       = useState<Holding[]>([]);
  const [priceMap,       setPriceMap]       = useState<Record<string, number>>({});
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [showModal,      setShowModal]      = useState(false);
  const [adding,         setAdding]         = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const [fSymbol,  setFSymbol]  = useState('');
  const [fLots,    setFLots]    = useState('');
  const [fUnit,    setFUnit]    = useState<'張' | '股'>('張');
  const [fCost,    setFCost]    = useState('');
  const [fBuyDate, setFBuyDate] = useState('');

  const loadAll = async () => {
    // 先載入本地（快）
    const local = await loadHoldings();
    setHoldings(local.holdings);

    // 並行：抓雲端資料 + 抓本地持股的即時報價
    const [serverData, priceMap] = await Promise.all([
      fetchServerPortfolio(),
      fetchAllPrices(local.holdings),
    ]);
    setPriceMap(priceMap);

    // 雲端有更新的資料 → 覆蓋本地並重抓報價
    if (serverData && serverData.updatedAt > local.updatedAt && serverData.holdings.length >= 0) {
      setHoldings(serverData.holdings);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serverData));
      const serverPrices = await fetchAllPrices(serverData.holdings);
      setPriceMap(serverPrices);
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { loadAll(); }, []);

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const addHolding = async () => {
    const symbol = normalize(fSymbol);
    const lots   = parseFloat(fLots);
    const cost   = parseFloat(fCost);
    if (!symbol || isNaN(lots) || lots <= 0 || isNaN(cost) || cost <= 0) {
      Alert.alert('請填寫完整', '股票代號、張數、成本價為必填');
      return;
    }
    setAdding(true);
    const info = await fetchPrice(symbol);
    if (!info) {
      Alert.alert('找不到此股票', `請確認代號「${symbol}」是否正確`);
      setAdding(false);
      return;
    }
    const h: Holding = {
      id: Date.now().toString(), symbol,
      name: info.name, lots, unit: fUnit, costPrice: cost, buyDate: fBuyDate.trim(),
    };
    const next = [...holdings, h];
    setHoldings(next);
    setPriceMap(prev => ({ ...prev, [symbol]: info.price }));
    await saveHoldings(next);
    setAdding(false);
    setShowModal(false);
    setFSymbol(''); setFLots(''); setFUnit('張'); setFCost(''); setFBuyDate('');
  };

  const removeHolding = (id: string) => {
    Alert.alert('刪除持股', '確定要刪除這筆紀錄？', [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: async () => {
        const next = holdings.filter(h => h.id !== id);
        setHoldings(next);
        await saveHoldings(next);
        if (selectedSymbol && !next.some(h => h.symbol === selectedSymbol)) {
          setSelectedSymbol(null);
        }
      }},
    ]);
  };

  // 加入即時價格
  const enriched: HoldingWithPrice[] = holdings.map(h => {
    const cur    = priceMap[h.symbol] ?? h.costPrice;
    const mul    = (h.unit ?? '張') === '張' ? 1000 : 1;
    const pnl    = (cur - h.costPrice) * h.lots * mul;
    const pnlPct = ((cur - h.costPrice) / h.costPrice) * 100;
    return { ...h, currentPrice: cur, pnl, pnlPct, days: holdingDays(h.buyDate) };
  });

  const totalCost  = enriched.reduce((a, h) => { const mul = (h.unit ?? '張') === '張' ? 1000 : 1; return a + h.costPrice    * h.lots * mul; }, 0);
  const totalValue = enriched.reduce((a, h) => { const mul = (h.unit ?? '張') === '張' ? 1000 : 1; return a + h.currentPrice * h.lots * mul; }, 0);
  const totalPnl   = totalValue - totalCost;
  const totalPct   = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // 依股票代號合併
  const grouped: GroupedHolding[] = (() => {
    const map: Record<string, HoldingWithPrice[]> = {};
    for (const h of enriched) {
      if (!map[h.symbol]) map[h.symbol] = [];
      map[h.symbol].push(h);
    }
    return Object.entries(map).map(([symbol, txs]) => {
      const tCost  = txs.reduce((a, h) => a + h.costPrice * h.lots * ((h.unit ?? '張') === '張' ? 1000 : 1), 0);
      const tValue = txs.reduce((a, h) => a + h.currentPrice * h.lots * ((h.unit ?? '張') === '張' ? 1000 : 1), 0);
      const tPnl   = tValue - tCost;
      const tPct   = tCost > 0 ? (tPnl / tCost) * 100 : 0;
      const 張lots  = txs.filter(h => (h.unit ?? '張') === '張').reduce((a, h) => a + h.lots, 0);
      const 股lots  = txs.filter(h => h.unit === '股').reduce((a, h) => a + h.lots, 0);
      const parts: string[] = [];
      if (張lots > 0) parts.push(`${張lots}張`);
      if (股lots > 0) parts.push(`${股lots}股`);
      return {
        symbol, name: txs[0].name, currentPrice: txs[0].currentPrice,
        transactions: [...txs].sort((a, b) => (a.buyDate || '') < (b.buyDate || '') ? -1 : 1),
        totalCost: tCost, totalValue: tValue, totalPnl: tPnl, totalPnlPct: tPct,
        quantitySummary: parts.join(' + ') || '0',
      };
    });
  })();

  const selectedGroup = grouped.find(g => g.symbol === selectedSymbol) ?? null;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>我的庫存</Text>
        {enriched.length > 0 && (
          <Text style={[s.headerPnl, { color: tColor(totalPnl) }]}>
            {sign(totalPnl)}{Math.round(totalPnl).toLocaleString()} 元
            ({sign(totalPct)}{totalPct.toFixed(2)}%)
          </Text>
        )}
      </View>

      {loading
        ? <View style={s.centered}><ActivityIndicator size="large" color="#2C3E50" /></View>
        : <FlatList
            data={grouped}
            keyExtractor={g => g.symbol}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={refreshing} tintColor="#2C3E50" onRefresh={onRefresh} />}
            ListHeaderComponent={
              <>
                {enriched.length > 0 && (
                  <View style={s.overviewCard}>
                    <View style={s.overviewRow}>
                      <OverviewItem label="持倉成本" value={`${Math.round(totalCost / 1000)}K`} />
                      <OverviewItem label="目前市值" value={`${Math.round(totalValue / 1000)}K`} />
                      <OverviewItem label="未實現損益"
                        value={`${sign(totalPnl)}${Math.round(totalPnl).toLocaleString()}`}
                        color={tColor(totalPnl)} />
                    </View>
                  </View>
                )}
                <TouchableOpacity style={s.addBtn} onPress={() => setShowModal(true)}>
                  <Text style={s.addBtnText}>＋ 新增持股</Text>
                </TouchableOpacity>
              </>
            }
            ListEmptyComponent={
              <View style={s.centered}>
                <Text style={s.hint}>尚無持股紀錄{'\n'}點上方按鈕新增第一筆</Text>
              </View>
            }
            renderItem={({ item: g }) => (
              <TouchableOpacity
                style={[s.card, { borderLeftColor: tColor(g.totalPnl) }]}
                onPress={() => setSelectedSymbol(g.symbol)}
                activeOpacity={0.75}
              >
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardName}>{g.name}</Text>
                    <Text style={s.cardMeta}>
                      {g.symbol.replace('.TW', '')}　·　{g.quantitySummary}
                      {g.transactions.length > 1 ? `　·　${g.transactions.length} 筆` : ''}
                    </Text>
                  </View>
                  <View style={s.cardRight}>
                    <Text style={[s.cardPrice, { color: tColor(g.totalPnl) }]}>
                      {g.currentPrice.toLocaleString()}
                    </Text>
                    <Text style={[s.cardPct, { color: tColor(g.totalPnl) }]}>
                      {sign(g.totalPnlPct)}{g.totalPnlPct.toFixed(2)}%
                    </Text>
                  </View>
                </View>
                <View style={s.cardBottom}>
                  <Text style={s.cardCost}>成本 {Math.round(g.totalCost).toLocaleString()}</Text>
                  <Text style={[s.cardPnl, { color: tColor(g.totalPnl) }]}>
                    {sign(g.totalPnl)}{Math.round(g.totalPnl).toLocaleString()} 元
                  </Text>
                  <Text style={s.cardArrow}>›</Text>
                </View>
              </TouchableOpacity>
            )}
          />
      }

      {/* ── 交易明細 Modal ── */}
      <Modal visible={selectedSymbol !== null} animationType="slide" transparent onRequestClose={() => setSelectedSymbol(null)}>
        <View style={s.overlay}>
          <View style={[s.modalBox, { paddingBottom: 32 }]}>
            {selectedGroup && (
              <>
                <View style={s.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.modalTitle}>{selectedGroup.name}</Text>
                    <Text style={s.detailSubtitle}>
                      {selectedGroup.symbol.replace('.TW', '')}　·　{selectedGroup.quantitySummary}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedSymbol(null)}>
                    <Text style={s.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.detailSummaryRow}>
                  <View>
                    <Text style={s.detailSummaryLabel}>現價</Text>
                    <Text style={s.detailSummaryVal}>{selectedGroup.currentPrice.toLocaleString()}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.detailSummaryLabel}>未實現損益</Text>
                    <Text style={[s.detailSummaryPnl, { color: tColor(selectedGroup.totalPnl) }]}>
                      {sign(selectedGroup.totalPnlPct)}{selectedGroup.totalPnlPct.toFixed(2)}%
                      （{sign(selectedGroup.totalPnl)}{Math.round(selectedGroup.totalPnl).toLocaleString()}）
                    </Text>
                  </View>
                </View>

                <Text style={s.detailSectionTitle}>交易紀錄</Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {selectedGroup.transactions.map((tx, i) => (
                    <View key={tx.id} style={[s.txRow, i < selectedGroup.transactions.length - 1 && s.txRowBorder]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.txDate}>{tx.buyDate || '未填日期'}</Text>
                        <Text style={s.txQty}>{tx.lots} {tx.unit ?? '張'}　@　{tx.costPrice.toLocaleString()}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[s.txPnl, { color: tColor(tx.pnl) }]}>
                          {sign(tx.pnl)}{Math.round(tx.pnl).toLocaleString()}
                        </Text>
                        <TouchableOpacity onPress={() => removeHolding(tx.id)}>
                          <Text style={s.deleteBtn}>刪除</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </ScrollView>

                <TouchableOpacity style={s.confirmBtn} onPress={() => {
                  setSelectedSymbol(null);
                  setFSymbol(selectedGroup.symbol.replace('.TW', ''));
                  setShowModal(true);
                }}>
                  <Text style={s.confirmBtnText}>＋ 再次買進</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── 新增持股 Modal ── */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>新增持股</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.label}>股票代號</Text>
            <TextInput style={s.input} placeholder="2330 / 0050 / AAPL"
              placeholderTextColor="#bbb" value={fSymbol} onChangeText={setFSymbol}
              autoCapitalize="characters" />

            <View style={s.labelRow}>
              <Text style={s.label}>數量</Text>
              <View style={s.unitToggle}>
                {(['張', '股'] as const).map(u => (
                  <TouchableOpacity key={u} style={[s.unitBtn, fUnit === u && s.unitBtnActive]} onPress={() => setFUnit(u)}>
                    <Text style={[s.unitBtnText, fUnit === u && s.unitBtnTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TextInput style={s.input} placeholder={fUnit === '張' ? '2' : '100'}
              placeholderTextColor="#bbb" value={fLots} onChangeText={setFLots} keyboardType="numeric" />

            <Text style={s.label}>成本價（每股，元）</Text>
            <TextInput style={s.input} placeholder="985.00" placeholderTextColor="#bbb"
              value={fCost} onChangeText={setFCost} keyboardType="decimal-pad" />

            <Text style={s.label}>買進日期（選填）</Text>
            <TextInput style={s.input} placeholder="2026-04-15" placeholderTextColor="#bbb"
              value={fBuyDate} onChangeText={setFBuyDate} />

            <TouchableOpacity
              style={[s.confirmBtn, adding && s.confirmBtnOff]}
              onPress={addHolding}
              disabled={adding}
            >
              {adding
                ? <ActivityIndicator size="small" color="white" />
                : <Text style={s.confirmBtnText}>確認新增</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function OverviewItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.overviewItem}>
      <Text style={s.overviewLabel}>{label}</Text>
      <Text style={[s.overviewValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

// ── 樣式 ─────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  header:    { backgroundColor: '#2C3E50', paddingVertical: 16, paddingHorizontal: 20, gap: 3 },
  headerTitle:{ fontSize: 20, fontWeight: 'bold', color: 'white' },
  headerPnl:  { fontSize: 13, fontWeight: '600' },
  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  hint:       { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 22 },
  list:       { padding: 16, gap: 12, paddingBottom: 40 },

  overviewCard: { backgroundColor: 'white', borderRadius: 14, padding: 16, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  overviewRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  overviewItem: { alignItems: 'center', flex: 1 },
  overviewLabel:{ fontSize: 11, color: '#999', marginBottom: 4 },
  overviewValue:{ fontSize: 15, fontWeight: 'bold', color: '#2C3E50' },

  addBtn:     { backgroundColor: '#2C3E50', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  addBtnText: { color: 'white', fontSize: 15, fontWeight: 'bold' },

  card:       { backgroundColor: 'white', borderRadius: 14, padding: 14, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, gap: 8 },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start' },
  cardName:   { fontSize: 16, fontWeight: 'bold', color: '#2C3E50' },
  cardMeta:   { fontSize: 12, color: '#999', marginTop: 3 },
  cardRight:  { alignItems: 'flex-end' },
  cardPrice:  { fontSize: 20, fontWeight: 'bold' },
  cardPct:    { fontSize: 13, fontWeight: '600', marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardCost:   { fontSize: 12, color: '#888' },
  cardPnl:    { fontSize: 14, fontWeight: 'bold', flex: 1 },
  cardArrow:  { fontSize: 20, color: '#ccc' },

  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:   { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8 },
  modalHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2C3E50' },
  modalClose: { fontSize: 18, color: '#aaa', fontWeight: 'bold' },
  label:      { fontSize: 13, color: '#555', fontWeight: '600', marginTop: 4 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  unitToggle: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#2C3E50' },
  unitBtn:    { paddingHorizontal: 14, paddingVertical: 4, backgroundColor: 'white' },
  unitBtnActive: { backgroundColor: '#2C3E50' },
  unitBtnText:   { fontSize: 13, color: '#2C3E50', fontWeight: '600' },
  unitBtnTextActive: { color: 'white' },
  input:      { backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#333', borderWidth: 1, borderColor: '#EEE' },
  confirmBtn:    { backgroundColor: '#2C3E50', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  confirmBtnOff: { backgroundColor: '#95A5A6' },
  confirmBtnText:{ color: 'white', fontSize: 16, fontWeight: 'bold' },

  detailSubtitle:     { fontSize: 12, color: '#999', marginTop: 2 },
  detailSummaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', backgroundColor: '#F8F9FA', borderRadius: 12, padding: 14 },
  detailSummaryLabel: { fontSize: 11, color: '#999', marginBottom: 3 },
  detailSummaryVal:   { fontSize: 22, fontWeight: 'bold', color: '#2C3E50' },
  detailSummaryPnl:   { fontSize: 14, fontWeight: '700' },
  detailSectionTitle: { fontSize: 12, color: '#aaa', fontWeight: '600', marginTop: 4 },
  txRow:       { flexDirection: 'row', paddingVertical: 12, alignItems: 'center' },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  txDate:      { fontSize: 13, color: '#555', fontWeight: '600', marginBottom: 3 },
  txQty:       { fontSize: 12, color: '#999' },
  txPnl:       { fontSize: 14, fontWeight: 'bold' },
  deleteBtn:   { fontSize: 12, color: '#E74C3C', fontWeight: '600' },
});
