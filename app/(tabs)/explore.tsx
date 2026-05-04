import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  SafeAreaView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { getNameMap, resolveName } from '@/lib/stockNames';

const WATCHLIST_KEY = '@watchlist_v1';

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

type Market = 'tw' | 'us';

// ── Score → 視覺等級 ────────────────────────────────────────────────

function scoreLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: '極強訊號', color: '#FF6B6B' };
  if (score >= 60) return { label: '強勢訊號', color: '#F39C12' };
  return               { label: '入場訊號', color: '#4ECDC4' };
}

function formatTime(ts: number): string {
  const d  = new Date(ts);
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

function isUSMarketOpen(): boolean {
  const et  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── 主元件 ─────────────────────────────────────────────────────────

export default function RadarScreen() {
  const [market,      setMarket]      = useState<Market>('tw');
  const [tops,        setTops]        = useState<TopSignalItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [updatedAt,   setUpdatedAt]   = useState<number | null>(null);
  const [nameMap,     setNameMap]     = useState<Record<string, string>>({});
  const [watchlist,   setWatchlist]   = useState<string[]>([]);
  const [marketOpen,  setMarketOpen]  = useState(isTWMarketOpen());

  const initialized = useRef(false);

  const loadWatchlist = async () => {
    try {
      const raw = await AsyncStorage.getItem(WATCHLIST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const symbols = Array.isArray(parsed) ? parsed : (parsed.watchlist ?? []);
      setWatchlist(symbols);
    } catch {}
  };

  const addToWatchlist = async (symbol: string, name: string) => {
    try {
      const raw = await AsyncStorage.getItem(WATCHLIST_KEY);
      let symbols: string[] = [];
      if (raw) {
        const parsed = JSON.parse(raw);
        symbols = Array.isArray(parsed) ? parsed : (parsed.watchlist ?? []);
      }
      if (symbols.includes(symbol)) {
        Alert.alert('已在自選股', `${name} 已經在你的自選股中`);
        return;
      }
      const next      = [...symbols, symbol];
      const updatedAt = Date.now();
      await AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify({ watchlist: next, updatedAt }));
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist: next, watchlistUpdatedAt: updatedAt }),
      }).catch(() => {});
      setWatchlist(next);
      Alert.alert('已加入自選股', `${name} 已加入自選股，系統將開始追蹤`);
    } catch {
      Alert.alert('失敗', '請重試');
    }
  };

  const load = useCallback(async (m: Market = market) => {
    try {
      const res = await fetch(`/api/market-top?market=${m}`, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) return;
      const data = await res.json();
      setTops(data.top ?? []);
      setUpdatedAt(data.updatedAt ?? null);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market]);

  useEffect(() => {
    getNameMap().then(setNameMap);
    loadWatchlist();
    load('tw').then(() => { initialized.current = true; });
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    setLoading(true);
    setTops([]);
    load(market);
  }, [market]);

  useEffect(() => {
    const t = setInterval(() => {
      setMarketOpen(market === 'us' ? isUSMarketOpen() : isTWMarketOpen());
    }, 60 * 1000);
    return () => clearInterval(t);
  }, [market]);

  useFocusEffect(useCallback(() => {
    if (!initialized.current) return;
    loadWatchlist();
    load(market);
  }, [load, market]));

  const onRefresh = () => { setRefreshing(true); load(market); };

  const switchMarket = (m: Market) => {
    if (m === market) return;
    setMarket(m);
    setMarketOpen(m === 'us' ? isUSMarketOpen() : isTWMarketOpen());
  };

  // ── 卡片 ──────────────────────────────────────────────────────────

  const renderItem = ({ item, index }: { item: TopSignalItem; index: number }) => {
    const lv          = scoreLevel(item.score);
    const displayName = market === 'tw'
      ? resolveName(item.symbol, nameMap, item.name)
      : item.name;
    const priceLabel  = market === 'us' ? 'USD' : '元';
    const inWatch     = watchlist.includes(item.symbol);

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
            <Text style={s.cardName}>{displayName}</Text>
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
            <Text style={s.cardPriceLabel}>{priceLabel}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.addBtn, { borderColor: inWatch ? '#2C4F6B' : lv.color + '66' }]}
          onPress={() => addToWatchlist(item.symbol, displayName)}
          disabled={inWatch}
        >
          <Text style={[s.addBtnText, { color: inWatch ? '#2C4F6B' : lv.color }]}>
            {inWatch ? '✓ 已在自選股' : '＋ 加入自選股'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ── 畫面 ──────────────────────────────────────────────────────────

  const marketLabel = market === 'tw'
    ? { sub: '成交量前 100 · 每 30 分鐘自動更新', loading: '由後端掃描台股前 100 大成交量標的' }
    : { sub: '50 大流動性標的 · 每 30 分鐘自動更新', loading: '由後端掃描 50 檔高流動性美股' };

  const openLabel = market === 'tw'
    ? { open: '🟢 盤中即時掃描', closed: '🔒 已收盤 (顯示今日最終數據)' }
    : { open: '🟢 美股盤中即時掃描', closed: '🔒 美股已收盤 (顯示今日最終數據)' };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>強勢雷達</Text>

        <View style={s.marketToggle}>
          {(['tw', 'us'] as Market[]).map(m => (
            <TouchableOpacity
              key={m}
              style={[s.marketToggleBtn, market === m && s.marketToggleBtnActive]}
              onPress={() => switchMarket(m)}
            >
              <Text style={[s.marketToggleText, market === m && s.marketToggleTextActive]}>
                {m === 'tw' ? '🇹🇼 台股' : '🇺🇸 美股'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.headerSub}>全市場海選 · {marketLabel.sub}</Text>
        <View style={[s.marketBadge, marketOpen ? s.marketBadgeOpen : s.marketBadgeClosed]}>
          <Text style={[s.marketBadgeText, marketOpen ? s.marketBadgeTextOpen : s.marketBadgeTextClosed]}>
            {marketOpen ? openLabel.open : openLabel.closed}
          </Text>
        </View>
      </View>

      {loading && (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F39C12" />
          <Text style={s.loadingTitle}>讀取市場掃描結果中...</Text>
          <Text style={s.loadingSub}>{marketLabel.loading}</Text>
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
                後端每 30 分鐘在開盤時自動掃描{'\n'}下拉可手動刷新
              </Text>
            </View>
          }
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

// ── 樣式 ──────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0D1B2A' },

  header:      { backgroundColor: '#0D1B2A', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#F5F5F5' },
  headerSub:   { fontSize: 12, color: '#4A7FA5', marginTop: 4 },

  marketToggle:          { flexDirection: 'row', marginTop: 10, marginBottom: 2, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#1E3A5F', alignSelf: 'flex-start' },
  marketToggleBtn:       { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#162535' },
  marketToggleBtnActive: { backgroundColor: '#1E3A5F' },
  marketToggleText:      { fontSize: 13, color: '#4A7FA5', fontWeight: '600' },
  marketToggleTextActive:{ color: '#F5F5F5' },

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

  cardSymbol:     { fontSize: 17, fontWeight: 'bold', color: '#F5F5F5' },
  cardName:       { fontSize: 13, color: '#6A9BBF' },
  signalRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  sigChip:        { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  sigText:        { fontSize: 10, fontWeight: '600' },
  cardPrice:      { fontSize: 24, fontWeight: 'bold', color: '#F5F5F5' },
  cardPriceLabel: { fontSize: 12, color: '#4A7FA5', textAlign: 'right' },

  addBtn:     { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  addBtnText: { fontSize: 13, fontWeight: '700' },
});
