import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * 三合一同步 Hook：
 *   1. Tab 切換自動觸發（useFocusEffect，跳過首次掛載）→ forceRefresh: false
 *   2. 手動刷新（triggerSync）→ forceRefresh: true，強制繞過快取
 *   3. 每 intervalMs 毫秒靜默背景更新（AppState 綁定）→ forceRefresh: false
 *
 * syncFn 收到 forceRefresh=true 時，應對 /api/stock 加上 Cache-Control: no-cache
 */
export function useSyncData(syncFn: (forceRefresh: boolean) => Promise<void>, intervalMs = 60_000) {
  const fnRef = useRef(syncFn);
  useEffect(() => { fnRef.current = syncFn; }, [syncFn]);

  const lockRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // 背景靜默同步（不顯示 loading、不強制繞過快取）
  const silentSync = useCallback(async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    try { await fnRef.current(false); }
    finally { lockRef.current = false; }
  }, []);

  // 手動觸發（顯示 loading、強制繞過快取）
  const triggerSync = useCallback(async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    setIsSyncing(true);
    try { await fnRef.current(true); }
    finally { lockRef.current = false; setIsSyncing(false); }
  }, []);

  // AppState-aware interval：背景時停，前景時跑
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (timer !== null) return; timer = setInterval(silentSync, intervalMs); };
    const stop  = () => { if (timer === null) return; clearInterval(timer); timer = null; };
    const sub = AppState.addEventListener('change', state => { if (state === 'active') start(); else stop(); });
    if (AppState.currentState === 'active') start();
    return () => { stop(); sub.remove(); };
  }, [silentSync, intervalMs]);

  // Tab 焦點同步：第一次掛載跳過，之後每次切回都靜默觸發
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!mounted.current) { mounted.current = true; return; }
      silentSync();
    }, [silentSync]),
  );

  return { isSyncing, triggerSync };
}
