import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const STORAGE_KEY = '@portfolio_v1';
const YF          = '/api/stock';

// ── 型別 ──────────────────────────────────────────────────
export interface Holding {
  id:        string;
  symbol:    string;
  name:      string;
  lots:      number;
  costPrice: number;
  buyDate:   string;
}

interface HoldingWithPrice extends Holding {
  currentPrice: number;
  pnl:          number;
  pnlPct:       number;
  days:         number;
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

async function loadHoldings(): Promise<Holding[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveHoldings(list: Holding[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ── 主畫面 ────────────────────────────────────────────────
export default function PortfolioScreen() {
  const [holdings,   setHoldings]   = useState<Holding[]>([]);
  const [priceMap,   setPriceMap]   = useState<Record<string, number>>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal,  setShowModal]  = useState(false);
  const [adding,     setAdding]     = useState(false);

  const [fSymbol,  setFSymbol]  = useState('');
  const [fLots,    setFLots]    = useState('');
  const [fCost,    setFCost]    = useState('');
  const [fBuyDate, setFBuyDate] = useState('');

  const loadAll = async () => {
    const h = await loadHoldings();
    setHoldings(h);
    if (h.length > 0) {
      const results = await Promise.all(h.map(item => fetchPrice(item.symbol)));
      const map: Record<string, number> = {};
      h.forEach((item, i) => { if (results[i]) map[item.symbol] = results[i]!.price; });
      setPriceMap(map);
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
      name: info.name, lots, costPrice: cost, buyDate: fBuyDate.trim(),
    };
    const next = [...holdings, h];
    setHoldings(next);
    setPriceMap(prev => ({ ...prev, [symbol]: info.price }));
    await saveHoldings(next);
    setAdding(false);
    setShowModal(false);
    setFSymbol(''); setFLots(''); setFCost(''); setFBuyDate('');
  };

  const removeHolding = (id: string) => {
    Alert.alert('刪除持股', '確定要刪除這筆紀錄？', [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: async () => {
        const next = holdings.filter(h => h.id !== id);
        setHoldings(next);
        await saveHoldings(next);
      }},
    ]);
  };

  // 加入即時價格
  const enriched: HoldingWithPrice[] = holdings.map(h => {
    const cur    = priceMap[h.symbol] ?? h.costPrice;
    const pnl    = (cur - h.costPrice) * h.lots * 1000;
    const pnlPct = ((cur - h.costPrice) / h.costPrice) * 100;
    return { ...h, currentPrice: cur, pnl, pnlPct, days: holdingDays(h.buyDate) };
  });

  const totalCost  = enriched.reduce((a, h) => a + h.costPrice    * h.lots * 1000, 0);
  const totalValue = enriched.reduce((a, h) => a + h.currentPrice * h.lots * 1000, 0);
  const totalPnl   = totalValue - totalCost;
  const totalPct   = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

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
            data={enriched}
            keyExtractor={h => h.id}
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
            renderItem={({ item: h }) => (
              <View style={[s.card, { borderLeftColor: tColor(h.pnl) }]}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardName}>{h.name}</Text>
                    <Text style={s.cardMeta}>
                      {h.symbol.replace('.TW', '')}　·　{h.lots} 張
                      {h.days > 0 ? `　·　持有 ${h.days} 天` : ''}
                    </Text>
                  </View>
                  <View style={s.cardRight}>
                    <Text style={[s.cardPrice, { color: tColor(h.pnl) }]}>
                      {h.currentPrice.toLocaleString()}
                    </Text>
                    <Text style={[s.cardPct, { color: tColor(h.pnl) }]}>
                      {sign(h.pnlPct)}{h.pnlPct.toFixed(2)}%
                    </Text>
                  </View>
                </View>
                <View style={s.cardBottom}>
                  <Text style={s.cardCost}>成本 {h.costPrice.toLocaleString()}</Text>
                  <Text style={[s.cardPnl, { color: tColor(h.pnl) }]}>
                    {sign(h.pnl)}{Math.round(h.pnl).toLocaleString()} 元
                  </Text>
                  <TouchableOpacity onPress={() => removeHolding(h.id)}>
                    <Text style={s.deleteBtn}>刪除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
      }

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

            <Text style={s.label}>張數（1張 = 1000股）</Text>
            <TextInput style={s.input} placeholder="2" placeholderTextColor="#bbb"
              value={fLots} onChangeText={setFLots} keyboardType="numeric" />

            <Text style={s.label}>成本價（每股，元）</Text>
            <TextInput style={s.input} placeholder="985.00" placeholderTextColor="#bbb"
              value={fCost} onChangeText={setFCost} keyboardType="numeric" />

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
  deleteBtn:  { fontSize: 12, color: '#E74C3C', fontWeight: '600' },

  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:   { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8 },
  modalHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2C3E50' },
  modalClose: { fontSize: 18, color: '#aaa', fontWeight: 'bold' },
  label:      { fontSize: 13, color: '#555', fontWeight: '600', marginTop: 4 },
  input:      { backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#333', borderWidth: 1, borderColor: '#EEE' },
  confirmBtn:    { backgroundColor: '#2C3E50', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  confirmBtnOff: { backgroundColor: '#95A5A6' },
  confirmBtnText:{ color: 'white', fontSize: 16, fontWeight: 'bold' },
});
