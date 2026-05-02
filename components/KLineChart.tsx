import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

// ── 常數 ─────────────────────────────────────────────────────
const YF         = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

const CHART_H    = 260;   // SVG 總高（px）
const Y_AXIS_W   = 56;    // 右側 Y 軸標籤欄寬
const PAD_TOP    = 14;    // 上留白
const PAD_BOT    = 26;    // 下留白（放日期標籤）
const PAD_L      = 8;     // 左留白
const SLOT_W     = 11;    // 每根 K 棒佔用的像素寬度
const BODY_RATIO = 0.60;  // 實體寬 / SLOT_W

// ── 型別 ─────────────────────────────────────────────────────
interface Candle {
  timestamp: number;
  open: number; high: number; low: number; close: number;
}

// ── 工具 ─────────────────────────────────────────────────────
function calcMA(vals: number[], period: number): (number | null)[] {
  return vals.map((_, i) => {
    if (i < period - 1) return null;
    const s = vals.slice(i - period + 1, i + 1);
    return s.reduce((a, b) => a + b, 0) / period;
  });
}

function evenLabels(min: number, max: number, n = 5): number[] {
  return Array.from({ length: n }, (_, i) => min + (max - min) * (i / (n - 1)));
}

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toFixed(0);
  if (p >= 1000)  return p.toFixed(0);
  if (p >= 100)   return p.toFixed(1);
  return p.toFixed(2);
}

// ── API：抓取 Yahoo Finance 3 個月日K ─────────────────────────
async function fetchCandles(symbol: string): Promise<Candle[]> {
  const res  = await fetch(
    `${YF}/${encodeURIComponent(symbol)}?interval=1d&range=3mo`,
    { headers: YF_HEADERS }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const r    = json.chart.result[0];
  const ts: number[] = r.timestamp ?? [];
  const { open, high, low, close } = r.indicators.quote[0];

  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (open[i] == null || close[i] == null) continue;
    out.push({
      timestamp: ts[i],
      open:  open[i],
      high:  high[i]  ?? Math.max(open[i], close[i]),
      low:   low[i]   ?? Math.min(open[i], close[i]),
      close: close[i],
    });
  }
  return out;
}

// ── 主元件 ────────────────────────────────────────────────────
export default function KLineChart({ symbol }: { symbol: string }) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setCandles([]);
    fetchCandles(symbol)
      .then(data  => { setCandles(data);  setLoading(false); })
      .catch(()   => { setError('K 線資料載入失敗'); setLoading(false); });
  }, [symbol]);

  // 只顯示最近 60 根（約 3 個月）
  const data = useMemo(() => candles.slice(-60), [candles]);

  // ── 預先計算所有繪圖數值（避免 render 內重複計算）
  const chart = useMemo(() => {
    if (data.length === 0) return null;

    const innerH = CHART_H - PAD_TOP - PAD_BOT;
    const svgW   = PAD_L + data.length * SLOT_W + Y_AXIS_W;

    const hiMax = Math.max(...data.map(c => c.high));
    const loMin = Math.min(...data.map(c => c.low));
    const pad   = (hiMax - loMin) * 0.07;
    const vMax  = hiMax + pad;
    const vMin  = loMin - pad;
    const vRange = vMax - vMin || 1;

    // 座標轉換：價格 → SVG Y 座標
    const toY = (p: number) => PAD_TOP + innerH * (1 - (p - vMin) / vRange);
    // 第 i 根 K 棒的中心 X 座標
    const cx  = (i: number) => PAD_L + i * SLOT_W + SLOT_W / 2;

    // MA 線
    const closes   = data.map(c => c.close);
    const ma5vals  = calcMA(closes, 5);
    const ma20vals = calcMA(closes, 20);
    const toPoints = (vals: (number | null)[]): string =>
      vals.map((v, i) => v != null ? `${cx(i)},${toY(v)}` : null)
          .filter(Boolean).join(' ');

    // X 軸標籤：月份切換時顯示
    const xLabels: { i: number; label: string }[] = [];
    data.forEach((c, i) => {
      const d    = new Date(c.timestamp * 1000);
      const prev = i > 0 ? new Date(data[i - 1].timestamp * 1000) : null;
      if (i === 0 || (prev && prev.getMonth() !== d.getMonth()) || i === data.length - 1) {
        xLabels.push({ i, label: `${d.getMonth() + 1}/${d.getDate()}` });
      }
    });

    return {
      svgW,
      toY, cx,
      yLabels: evenLabels(vMin, vMax, 5),
      ma5pts:  toPoints(ma5vals),
      ma20pts: toPoints(ma20vals),
      xLabels,
    };
  }, [data]);

  // ── Loading ──
  if (loading) return (
    <View style={[s.wrap, s.center]}>
      <ActivityIndicator color="#F39C12" size="small" />
      <Text style={s.hint}>載入 K 線中...</Text>
    </View>
  );
  if (error) return (
    <View style={[s.wrap, s.center]}><Text style={s.err}>{error}</Text></View>
  );
  if (!chart) return null;

  const { svgW, toY, cx, yLabels, ma5pts, ma20pts, xLabels } = chart;
  const bodyW = SLOT_W * BODY_RATIO;

  return (
    <View style={s.wrap}>

      {/* ── 標題列 ── */}
      <View style={s.hdr}>
        <Text style={s.title}>K 線圖（近 60 交易日）</Text>
        <View style={s.legend}>
          <View style={[s.dot, { backgroundColor: '#FF8C00' }]} />
          <Text style={s.lgTxt}>MA5</Text>
          <View style={[s.dot, { backgroundColor: '#3498DB' }]} />
          <Text style={s.lgTxt}>MA20</Text>
          <Text style={s.lgTip}>　紅漲 / 綠跌</Text>
        </View>
      </View>

      {/* ── 圖表（可水平滑動）── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 2 }}
      >
        <Svg width={svgW} height={CHART_H}>

          {/* 水平格線 + Y 軸價格標籤 */}
          {yLabels.map((p, idx) => {
            const y = toY(p);
            return (
              <G key={idx}>
                <Line
                  x1={PAD_L} y1={y} x2={svgW - Y_AXIS_W} y2={y}
                  stroke="#1E3A5F" strokeWidth={0.5} strokeDasharray="3,4"
                />
                <SvgText
                  x={svgW - Y_AXIS_W + 5} y={y + 4}
                  fontSize={9} fill="#4A7FA5" textAnchor="start"
                >
                  {fmtPrice(p)}
                </SvgText>
              </G>
            );
          })}

          {/* MA20（藍色，先畫在 MA5 下方）*/}
          <Polyline
            points={ma20pts}
            fill="none" stroke="#3498DB" strokeWidth={1.2} strokeLinecap="round"
          />

          {/* MA5（橘色）*/}
          <Polyline
            points={ma5pts}
            fill="none" stroke="#FF8C00" strokeWidth={1.2} strokeLinecap="round"
          />

          {/* K 棒本體 */}
          {data.map((c, i) => {
            // 台股習慣：收 > 開 = 紅（上漲）；收 < 開 = 綠（下跌）
            const isUp   = c.close >= c.open;
            const color  = isUp ? '#E74C3C' : '#27AE60';
            const x      = cx(i);
            const bodyTop = Math.min(toY(c.open), toY(c.close));
            const bodyH   = Math.max(Math.abs(toY(c.close) - toY(c.open)), 1.5);

            return (
              <G key={c.timestamp}>
                {/* 上下影線 */}
                <Line
                  x1={x} y1={toY(c.high)} x2={x} y2={toY(c.low)}
                  stroke={color} strokeWidth={0.9}
                />
                {/* 實體 */}
                <Rect
                  x={x - bodyW / 2} y={bodyTop}
                  width={bodyW} height={bodyH}
                  fill={color} stroke={color} strokeWidth={0.3}
                />
              </G>
            );
          })}

          {/* X 軸日期標籤（月份切換時顯示）*/}
          {xLabels.map(({ i, label }) => (
            <SvgText
              key={i}
              x={cx(i)} y={CHART_H - 6}
              fontSize={9} fill="#4A7FA5" textAnchor="middle"
            >
              {label}
            </SvgText>
          ))}

        </Svg>
      </ScrollView>
    </View>
  );
}

// ── 樣式 ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  wrap: {
    backgroundColor: '#162535',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  center: { height: 110, justifyContent: 'center', alignItems: 'center', gap: 8 },

  hdr: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E3A5F',
  },
  title:  { fontSize: 14, fontWeight: 'bold', color: '#F5F5F5' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot:    { width: 7, height: 7, borderRadius: 3.5 },
  lgTxt:  { fontSize: 10, color: '#7A9BB5', marginRight: 2 },
  lgTip:  { fontSize: 10, color: '#3A5A78' },

  hint: { fontSize: 12, color: '#4A7FA5' },
  err:  { fontSize: 13, color: '#FF6B6B' },
});
