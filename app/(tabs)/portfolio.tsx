import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';

import { useSyncData } from '@/hooks/useSyncData';
import { getNameMap, resolveName } from '@/lib/stockNames';

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
  type?:     'buy' | 'sell';
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
  avgBuyPrice:     number;
  netShares:       number;
  realizedPnl:     number;
  unrealizedPnl:   number;
  unrealizedPct:   number;
  totalPnl:        number;
  quantitySummary: string;
  isExited:        boolean;
}

// ── 工具 ──────────────────────────────────────────────────
function normalize(s: string): string {
  const t = s.trim().toUpperCase();
  if (t.includes('.')) return t;
  return /^\d+[A-Z]?$/.test(t) ? `${t}.TW` : t;
}

function holdingDays(buyDate: string): number {
  if (!buyDate) return 0;
  return Math.floor((Date.now() - new Date(buyDate).getTime()) / 86400000);
}

const tColor = (n: number) => (n >= 0 ? '#E74C3C' : '#27AE60');
const sign   = (n: number) => (n >= 0 ? '+' : '');
const toShares = (h: Holding) => h.lots * ((h.unit ?? '張') === '張' ? 1000 : 1);

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
    if (Array.isArray(parsed)) return { holdings: parsed, updatedAt: 0 };
    return parsed as StoredPortfolio;
  } catch { return { holdings: [], updatedAt: 0 }; }
}

async function saveHoldings(list: Holding[]): Promise<number> {
  const updatedAt = Date.now();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ holdings: list, updatedAt }));
  syncToServer(list, updatedAt);
  return updatedAt;
}

async function syncToServer(holdings: Holding[], updatedAt: number): Promise<void> {
  try {
    await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings, updatedAt }),
    });
  } catch {}
}

async function fetchServerPortfolio(): Promise<StoredPortfolio | null> {
  try {
    const res = await fetch('/api/portfolio', {
      headers: { 'Cache-Control': 'no-cache' },
    });
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
  const [nameMap,        setNameMap]        = useState<Record<string, string>>({});
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [adding,         setAdding]         = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const [fSymbol,  setFSymbol]  = useState('');
  const [fType,    setFType]    = useState<'buy' | 'sell'>('buy');
  const [fLots,    setFLots]    = useState('');
  const [fUnit,    setFUnit]    = useState<'張' | '股'>('張');
  const [fCost,    setFCost]    = useState('');
  const [fBuyDate, setFBuyDate] = useState('');

  const resetForm = () => {
    setFSymbol(''); setFType('buy'); setFLots(''); setFUnit('張'); setFCost(''); setFBuyDate('');
  };

  const loadAll = async () => {
    const local = await loadHoldings();
    setHoldings(local.holdings);
    const [serverData, prices] = await Promise.all([
      fetchServerPortfolio(),
      fetchAllPrices(local.holdings),
    ]);
    setPriceMap(prices);
    if (local.updatedAt === 0 && local.holdings.length > 0) {
      saveHoldings(local.holdings);
    }
    if (serverData && serverData.updatedAt >= local.updatedAt) {
      setHoldings(serverData.holdings);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serverData));
      const serverPrices = await fetchAllPrices(serverData.holdings);
      setPriceMap(serverPrices);
    }
    setLoading(false);
  };

  useEffect(() => { loadAll(); getNameMap().then(setNameMap); }, []);

  // ── useSyncData：三合一刷新（60s interval + Tab 焦點 + 手動按鈕）──
  const { isSyncing, triggerSync } = useSyncData(loadAll);

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

  const addHolding = async () => {
    const symbol = normalize(fSymbol);
    const lots   = parseFloat(fLots);
    const cost   = parseFloat(fCost);
    if (!symbol || isNaN(lots) || lots <= 0 || isNaN(cost) || cost <= 0) {
      Alert.alert('請填寫完整', '股票代號、數量、價格為必填');
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
      name: resolveName(symbol, nameMap, info.name), lots, unit: fUnit, costPrice: cost,
      buyDate: fBuyDate.trim(), type: fType,
    };
    const next = [...holdings, h];
    setHoldings(next);
    setPriceMap(prev => ({ ...prev, [symbol]: info.price }));
    await saveHoldings(next);
    setAdding(false);
    setShowModal(false);
    resetForm();
  };

  const removeHolding = (id: string) => {
    Alert.alert('刪除紀錄', '確定要刪除這筆紀錄？', [
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

  // 加入即時價格（賣出紀錄 pnl 先給 0，在 grouped 裡重新算）
  const enriched: HoldingWithPrice[] = holdings.map(h => {
    const cur    = priceMap[h.symbol] ?? h.costPrice;
    const isSell = h.type === 'sell';
    const mul    = (h.unit ?? '張') === '張' ? 1000 : 1;
    const pnl    = isSell ? 0 : (cur - h.costPrice) * h.lots * mul;
    const pnlPct = isSell ? 0 : ((cur - h.costPrice) / h.costPrice) * 100;
    return { ...h, currentPrice: cur, pnl, pnlPct, days: holdingDays(h.buyDate) };
  });

  // 依股票代號合併，計算加權平均成本、已實現 / 未實現損益
  const grouped: GroupedHolding[] = (() => {
    const map: Record<string, HoldingWithPrice[]> = {};
    for (const h of enriched) {
      if (!map[h.symbol]) map[h.symbol] = [];
      map[h.symbol].push(h);
    }
    return Object.entries(map).map(([symbol, txs]) => {
      const cur      = priceMap[symbol] ?? txs[0].costPrice;
      const buyTx    = txs.filter(t => (t.type ?? 'buy') === 'buy');
      const sellTx   = txs.filter(t => t.type === 'sell');

      const totalBuyShares  = buyTx.reduce((a, t) => a + toShares(t), 0);
      const totalBuyCost    = buyTx.reduce((a, t) => a + t.costPrice * toShares(t), 0);
      const avgBuyPrice     = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;

      const totalSellShares  = sellTx.reduce((a, t) => a + toShares(t), 0);
      const totalSellRevenue = sellTx.reduce((a, t) => a + t.costPrice * toShares(t), 0);
      const realizedPnl      = totalSellRevenue - avgBuyPrice * totalSellShares;

      const netShares      = totalBuyShares - totalSellShares;
      const unrealizedPnl  = netShares > 0 ? (cur - avgBuyPrice) * netShares : 0;
      const unrealizedPct  = avgBuyPrice > 0 && netShares > 0
        ? (cur - avgBuyPrice) / avgBuyPrice * 100 : 0;
      const totalPnl = realizedPnl + unrealizedPnl;

      // 數量摘要（淨持有）
      const net張 = buyTx.filter(t => (t.unit ?? '張') === '張').reduce((a, t) => a + t.lots, 0)
                  - sellTx.filter(t => (t.unit ?? '張') === '張').reduce((a, t) => a + t.lots, 0);
      const net股 = buyTx.filter(t => t.unit === '股').reduce((a, t) => a + t.lots, 0)
                  - sellTx.filter(t => t.unit === '股').reduce((a, t) => a + t.lots, 0);
      const parts: string[] = [];
      if (net張 > 0) parts.push(`${net張}張`);
      if (net股 > 0) parts.push(`${net股}股`);
      const isExited = net張 <= 0 && net股 <= 0;

      // 賣出紀錄補上已實現 pnl（每筆按比例）
      const annotated = txs.map(t => {
        if (t.type !== 'sell') return t;
        const contrib = (t.costPrice - avgBuyPrice) * toShares(t);
        return { ...t, pnl: contrib };
      });

      return {
        symbol, name: txs[0].name, currentPrice: cur,
        transactions: [...annotated].sort((a, b) => (a.buyDate || '') < (b.buyDate || '') ? -1 : 1),
        avgBuyPrice, netShares,
        realizedPnl, unrealizedPnl, unrealizedPct, totalPnl,
        quantitySummary: parts.join(' + ') || '已出場',
        isExited,
      };
    });
  })();

  const activeGroups       = grouped.filter(g => !g.isExited);
  const totalCost          = activeGroups.reduce((a, g) => a + g.avgBuyPrice * g.netShares, 0);
  const totalValue         = activeGroups.reduce((a, g) => a + g.currentPrice * g.netShares, 0);
  const totalUnrealizedPnl = grouped.reduce((a, g) => a + g.unrealizedPnl, 0);
  const totalRealizedPnl   = grouped.reduce((a, g) => a + g.realizedPnl, 0);
  const totalPnl           = totalUnrealizedPnl + totalRealizedPnl;
  const totalPct           = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0;

  const selectedGroup = grouped.find(g => g.symbol === selectedSymbol) ?? null;

  const isSell = fType === 'sell';

  return (
    <View style={s.container}>

      {loading
        ? <View style={s.centered}><ActivityIndicator size="large" color="#2C3E50" /></View>
        : <FlatList
            data={grouped}
            keyExtractor={g => g.symbol}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={isSyncing} tintColor="#2C3E50" onRefresh={triggerSync} />}
            ListHeaderComponent={
              <>
                {grouped.length > 0 && (
                  <View style={s.overviewCard}>
                    <View style={s.overviewRow}>
                      <OverviewItem label="持倉成本" value={`${Math.round(totalCost / 1000)}K`} />
                      <OverviewItem label="目前市值" value={`${Math.round(totalValue / 1000)}K`} />
                      <OverviewItem label="未實現損益"
                        value={`${sign(totalUnrealizedPnl)}${Math.round(totalUnrealizedPnl).toLocaleString()}`}
                        color={tColor(totalUnrealizedPnl)} />
                    </View>
                    {totalRealizedPnl !== 0 && (
                      <View style={s.overviewDivider}>
                        <OverviewItem label="已實現損益"
                          value={`${sign(totalRealizedPnl)}${Math.round(totalRealizedPnl).toLocaleString()}`}
                          color={tColor(totalRealizedPnl)} />
                        <OverviewItem label="總損益"
                          value={`${sign(totalPnl)}${Math.round(totalPnl).toLocaleString()}`}
                          color={tColor(totalPnl)} />
                      </View>
                    )}
                  </View>
                )}
                <TouchableOpacity style={s.addBtn} onPress={() => setShowModal(true)}>
                  <Text style={s.addBtnText}>＋ 新增紀錄</Text>
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
                style={[s.card, { borderLeftColor: g.isExited ? '#CCC' : tColor(g.totalPnl) }]}
                onPress={() => setSelectedSymbol(g.symbol)}
                activeOpacity={0.75}
              >
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[s.cardName, g.isExited && { color: '#999' }]}>{resolveName(g.symbol, nameMap, g.name)}</Text>
                      {g.isExited && <View style={s.exitedBadge}><Text style={s.exitedBadgeText}>已出場</Text></View>}
                    </View>
                    <Text style={s.cardMeta}>
                      {g.symbol.replace('.TW', '')}　·　{g.quantitySummary}
                      {g.transactions.length > 1 ? `　·　${g.transactions.length} 筆` : ''}
                    </Text>
                  </View>
                  {!g.isExited && (
                    <View style={s.cardRight}>
                      <Text style={[s.cardPrice, { color: tColor(g.unrealizedPnl) }]}>
                        {g.currentPrice.toLocaleString()}
                      </Text>
                      <Text style={[s.cardPct, { color: tColor(g.unrealizedPnl) }]}>
                        {sign(g.unrealizedPct)}{g.unrealizedPct.toFixed(2)}%
                      </Text>
                    </View>
                  )}
                </View>
                <View style={s.cardBottom}>
                  {!g.isExited && (
                    <Text style={s.cardCost}>均買 {g.avgBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
                  )}
                  {g.realizedPnl !== 0 && (
                    <Text style={[s.cardCost, { color: tColor(g.realizedPnl) }]}>
                      已實現 {sign(g.realizedPnl)}{Math.round(g.realizedPnl).toLocaleString()}
                    </Text>
                  )}
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
                    <Text style={s.modalTitle}>{resolveName(selectedGroup.symbol, nameMap, selectedGroup.name)}</Text>
                    <Text style={s.detailSubtitle}>
                      {selectedGroup.symbol.replace('.TW', '')}　·　{selectedGroup.quantitySummary}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedSymbol(null)}>
                    <Text style={s.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.detailSummaryBox}>
                  <View style={s.detailSummaryRow}>
                    <View>
                      <Text style={s.detailSummaryLabel}>現價</Text>
                      <Text style={s.detailSummaryVal}>{selectedGroup.currentPrice.toLocaleString()}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.detailSummaryLabel}>均買成本</Text>
                      <Text style={s.detailSummaryVal}>
                        {selectedGroup.avgBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                  </View>
                  <View style={[s.detailSummaryRow, { marginTop: 10 }]}>
                    {!selectedGroup.isExited && (
                      <View>
                        <Text style={s.detailSummaryLabel}>未實現損益</Text>
                        <Text style={[s.detailSummaryPnl, { color: tColor(selectedGroup.unrealizedPnl) }]}>
                          {sign(selectedGroup.unrealizedPct)}{selectedGroup.unrealizedPct.toFixed(2)}%
                          （{sign(selectedGroup.unrealizedPnl)}{Math.round(selectedGroup.unrealizedPnl).toLocaleString()}）
                        </Text>
                      </View>
                    )}
                    {selectedGroup.realizedPnl !== 0 && (
                      <View style={{ alignItems: selectedGroup.isExited ? 'flex-start' : 'flex-end' }}>
                        <Text style={s.detailSummaryLabel}>已實現損益</Text>
                        <Text style={[s.detailSummaryPnl, { color: tColor(selectedGroup.realizedPnl) }]}>
                          {sign(selectedGroup.realizedPnl)}{Math.round(selectedGroup.realizedPnl).toLocaleString()} 元
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                <Text style={s.detailSectionTitle}>交易紀錄</Text>
                <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                  {selectedGroup.transactions.map((tx, i) => {
                    const isTxSell = tx.type === 'sell';
                    return (
                      <View key={tx.id} style={[s.txRow, i < selectedGroup.transactions.length - 1 && s.txRowBorder]}>
                        <View style={[s.txTypeBadge, isTxSell ? s.txTypeSell : s.txTypeBuy]}>
                          <Text style={s.txTypeText}>{isTxSell ? '賣' : '買'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.txDate}>{tx.buyDate || '未填日期'}</Text>
                          <Text style={s.txQty}>{tx.lots} {tx.unit ?? '張'}　@　{tx.costPrice.toLocaleString()}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          {tx.pnl !== 0 && (
                            <Text style={[s.txPnl, { color: tColor(tx.pnl) }]}>
                              {sign(tx.pnl)}{Math.round(tx.pnl).toLocaleString()}
                            </Text>
                          )}
                          <TouchableOpacity onPress={() => removeHolding(tx.id)}>
                            <Text style={s.deleteBtn}>刪除</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity style={s.confirmBtn} onPress={() => {
                  setSelectedSymbol(null);
                  setFSymbol(selectedGroup.symbol.replace('.TW', ''));
                  setShowModal(true);
                }}>
                  <Text style={s.confirmBtnText}>＋ 記錄交易</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── 新增紀錄 Modal ── */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => { setShowModal(false); resetForm(); }}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>記錄交易</Text>
              <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 買入 / 賣出 切換 */}
            <View style={s.typeToggleRow}>
              {(['buy', 'sell'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[s.typeBtn, fType === t && (t === 'buy' ? s.typeBtnBuy : s.typeBtnSell)]}
                  onPress={() => setFType(t)}
                >
                  <Text style={[s.typeBtnText, fType === t && s.typeBtnTextActive]}>
                    {t === 'buy' ? '買入' : '賣出'}
                  </Text>
                </TouchableOpacity>
              ))}
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

            <Text style={s.label}>{isSell ? '賣出均價（每股，元）' : '成本價（每股，元）'}</Text>
            <TextInput style={s.input} placeholder="985.00" placeholderTextColor="#bbb"
              value={fCost} onChangeText={setFCost} keyboardType="decimal-pad" />

            <Text style={s.label}>{isSell ? '賣出日期（選填）' : '買進日期（選填）'}</Text>
            <TextInput style={s.input} placeholder="2026-04-15" placeholderTextColor="#bbb"
              value={fBuyDate} onChangeText={setFBuyDate} />

            <TouchableOpacity
              style={[s.confirmBtn, isSell && s.confirmBtnSell, adding && s.confirmBtnOff]}
              onPress={addHolding}
              disabled={adding}
            >
              {adding
                ? <ActivityIndicator size="small" color="white" />
                : <Text style={s.confirmBtnText}>{isSell ? '確認賣出' : '確認買入'}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
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

  overviewCard:    { backgroundColor: 'white', borderRadius: 14, padding: 16, marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  overviewRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  overviewDivider: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F2F5' },
  overviewItem:    { alignItems: 'center', flex: 1 },
  overviewLabel:   { fontSize: 11, color: '#999', marginBottom: 4 },
  overviewValue:   { fontSize: 15, fontWeight: 'bold', color: '#2C3E50' },

  addBtn:     { backgroundColor: '#2C3E50', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  addBtnText: { color: 'white', fontSize: 15, fontWeight: 'bold' },

  card:        { backgroundColor: 'white', borderRadius: 14, padding: 14, borderLeftWidth: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, gap: 8 },
  cardTop:     { flexDirection: 'row', alignItems: 'flex-start' },
  cardName:    { fontSize: 16, fontWeight: 'bold', color: '#2C3E50' },
  cardMeta:    { fontSize: 12, color: '#999', marginTop: 3 },
  cardRight:   { alignItems: 'flex-end' },
  cardPrice:   { fontSize: 20, fontWeight: 'bold' },
  cardPct:     { fontSize: 13, fontWeight: '600', marginTop: 2 },
  cardBottom:  { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cardCost:    { fontSize: 12, color: '#888' },
  cardPnl:    { fontSize: 14, fontWeight: 'bold', flex: 1 },
  cardArrow:   { fontSize: 20, color: '#ccc' },
  exitedBadge: { backgroundColor: '#F0F2F5', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  exitedBadgeText: { fontSize: 10, color: '#999', fontWeight: '600' },

  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:   { backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 8 },
  modalHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2C3E50' },
  modalClose: { fontSize: 18, color: '#aaa', fontWeight: 'bold' },
  label:      { fontSize: 13, color: '#555', fontWeight: '600', marginTop: 4 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  unitToggle: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#2C3E50' },
  unitBtn:    { paddingHorizontal: 14, paddingVertical: 4, backgroundColor: 'white' },
  unitBtnActive:     { backgroundColor: '#2C3E50' },
  unitBtnText:       { fontSize: 13, color: '#2C3E50', fontWeight: '600' },
  unitBtnTextActive: { color: 'white' },
  input:      { backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#333', borderWidth: 1, borderColor: '#EEE' },
  confirmBtn:     { backgroundColor: '#2C3E50', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  confirmBtnSell: { backgroundColor: '#E74C3C' },
  confirmBtnOff:  { backgroundColor: '#95A5A6' },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },

  typeToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  typeBtn:       { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#DDD', alignItems: 'center' },
  typeBtnBuy:    { backgroundColor: '#2C3E50', borderColor: '#2C3E50' },
  typeBtnSell:   { backgroundColor: '#E74C3C', borderColor: '#E74C3C' },
  typeBtnText:   { fontSize: 15, fontWeight: 'bold', color: '#999' },
  typeBtnTextActive: { color: 'white' },

  detailSubtitle:     { fontSize: 12, color: '#999', marginTop: 2 },
  detailSummaryBox:   { backgroundColor: '#F8F9FA', borderRadius: 12, padding: 14 },
  detailSummaryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  detailSummaryLabel: { fontSize: 11, color: '#999', marginBottom: 3 },
  detailSummaryVal:   { fontSize: 20, fontWeight: 'bold', color: '#2C3E50' },
  detailSummaryPnl:   { fontSize: 14, fontWeight: '700' },
  detailSectionTitle: { fontSize: 12, color: '#aaa', fontWeight: '600', marginTop: 4 },

  txRow:       { flexDirection: 'row', paddingVertical: 12, alignItems: 'center', gap: 10 },
  txRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F0F2F5' },
  txTypeBadge: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  txTypeBuy:   { backgroundColor: '#EBF5FB' },
  txTypeSell:  { backgroundColor: '#FDEDEC' },
  txTypeText:  { fontSize: 12, fontWeight: 'bold', color: '#555' },
  txDate:      { fontSize: 13, color: '#555', fontWeight: '600', marginBottom: 3 },
  txQty:       { fontSize: 12, color: '#999' },
  txPnl:       { fontSize: 14, fontWeight: 'bold' },
  deleteBtn:   { fontSize: 12, color: '#E74C3C', fontWeight: '600' },
});
