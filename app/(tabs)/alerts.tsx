import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  DEFAULT_SIGNAL_CONFIG,
  ENTRY_SIGNAL_KEYS,
  EXIT_SIGNAL_KEYS,
  SignalConfig,
} from '@/lib/signals';

const STORAGE_KEY_PROFILES  = '@signal_profiles_v2';
const STORAGE_KEY_ACTIVE    = '@active_profile_id_v1';
const STORAGE_KEY_SIGNALS   = '@signal_config_v1'; // 舊格式，首次遷移用
const STORAGE_KEY_WATCHLIST = '@watchlist_v1';
const STORAGE_KEY_PORTFOLIO = '@portfolio_v1';

interface SignalProfile {
  id: string;
  name: string;
  ticker: string;
  config: SignalConfig;
}

const SIGNAL_META: Record<keyof SignalConfig, { name: string; desc: string }> = {
  // 進場
  kdGoldenCross:   { name: 'KD 黃金交叉',      desc: 'K 線從低檔上穿 D 線，底部反轉強訊號' },
  rsiOversold:     { name: 'RSI 超賣反彈',      desc: 'RSI 從超賣區回升站上門檻，賣壓消化完畢' },
  maGoldenCross:   { name: 'MA 均線黃金交叉',   desc: '短均線上穿長均線，趨勢轉多頭排列' },
  bollingerBounce: { name: '布林下軌反彈',       desc: '股價跌破布林下軌後回彈入通道，均值回歸' },
  volumeBreak:     { name: '帶量突破',           desc: '成交量超過均量倍數並同時突破近期高點' },
  macdAboveZero:   { name: 'MACD 零軸上交叉',   desc: 'MACD 柱狀體在零軸以上由負翻正，多頭確認' },
  // 離場
  kdDeathCross:    { name: 'KD 死亡交叉',       desc: 'K 線從高檔下穿 D 線，頭部反轉弱訊號' },
  rsiOverbought:   { name: 'RSI 超買回落',      desc: 'RSI 從超買區跌破門檻，追高風險升高' },
  maDeathCross:    { name: 'MA 均線死亡交叉',   desc: '短均線下穿長均線，趨勢轉空頭排列' },
  bollingerUpper:  { name: '布林上軌反壓',       desc: '股價觸碰布林上軌後回落通道，阻力強勁' },
  macdBelowZero:   { name: 'MACD 零軸下交叉',   desc: 'MACD 柱狀體在零軸以下由正翻負，空頭確認' },
};

const SIGNAL_PARAMS: Record<keyof SignalConfig, { label: string; key: string }[]> = {
  kdGoldenCross:   [{ label: '超賣門檻（K 值上限）',   key: 'oversoldThreshold' }],
  rsiOversold:     [{ label: 'RSI 超賣門檻',           key: 'threshold' }],
  maGoldenCross:   [{ label: '短均線天數', key: 'shortPeriod' }, { label: '長均線天數', key: 'longPeriod' }],
  bollingerBounce: [{ label: '標準差倍數', key: 'stdDev' }],
  volumeBreak:     [{ label: '量能倍數',   key: 'volumeMultiplier' }, { label: '突破天數', key: 'breakDays' }],
  macdAboveZero:   [],
  kdDeathCross:    [{ label: '超買門檻（K 值下限）',   key: 'overboughtThreshold' }],
  rsiOverbought:   [{ label: 'RSI 超買門檻',           key: 'threshold' }],
  maDeathCross:    [{ label: '短均線天數', key: 'shortPeriod' }, { label: '長均線天數', key: 'longPeriod' }],
  bollingerUpper:  [{ label: '標準差倍數', key: 'stdDev' }],
  macdBelowZero:   [],
};

export default function AlertsScreen() {
  const [profiles,    setProfiles]    = useState<SignalProfile[]>([]);
  const [activeId,    setActiveId]    = useState('');
  const [showPicker,  setShowPicker]  = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName,     setNewName]     = useState('');
  const [newTicker,   setNewTicker]   = useState('');
  const [syncing,     setSyncing]     = useState(false);
  const [lastSync,    setLastSync]    = useState<string | null>(null);

  const activeProfile = profiles.find(p => p.id === activeId) ?? profiles[0];
  const config = activeProfile?.config ?? DEFAULT_SIGNAL_CONFIG;

  useEffect(() => { loadProfiles(); }, []);

  const loadProfiles = async () => {
    const [raw, aid, legacyRaw] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_PROFILES),
      AsyncStorage.getItem(STORAGE_KEY_ACTIVE),
      AsyncStorage.getItem(STORAGE_KEY_SIGNALS),
    ]);
    if (raw) {
      const loaded: SignalProfile[] = JSON.parse(raw);
      // 若舊設定檔缺少新欄位，補上預設值
      const migrated = loaded.map(p => ({
        ...p,
        config: { ...DEFAULT_SIGNAL_CONFIG, ...p.config },
      }));
      setProfiles(migrated);
      const validId = aid && migrated.find(p => p.id === aid) ? aid : migrated[0]?.id ?? '';
      setActiveId(validId);
      await AsyncStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(migrated));
    } else {
      const defaultConfig = legacyRaw ? { ...DEFAULT_SIGNAL_CONFIG, ...JSON.parse(legacyRaw) } : DEFAULT_SIGNAL_CONFIG;
      const first: SignalProfile = { id: Date.now().toString(), name: '預設設定檔', ticker: '', config: defaultConfig };
      setProfiles([first]);
      setActiveId(first.id);
      await AsyncStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify([first]));
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVE, first.id);
    }
  };

  const persistProfiles = async (next: SignalProfile[], nextId?: string) => {
    setProfiles(next);
    await AsyncStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(next));
    if (nextId !== undefined) {
      setActiveId(nextId);
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVE, nextId);
    }
  };

  const saveConfig = async (next: SignalConfig) => {
    await persistProfiles(profiles.map(p => p.id === activeId ? { ...p, config: next } : p));
  };

  const switchProfile = async (id: string) => {
    setActiveId(id);
    await AsyncStorage.setItem(STORAGE_KEY_ACTIVE, id);
    setShowPicker(false);
  };

  const createProfile = async () => {
    if (!newName.trim()) { Alert.alert('請輸入設定檔名稱'); return; }
    const profile: SignalProfile = {
      id: Date.now().toString(),
      name: newName.trim(),
      ticker: newTicker.trim().toUpperCase(),
      config: { ...DEFAULT_SIGNAL_CONFIG },
    };
    await persistProfiles([...profiles, profile], profile.id);
    setNewName('');
    setNewTicker('');
    setShowNewForm(false);
  };

  const deleteProfile = () => {
    if (profiles.length <= 1) { Alert.alert('無法刪除', '至少保留一個設定檔'); return; }
    Alert.alert('刪除設定檔', `確定刪除「${activeProfile?.name}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '刪除', style: 'destructive', onPress: async () => {
        const next = profiles.filter(p => p.id !== activeId);
        await persistProfiles(next, next[0].id);
      }},
    ]);
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
        const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
        setLastSync(now);
        const entryOn = ENTRY_SIGNAL_KEYS.filter(k => config[k].enabled).length;
        const exitOn  = EXIT_SIGNAL_KEYS.filter(k => config[k].enabled).length;
        Alert.alert('同步成功 ✓', `後台已更新\n自選股：${watchlist.length} 檔\n庫存：${portfolio.length} 檔\n進場訊號：${entryOn} 個　離場訊號：${exitOn} 個`);
      } else {
        Alert.alert('同步失敗', '請確認 Vercel KV 已設定完成');
      }
    } catch {
      Alert.alert('同步失敗', '網路錯誤，請稍後再試');
    }
    setSyncing(false);
  };

  const entryOn = ENTRY_SIGNAL_KEYS.filter(k => config[k].enabled).length;
  const exitOn  = EXIT_SIGNAL_KEYS.filter(k => config[k].enabled).length;

  const renderSignalCard = (key: keyof SignalConfig) => {
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
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>推播通知設定</Text>
        <Text style={s.headerSub}>進場 {entryOn} 個 · 離場 {exitOn} 個 · 通知透過 Telegram 傳送</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>

        {/* ── 設定檔選擇器 ── */}
        <View style={s.profileSection}>
          <Text style={s.sectionTitle}>設定檔</Text>
          <View style={s.profileRow}>
            <TouchableOpacity style={s.profilePicker} onPress={() => setShowPicker(true)}>
              <View style={{ flex: 1 }}>
                <Text style={s.profileName} numberOfLines={1}>{activeProfile?.name ?? '—'}</Text>
                {activeProfile?.ticker ? (
                  <Text style={s.profileTicker}>標的：{activeProfile.ticker}</Text>
                ) : null}
              </View>
              <Text style={s.pickerArrow}>▾</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.profileIconBtn} onPress={() => { setShowNewForm(v => !v); setNewName(''); setNewTicker(''); }}>
              <Text style={s.profileIconBtnText}>{showNewForm ? '✕' : '＋'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.profileIconBtn, s.profileDeleteBtn]} onPress={deleteProfile}>
              <Text style={[s.profileIconBtnText, { color: '#E74C3C' }]}>刪</Text>
            </TouchableOpacity>
          </View>

          {showNewForm && (
            <View style={s.newFormBox}>
              <Text style={s.newFormLabel}>設定檔名稱</Text>
              <TextInput
                style={s.newFormInput}
                placeholder="例：台積電短線"
                placeholderTextColor="#bbb"
                value={newName}
                onChangeText={setNewName}
                returnKeyType="next"
              />
              <Text style={s.newFormLabel}>標的代碼（選填）</Text>
              <TextInput
                style={s.newFormInput}
                placeholder="例：2330"
                placeholderTextColor="#bbb"
                value={newTicker}
                onChangeText={setNewTicker}
                autoCapitalize="characters"
                returnKeyType="done"
                onSubmitEditing={createProfile}
              />
              <TouchableOpacity style={s.newFormConfirm} onPress={createProfile}>
                <Text style={s.newFormConfirmText}>建立設定檔</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── 進場訊號 ── */}
        <View style={s.sectionHeader}>
          <View style={[s.sectionDot, { backgroundColor: '#27AE60' }]} />
          <Text style={s.sectionTitle}>進場訊號</Text>
        </View>
        <Text style={s.sectionDesc}>觸發時傳送 📊 訊息到 Telegram</Text>
        {ENTRY_SIGNAL_KEYS.map(renderSignalCard)}

        {/* ── 離場訊號 ── */}
        <View style={[s.sectionHeader, { marginTop: 8 }]}>
          <View style={[s.sectionDot, { backgroundColor: '#E74C3C' }]} />
          <Text style={s.sectionTitle}>離場訊號</Text>
        </View>
        <Text style={s.sectionDesc}>觸發時傳送 📉 訊息到 Telegram</Text>
        {EXIT_SIGNAL_KEYS.map(renderSignalCard)}

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
          <Text style={s.infoText}>2. 開啟想要的進場 / 離場訊號並調整參數</Text>
          <Text style={s.infoText}>3. 點「同步設定到後台」儲存</Text>
          <Text style={s.infoText}>4. 觸發時自動傳訊息到你的 Telegram</Text>
          <Text style={s.infoNote}>每個訊號觸發後有 4 小時冷卻，不重複推播</Text>
        </View>

      </ScrollView>

      {/* ── 設定檔選擇 Modal ── */}
      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowPicker(false)}>
          <View style={s.pickerSheet}>
            <Text style={s.pickerTitle}>選擇設定檔</Text>
            {profiles.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[s.pickerItem, p.id === activeId && s.pickerItemActive]}
                onPress={() => switchProfile(p.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.pickerItemName, p.id === activeId && s.pickerItemNameActive]}>{p.name}</Text>
                  {p.ticker ? <Text style={s.pickerItemTicker}>{p.ticker}</Text> : null}
                </View>
                {p.id === activeId && <Text style={s.pickerCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F0F2F5' },
  header:       { backgroundColor: '#2C3E50', paddingVertical: 16, paddingHorizontal: 20, gap: 2 },
  headerTitle:  { fontSize: 20, fontWeight: 'bold', color: 'white' },
  headerSub:    { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  scroll:       { padding: 16, gap: 12, paddingBottom: 120 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sectionDot:    { width: 8, height: 8, borderRadius: 4 },
  sectionTitle:  { fontSize: 16, fontWeight: 'bold', color: '#2C3E50' },
  sectionDesc:   { fontSize: 12, color: '#888', marginTop: -6, marginBottom: 4 },

  // profile
  profileSection:     { gap: 8 },
  profileRow:         { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  profilePicker:      { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  profileName:        { fontSize: 15, fontWeight: '600', color: '#2C3E50' },
  profileTicker:      { fontSize: 11, color: '#888', marginTop: 2 },
  pickerArrow:        { fontSize: 14, color: '#95A5A6', marginLeft: 8 },
  profileIconBtn:     { backgroundColor: 'white', borderRadius: 12, width: 44, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  profileDeleteBtn:   { borderWidth: 1, borderColor: '#FADBD8' },
  profileIconBtnText: { fontSize: 16, fontWeight: 'bold', color: '#2C3E50' },

  newFormBox:         { backgroundColor: 'white', borderRadius: 12, padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  newFormLabel:       { fontSize: 12, color: '#888', fontWeight: '600' },
  newFormInput:       { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#2C3E50' },
  newFormConfirm:     { backgroundColor: '#2C3E50', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  newFormConfirmText: { color: 'white', fontWeight: 'bold', fontSize: 15 },

  // signals
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

  // modal
  modalOverlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerSheet:          { backgroundColor: 'white', borderRadius: 16, width: '100%', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  pickerTitle:          { fontSize: 14, fontWeight: 'bold', color: '#888', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  pickerItem:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F8F8F8' },
  pickerItemActive:     { backgroundColor: '#F4F6F8' },
  pickerItemName:       { fontSize: 16, color: '#444', fontWeight: '500' },
  pickerItemNameActive: { color: '#2C3E50', fontWeight: '700' },
  pickerItemTicker:     { fontSize: 12, color: '#888', marginTop: 2 },
  pickerCheck:          { fontSize: 16, color: '#2C3E50', fontWeight: 'bold' },
});
