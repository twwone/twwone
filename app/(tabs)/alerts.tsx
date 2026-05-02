import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEFAULT_SIGNAL_CONFIG, SignalConfig } from '@/lib/signals';

const STORAGE_KEY_SIGNALS   = '@signal_config_v1';
const STORAGE_KEY_WATCHLIST = '@watchlist_v1';
const STORAGE_KEY_PORTFOLIO = '@portfolio_v1';

const SIGNAL_META: Record<keyof SignalConfig, { name: string; desc: string }> = {
  kdGoldenCross:   { name: 'KD 黃金交叉',      desc: 'K 線從低檔上穿 D 線，底部反轉強訊號' },
  rsiOversold:     { name: 'RSI 超賣反彈',      desc: 'RSI 從超賣區回升站上門檻，賣壓消化完畢' },
  maGoldenCross:   { name: 'MA 均線黃金交叉',   desc: '短均線上穿長均線，趨勢轉多頭排列' },
  bollingerBounce: { name: '布林下軌反彈',       desc: '股價跌破布林下軌後回彈入通道，均值回歸' },
  volumeBreak:     { name: '帶量突破',           desc: '成交量超過均量倍數並同時突破近期高點' },
  macdAboveZero:   { name: 'MACD 零軸上交叉',   desc: 'MACD 柱狀體在零軸以上由負翻正，多頭確認' },
};

const SIGNAL_PARAMS: Record<keyof SignalConfig, { label: string; key: string }[]> = {
  kdGoldenCross:   [{ label: '超賣門檻（K 值上限）', key: 'oversoldThreshold' }],
  rsiOversold:     [{ label: 'RSI 超賣門檻',         key: 'threshold' }],
  maGoldenCross:   [{ label: '短均線天數', key: 'shortPeriod' }, { label: '長均線天數', key: 'longPeriod' }],
  bollingerBounce: [{ label: '標準差倍數', key: 'stdDev' }],
  volumeBreak:     [{ label: '量能倍數',   key: 'volumeMultiplier' }, { label: '突破天數', key: 'breakDays' }],
  macdAboveZero:   [],
};

export default function AlertsScreen() {
  const [config,   setConfig]   = useState<SignalConfig>(DEFAULT_SIGNAL_CONFIG);
  const [syncing,  setSyncing]  = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_SIGNALS).then(raw => {
      if (raw) try { setConfig(JSON.parse(raw)); } catch {}
    });
  }, []);

  const saveConfig = async (next: SignalConfig) => {
    setConfig(next);
    await AsyncStorage.setItem(STORAGE_KEY_SIGNALS, JSON.stringify(next));
  };

  const toggleSignal = (key: keyof SignalConfig) =>
    saveConfig({ ...config, [key]: { ...config[key], enabled: !config[key].enabled } });

  const updateParam = (key: keyof SignalConfig, param: string, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) saveConfig({ ...config, [key]: { ...config[key], [param]: num } });
  };

  const syncToBackend = async () => {
    setSyncing(true);
    try {
      const [wRaw, pRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_WATCHLIST),
        AsyncStorage.getItem(STORAGE_KEY_PORTFOLIO),
      ]);
      const watchlist = wRaw ? JSON.parse(wRaw) : [];
      const portfolio = pRaw ? JSON.parse(pRaw) : [];
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist, signalConfig: config, portfolio }),
      });
      if (res.ok) {
        const now = new Date().toLocaleTimeString('zh-TW', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei',
        });
        setLastSync(now);
        Alert.alert('同步成功 ✓', `後台已更新\n自選股：${watchlist.length} 檔\n庫存：${portfolio.length} 檔\n開啟訊號：${Object.values(config).filter(v => v.enabled).length} 個`);
      } else {
        Alert.alert('同步失敗', '請確認 Vercel KV 已設定完成');
      }
    } catch {
      Alert.alert('同步失敗', '網路錯誤，請稍後再試');
    }
    setSyncing(false);
  };

  const enabledCount = Object.values(config).filter(v => v.enabled).length;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>推播通知設定</Text>
        <Text style={s.headerSub}>開啟 {enabledCount} 個訊號 · 通知透過 Telegram 傳送</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll}>

        <Text style={s.sectionTitle}>盯盤訊號</Text>
        <Text style={s.sectionDesc}>台股交易時間（09:00–13:30）每 2 分鐘掃描一次自選股，觸發時推播到 Telegram</Text>

        {(Object.keys(SIGNAL_META) as (keyof SignalConfig)[]).map(key => {
          const { name, desc } = SIGNAL_META[key];
          const enabled = config[key].enabled;
          return (
            <View key={key} style={[s.signalCard, enabled && s.signalCardOn]}>
              <View style={s.signalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.signalName, enabled && s.signalNameOn]}>{name}</Text>
                  <Text style={s.signalDesc}>{desc}</Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={() => toggleSignal(key)}
                  trackColor={{ false: '#DDD', true: '#2C3E50' }}
                  thumbColor="white"
                />
              </View>
              {enabled && SIGNAL_PARAMS[key].length > 0 && (
                <View style={s.paramSection}>
                  <View style={s.paramDivider} />
                  <View style={s.paramRow}>
                    {SIGNAL_PARAMS[key].map(({ label, key: pk }) => (
                      <View key={pk} style={s.paramItem}>
                        <Text style={s.paramLabel}>{label}</Text>
                        <TextInput
                          style={s.paramInput}
                          value={String((config[key] as Record<string, unknown>)[pk])}
                          keyboardType="numeric"
                          onChangeText={v => updateParam(key, pk, v)}
                          selectTextOnFocus
                        />
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          style={[s.syncBtn, syncing && s.syncBtnDisabled]}
          onPress={syncToBackend}
          disabled={syncing}
        >
          {syncing
            ? <ActivityIndicator size="small" color="white" />
            : <Text style={s.syncBtnText}>同步設定到後台</Text>
          }
        </TouchableOpacity>
        {lastSync && <Text style={s.lastSync}>上次同步：{lastSync}　設定已生效</Text>}

        <View style={s.infoBox}>
          <Text style={s.infoTitle}>使用說明</Text>
          <Text style={s.infoText}>1. 在「自選股」頁加入你要盯的股票</Text>
          <Text style={s.infoText}>2. 開啟想要的訊號並調整參數</Text>
          <Text style={s.infoText}>3. 點「同步設定到後台」儲存</Text>
          <Text style={s.infoText}>4. 觸發時自動傳訊息到你的 Telegram</Text>
          <Text style={s.infoNote}>每個訊號觸發後有 4 小時冷卻，不重複推播</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F0F2F5' },
  header:       { backgroundColor: '#2C3E50', paddingVertical: 16, paddingHorizontal: 20, gap: 2 },
  headerTitle:  { fontSize: 20, fontWeight: 'bold', color: 'white' },
  headerSub:    { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  scroll:       { padding: 16, gap: 12, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#2C3E50', marginTop: 4 },
  sectionDesc:  { fontSize: 12, color: '#888', marginTop: -6, marginBottom: 4 },

  signalCard:    { backgroundColor: 'white', borderRadius: 14, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  signalCardOn:  { borderLeftWidth: 3, borderLeftColor: '#2C3E50' },
  signalHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  signalName:    { fontSize: 15, fontWeight: '600', color: '#888', marginBottom: 3 },
  signalNameOn:  { color: '#2C3E50' },
  signalDesc:    { fontSize: 12, color: '#999', lineHeight: 17 },

  paramSection: { gap: 8 },
  paramDivider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 4 },
  paramRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  paramItem:    { gap: 4, minWidth: 120 },
  paramLabel:   { fontSize: 11, color: '#888', fontWeight: '600' },
  paramInput:   { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, fontWeight: 'bold', color: '#2C3E50', textAlign: 'center', minWidth: 80 },

  syncBtn:         { backgroundColor: '#2C3E50', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  syncBtnDisabled: { backgroundColor: '#95A5A6' },
  syncBtnText:     { color: 'white', fontSize: 16, fontWeight: 'bold' },
  lastSync:        { fontSize: 12, color: '#27AE60', textAlign: 'center' },

  infoBox:   { backgroundColor: '#EBF5FB', borderRadius: 12, padding: 16, gap: 5, marginTop: 4 },
  infoTitle: { fontSize: 13, fontWeight: 'bold', color: '#2980B9', marginBottom: 4 },
  infoText:  { fontSize: 12, color: '#5D6D7E', lineHeight: 20 },
  infoNote:  { fontSize: 11, color: '#7FB3D3', marginTop: 4, fontStyle: 'italic' },
});
