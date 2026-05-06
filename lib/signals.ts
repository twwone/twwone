// ── 型別 ──────────────────────────────────────────────────
export interface SignalConfig {
  // 進場
  kdGoldenCross:   { enabled: boolean; oversoldThreshold: number };
  rsiOversold:     { enabled: boolean; threshold: number };
  maGoldenCross:   { enabled: boolean; shortPeriod: number; longPeriod: number };
  bollingerBounce: { enabled: boolean; stdDev: number };
  macdAboveZero:   { enabled: boolean };
  volumePullback:  { enabled: boolean; maTolerance: number };
  // 離場
  kdDeathCross:    { enabled: boolean; overboughtThreshold: number };
  rsiOverbought:   { enabled: boolean; threshold: number };
  maDeathCross:    { enabled: boolean; shortPeriod: number; longPeriod: number };
  bollingerUpper:  { enabled: boolean; stdDev: number };
  macdBelowZero:   { enabled: boolean };
}

export const ENTRY_SIGNAL_KEYS: (keyof SignalConfig)[] = [
  'kdGoldenCross', 'rsiOversold', 'maGoldenCross', 'bollingerBounce', 'macdAboveZero', 'volumePullback',
];
export const EXIT_SIGNAL_KEYS: (keyof SignalConfig)[] = [
  'kdDeathCross', 'rsiOverbought', 'maDeathCross', 'bollingerUpper', 'macdBelowZero',
];

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  kdGoldenCross:   { enabled: true,  oversoldThreshold: 20 },
  rsiOversold:     { enabled: true,  threshold: 30 },
  maGoldenCross:   { enabled: false, shortPeriod: 5, longPeriod: 20 },
  bollingerBounce: { enabled: false, stdDev: 2 },
  macdAboveZero:   { enabled: false },
  volumePullback:  { enabled: false, maTolerance: 0.015 },
  kdDeathCross:    { enabled: false, overboughtThreshold: 80 },
  rsiOverbought:   { enabled: false, threshold: 70 },
  maDeathCross:    { enabled: false, shortPeriod: 5, longPeriod: 20 },
  bollingerUpper:  { enabled: false, stdDev: 2 },
  macdBelowZero:   { enabled: false },
};

export interface TriggeredSignal {
  type:     string;
  label:    string;
  detail:   string;
  category: 'entry' | 'exit';
}

// ── 基本指標 ──────────────────────────────────────────────
export function calcMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.abs(Math.min(changes[i], 0))) / period;
  }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}

// KD 隨機指標（%K 原始值，%D 為 3 期 SMA）
export function calcKD(
  closes: number[], highs: number[], lows: number[], period = 9,
): { k: number[]; d: number[] } {
  const rawK: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1,  i + 1));
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const d: number[] = [];
  for (let i = 2; i < rawK.length; i++) {
    d.push((rawK[i] + rawK[i - 1] + rawK[i - 2]) / 3);
  }
  return { k: rawK.slice(2), d };
}

// MACD（12/26/9 EMA）
export function calcMACD(
  closes: number[], fast = 12, slow = 26, sigPeriod = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  if (closes.length < slow + sigPeriod) return { macd: [], signal: [], histogram: [] };
  const ema = (data: number[], p: number): number[] => {
    const k = 2 / (p + 1);
    return data.reduce<number[]>((acc, v) => {
      acc.push(acc.length ? v * k + acc[acc.length - 1] * (1 - k) : v);
      return acc;
    }, []);
  };
  const macd = ema(closes, fast).slice(slow - 1).map((v, i) => v - ema(closes, slow)[i + slow - 1]);
  const sig  = ema(macd, sigPeriod);
  const hist = macd.slice(sigPeriod - 1).map((v, i) => v - sig[i + sigPeriod - 1]);
  return { macd: macd.slice(sigPeriod - 1), signal: sig.slice(sigPeriod - 1), histogram: hist };
}

// 布林通道（20 日，預設 2 倍標準差）
export function calcBollinger(
  closes: number[], period = 20, stdDev = 2,
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const sd    = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd };
}

// ── 主要訊號偵測（傳入最新 N 根 K 線資料）────────────────
export function detectSignals(
  closes:  number[],
  volumes: number[],
  highs:   number[],
  lows:    number[],
  config:  SignalConfig,
): TriggeredSignal[] {
  const out: TriggeredSignal[] = [];
  if (closes.length < 30) return out;

  // ── 進場訊號 ──────────────────────────────────────────

  // 1. MA 黃金交叉
  if (config.maGoldenCross.enabled) {
    const { shortPeriod: sp, longPeriod: lp } = config.maGoldenCross;
    if (closes.length > lp + 1) {
      const prev = closes.slice(0, -1);
      const maSn = calcMA(closes, sp); const maLn = calcMA(closes, lp);
      const maSp = calcMA(prev, sp);   const maLp = calcMA(prev, lp);
      if (maSp <= maLp && maSn > maLn) {
        out.push({ category: 'entry', type: 'maGoldenCross', label: 'MA黃金交叉',
          detail: `MA${sp} ${maSn.toFixed(2)} 上穿 MA${lp} ${maLn.toFixed(2)}` });
      }
    }
  }

  // 2. RSI 超賣反彈
  if (config.rsiOversold.enabled && closes.length > 16) {
    const rsiNow  = calcRSI(closes);
    const rsiPrev = calcRSI(closes.slice(0, -1));
    if (rsiPrev < config.rsiOversold.threshold && rsiNow >= config.rsiOversold.threshold) {
      out.push({ category: 'entry', type: 'rsiOversold', label: 'RSI超賣反彈',
        detail: `RSI ${rsiPrev.toFixed(1)} → ${rsiNow.toFixed(1)}，站回 ${config.rsiOversold.threshold}` });
    }
  }

  // 3. KD 低檔黃金交叉
  if (config.kdGoldenCross.enabled && highs.length >= 12) {
    const { k, d } = calcKD(closes, highs, lows);
    if (k.length >= 2 && d.length >= 2) {
      const kN = k[k.length - 1]; const kP = k[k.length - 2];
      const dN = d[d.length - 1]; const dP = d[d.length - 2];
      if (kP <= dP && kN > dN && kN < config.kdGoldenCross.oversoldThreshold + 30) {
        out.push({ category: 'entry', type: 'kdGoldenCross', label: 'KD黃金交叉',
          detail: `K ${kN.toFixed(1)} 上穿 D ${dN.toFixed(1)}（低檔黃金交叉）` });
      }
    }
  }

  // 4. 布林下軌反彈
  if (config.bollingerBounce.enabled && closes.length >= 22) {
    const bollN = calcBollinger(closes, 20, config.bollingerBounce.stdDev);
    const bollP = calcBollinger(closes.slice(0, -1), 20, config.bollingerBounce.stdDev);
    if (closes[closes.length - 2] < bollP.lower && closes[closes.length - 1] >= bollN.lower) {
      out.push({ category: 'entry', type: 'bollingerBounce', label: '布林下軌反彈',
        detail: `從下軌 ${bollN.lower.toFixed(2)} 反彈回通道` });
    }
  }

  // 5. MACD 零軸上方黃金交叉
  if (config.macdAboveZero.enabled) {
    const { histogram, macd } = calcMACD(closes);
    if (histogram.length >= 2) {
      const hN = histogram[histogram.length - 1]; const hP = histogram[histogram.length - 2];
      const mN = macd[macd.length - 1];
      if (hP <= 0 && hN > 0 && mN > 0) {
        out.push({ category: 'entry', type: 'macdAboveZero', label: 'MACD零軸上交叉',
          detail: `MACD ${mN.toFixed(3)}，零軸以上由負翻正` });
      }
    }
  }

  // 7. 量縮回踩支撐
  if (config.volumePullback.enabled && closes.length >= 20 && volumes.length >= 6) {
    const price    = closes[closes.length - 1];
    const ma5      = calcMA(closes, 5);
    const ma10     = calcMA(closes, 10);
    const ma20     = calcMA(closes, 20);
    const todayVol = volumes[volumes.length - 1];
    const avgVol5  = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const { maTolerance } = config.volumePullback;

    const bullishAlign = price > ma5 && ma5 > ma20;
    const nearMA10     = ma10 > 0 && Math.abs(price - ma10) / ma10 <= maTolerance;
    const volumeShrink = avgVol5 > 0 && todayVol < avgVol5;

    if (bullishAlign && nearMA10 && volumeShrink) {
      const devPct = ((price - ma10) / ma10 * 100).toFixed(2);
      out.push({
        category: 'entry',
        type:     'volumePullback',
        label:    '量縮回踩',
        detail:   `多頭排列，回踩 MA10 ${ma10.toFixed(2)} (偏差 ${devPct}%)，量縮洗盤`,
      });
    }
  }

  // ── 離場訊號 ──────────────────────────────────────────

  // 8. KD 高檔死亡交叉
  if (config.kdDeathCross.enabled && highs.length >= 12) {
    const { k, d } = calcKD(closes, highs, lows);
    if (k.length >= 2 && d.length >= 2) {
      const kN = k[k.length - 1]; const kP = k[k.length - 2];
      const dN = d[d.length - 1]; const dP = d[d.length - 2];
      if (kP >= dP && kN < dN && kN > config.kdDeathCross.overboughtThreshold - 30) {
        out.push({ category: 'exit', type: 'kdDeathCross', label: 'KD死亡交叉',
          detail: `K ${kN.toFixed(1)} 下穿 D ${dN.toFixed(1)}（高檔死亡交叉）` });
      }
    }
  }

  // 9. RSI 超買回落
  if (config.rsiOverbought.enabled && closes.length > 16) {
    const rsiNow  = calcRSI(closes);
    const rsiPrev = calcRSI(closes.slice(0, -1));
    if (rsiPrev > config.rsiOverbought.threshold && rsiNow <= config.rsiOverbought.threshold) {
      out.push({ category: 'exit', type: 'rsiOverbought', label: 'RSI超買回落',
        detail: `RSI ${rsiPrev.toFixed(1)} → ${rsiNow.toFixed(1)}，跌破 ${config.rsiOverbought.threshold}` });
    }
  }

  // 10. MA 死亡交叉
  if (config.maDeathCross.enabled) {
    const { shortPeriod: sp, longPeriod: lp } = config.maDeathCross;
    if (closes.length > lp + 1) {
      const prev = closes.slice(0, -1);
      const maSn = calcMA(closes, sp); const maLn = calcMA(closes, lp);
      const maSp = calcMA(prev, sp);   const maLp = calcMA(prev, lp);
      if (maSp >= maLp && maSn < maLn) {
        out.push({ category: 'exit', type: 'maDeathCross', label: 'MA死亡交叉',
          detail: `MA${sp} ${maSn.toFixed(2)} 下穿 MA${lp} ${maLn.toFixed(2)}` });
      }
    }
  }

  // 11. 布林上軌反壓
  if (config.bollingerUpper.enabled && closes.length >= 22) {
    const bollN = calcBollinger(closes, 20, config.bollingerUpper.stdDev);
    const bollP = calcBollinger(closes.slice(0, -1), 20, config.bollingerUpper.stdDev);
    if (closes[closes.length - 2] > bollP.upper && closes[closes.length - 1] <= bollN.upper) {
      out.push({ category: 'exit', type: 'bollingerUpper', label: '布林上軌反壓',
        detail: `從上軌 ${bollN.upper.toFixed(2)} 跌回通道` });
    }
  }

  // 12. MACD 零軸下方死亡交叉
  if (config.macdBelowZero.enabled) {
    const { histogram, macd } = calcMACD(closes);
    if (histogram.length >= 2) {
      const hN = histogram[histogram.length - 1]; const hP = histogram[histogram.length - 2];
      const mN = macd[macd.length - 1];
      if (hP >= 0 && hN < 0 && mN < 0) {
        out.push({ category: 'exit', type: 'macdBelowZero', label: 'MACD零軸下交叉',
          detail: `MACD ${mN.toFixed(3)}，零軸以下由正翻負` });
      }
    }
  }

  return out;
}
