import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * 三合一同步 Hook：
 *   1. Tab 切換自動觸發（useFocusEffect，跳過首次掛載）
 *   2. 手動刷新（觸發 triggerSync）
 *   3. 每 intervalMs 毫秒靜默背景更新（AppState 綁定，背景時暫停）
 *
 * 防禦機制：
 *   - lockRef：全域互斥鎖，防止 Race Condition / 重複點擊
 *   - AppState：app 進背景立即暫停 interval，回前景才恢復計時
 *   - fnRef：永遠呼叫最新版本的 syncFn，防止 stale closure
 */
export function useSyncData(syncFn: () => Promise<void>, intervalMs = 60_000) {
  // ── 永遠保存最新 syncFn，讓 interval callback 不因 stale closure 出問題 ──
  const fnRef = useRef(syncFn);
  useEffect(() => { fnRef.current = syncFn; }, [syncFn]);

  // ── 互斥鎖：ref 不觸發 re-render，比 state 更適合當鎖 ──
  const lockRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const triggerSync = useCallback(async () => {
    if (lockRef.current) return; // 正在同步中，直接拒絕
    lockRef.current = true;
    setIsSyncing(true);
    try {
      await fnRef.current();
    } finally {
      lockRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // ── AppState-aware interval：背景時停，前景時跑 ──
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(triggerSync, intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') start();
      else stop();
    });

    // 初始化時如果 app 已在前景就立刻啟動
    if (AppState.currentState === 'active') start();

    return () => { stop(); sub.remove(); };
  }, [triggerSync, intervalMs]);

  // ── Tab 焦點同步：第一次掛載跳過，之後每次切回都觸發 ──
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!mounted.current) { mounted.current = true; return; }
      triggerSync();
    }, [triggerSync]),
  );

  return { isSyncing, triggerSync };
}
