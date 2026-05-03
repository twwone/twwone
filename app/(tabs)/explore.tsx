import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  SafeAreaView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Holding } from './portfolio';
import { getNameMap, resolveName } from '@/lib/stockNames';

const PORTFOLIO_KEY = '@portfolio_v1';

// ── Types ──────────────────────────────────────────────────────────

interface TopSignalItem {
  symbol:    string;
  code:      string;
  name:      string;
  price:     number;
  score:     number;
  signals:   string[];
  updatedAt: number;
}

// ── Score → 視覺等級 ────────────────────────────────────────────────

function scoreLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: '極強訊號', color: '#FF6B6B' };
  if (score >= 60) return { label: '強勢訊號', color: '#F39C12' };
  return               { label: '入場訊號', color: '#4ECDC4' };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function isTWMarketOpen(): boolean {
  const tw  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day = tw.getDay();
  if (day === 0 || day === 6) return false;
  const mins = tw.getHours() * 60 + tw.getMinutes();
  return mins >= 9 * 60 && mins < 13 * 60 + 30;
}

// ── 主元件 ─────────────────────────────────────────────────────────

export default function RadarScreen() {
  const [tops,       setTops]       = useState<TopSignalItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt,  setUpdatedAt]  = useState<number | null>(null);
  const [nameMap,    setNameMap]    = useState<Record<string, string>>({});

  const [addTarget, setAddTarget] = useState<{ symbol: string; name: string } | null>(null);
  const [pLots,     setPLots]     = useState('');
  const [pUnit,     setPUnit]     = useState<'張' | '股'>('張');
  const [pCost,     setPCost]     = useState('');
  const [pDate,     setPDate]     = useState('');
  const [pSaving,   setPSaving]   = useState(false);

  const [marketOpen, setMarketOpen] = useState(isTWMarketOpen());

  const initialized = useRef(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      const res = await fetch('/api/market-top', { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const data = await res.json();
      setTops(data.top ?? []);
      setUpdatedAt(data.updatedAt ?? null);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    getNameMap().then(setNameMap);
    load().then(() => { initialized.current = true; });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setMarketOpen(isTWMarketOpen()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useFocusEffect(useCallback(() => {
    if (!initialized.current) return;
    load(false);
  }, [load]));

  const onRefresh = () => { setRefreshing(true); load(true); };

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
        symbol: addTarget.symbol,
        name: resolveName(addTarget.symbol, nameMap, addTarget.name),
        lots, unit: pUnit, costPrice: cost, buyDate: pDate.trim(),
      };
      const next      = [...existing, h];
      const updatedAt = Date.now();
      await AsyncStorage.setItem(PORTFOLIO_KEY, JSON.stringify({ holdings: next, updatedAt }));
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

  // ── 卡片 ──────────────────────────────────────────────────────────

  const renderItem = ({ item, index }: { item: TopSignalItem; index: number }) => {
    const lv = scoreLevel(item.score);
    return (
      <View style={[s.card, { borderColor: lv.color + '44' }]}>
        <View style={s.cardTopRow}>
          <View style={s.rankBadge}>
            <Text style={s.rankText}>#{index + 1}</Text>
          </View>
          <View style={[s.badge, { borderColor: lv.color, backgroundColor: lv.color + '22' }]}>
            <Text style={[s.badgeText, { color: lv.color }]}>{lv.label}</Text>
          </View>
          <View style={s.scoreBadge}>
            <Text style={s.scoreText}>分數 {item.score}</Text>
          </View>
        </View>

        <View style={s.cardBody}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.cardSymbol}>{item.code}</Text>
            <Text style={s.cardName}>{resolveName(item.symbol, nameMap, item.name)}</Text>
            <View style={s.signalRow}>
              {item.signals.map(sig => (
                <View key={sig} style={[s.sigChip, { borderColor: lv.color + '88' }]}>
                  <Text style={[s.sigText, { color: lv.color }]}>{sig}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={s.cardRight}>
            <Text style={s.cardPrice}>{item.price.toLocaleString()}</Text>
            <Text style={s.cardPriceLabel}>元</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.addBtn, { borderColor: lv.color + '66' }]}
          onPress={() => setAddTarget({ symbol: item.symbol, name: item.name })}
        >
          <Text style={[s.addBtnText, { color: lv.color }]}>＋ 加入庫存</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ── 畫面 ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>強勢雷達</Text>
        <Text style={s.headerSub}>
          全市場海選 · 台股成交量前 150 · 每 30 分鐘自動更新
        </Text>
        <View style={[s.marketBadge, marketOpen ? s.marketBadgeOpen : s.marketBadgeClosed]}>
          <Text style={[s.marketBadgeText, marketOpen ? s.marketBadgeTextOpen : s.marketBadgeTextClosed]}>
            {marketOpen ? '🟢 盤中即時掃描' : '🔒 已收盤 (顯示今日最終數據)'}
          </Text>
        </View>
      </View>

      {loading && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F39C12" />
          <Text style={s.loadingTitle}>讀取市場掃描結果中...</Text>
          <Text style={s.loadingSub}>由後端掃描台股前 150 大成交量標的</Text>
        </View>
      )}

      {!loading && (
        <FlatList
          data={tops}
          keyExtractor={item => item.symbol}
          contentContainerStyle={tops.length === 0 ? s.emptyWrap : s.listWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F39C12" />}
          ListHeaderComponent={
            <View style={s.summaryRow}>
              <Text style={s.summaryText}>
                找到 <Text style={s.summaryHL}>{tops.length} 檔</Text> 強勢標的
              </Text>
              {updatedAt && (
                <Text style={s.summaryHint}>掃描時間 {formatTime(updatedAt)}</Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Text style={s.emptyIcon}>📡</Text>
              <Text style={s.emptyTitle}>等待市場掃描</Text>
              <Text style={s.emptySub}>
                後端每 30 分鐘在台股開盤時自動掃描{'\n'}下拉可手動刷新
              </Text>
            </View>
          }
          renderItem={renderItem}
        />
      )}

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

// ── 樣式 ──────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0D1B2A' },

  header:      { backgroundColor: '#0D1B2A', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#F5F5F5' },
  headerSub:   { fontSize: 12, color: '#4A7FA5', marginTop: 4 },

  marketBadge:           { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8, borderWidth: 1 },
  marketBadgeOpen:       { backgroundColor: '#0A2A1A', borderColor: '#27AE60' },
  marketBadgeClosed:     { backgroundColor: '#1A1A2A', borderColor: '#2C4F6B' },
  marketBadgeText:       { fontSize: 12, fontWeight: '600' },
  marketBadgeTextOpen:   { color: '#2ECC71' },
  marketBadgeTextClosed: { color: '#4A7FA5' },

  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  loadingTitle: { fontSize: 16, fontWeight: '600', color: '#E0E0E0' },
  loadingSub:   { fontSize: 13, color: '#4A7FA5', textAlign: 'center' },

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

  card:       { backgroundColor: '#162535', borderRadius: 16, padding: 16, borderWidth: 1, gap: 10 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardBody:   { flexDirection: 'row', alignItems: 'flex-start' },
  cardRight:  { alignItems: 'flex-end', gap: 2 },

  rankBadge:  { backgroundColor: '#1E3A5F', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  rankText:   { fontSize: 12, color: '#F39C12', fontWeight: 'bold' },
  badge:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:  { fontSize: 11, fontWeight: 'bold' },
  scoreBadge: { marginLeft: 'auto', backgroundColor: '#1E3A5F', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  scoreText:  { fontSize: 11, color: '#4A7FA5', fontWeight: '600' },

  cardSymbol:  { fontSize: 17, fontWeight: 'bold', color: '#F5F5F5' },
  cardName:    { fontSize: 13, color: '#6A9BBF' },
  signalRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  sigChip:     { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  sigText:     { fontSize: 10, fontWeight: '600' },
  cardPrice:   { fontSize: 24, fontWeight: 'bold', color: '#F5F5F5' },
  cardPriceLabel: { fontSize: 12, color: '#4A7FA5', textAlign: 'right' },

  addBtn:     { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  addBtnText: { fontSize: 13, fontWeight: '700' },

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
});
