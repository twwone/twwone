import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

const YF_API  = '/api/stock';
const CHART_H    = 260;
const Y_AXIS_W   = 56;
const PAD_TOP    = 14;
const PAD_BOT    = 26;
const PAD_L      = 8;
const SLOT_W     = 11;
const BODY_RATIO = 0.60;

type Period = '日' | '週' | '月' | '年';

const PERIOD_PARAMS: Record<Period, { interval: string; range: string }> = {
  '日': { interval: '1d',  range: '3mo' },
  '週': { interval: '1wk', range: '1y'  },
  '月': { interval: '1mo', range: '3y'  },
  '年': { interval: '1mo', range: '5y'  },
};

interface Candle {
  timestamp: number;
  open: number; high: number; low: number; close: number;
}

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

async function fetchCandles(symbol: string, interval: string, range: string): Promise<Candle[]> {
  const res  = await fetch(`${YF_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`);
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

export default function KLineChart({ symbol }: { symbol: string }) {
  const [period,  setPeriod]  = useState<Period>('日');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null); setCandles([]);
    const { interval, range } = PERIOD_PARAMS[period];
    fetchCandles(symbol, interval, range)
      .then(data => { setCandles(data);           setLoading(false); })
      .catch(()  => { setError('K 線資料載入失敗'); setLoading(false); });
  }, [symbol, period]);

  const chart = useMemo(() => {
    if (candles.length === 0) return null;

    const innerH  = CHART_H - PAD_TOP - PAD_BOT;
    const svgW    = PAD_L + candles.length * SLOT_W + Y_AXIS_W;
    const hiMax   = Math.max(...candles.map(c => c.high));
    const loMin   = Math.min(...candles.map(c => c.low));
    const pad     = (hiMax - loMin) * 0.07;
    const vMax    = hiMax + pad;
    const vMin    = loMin - pad;
    const vRange  = vMax - vMin || 1;

    const toY = (p: number) => PAD_TOP + innerH * (1 - (p - vMin) / vRange);
    const cx  = (i: number) => PAD_L + i * SLOT_W + SLOT_W / 2;

    const closes   = candles.map(c => c.close);
    const ma5vals  = calcMA(closes, 5);
    const ma20vals = calcMA(closes, 20);
    const toPoints = (vals: (number | null)[]): string =>
      vals.map((v, i) => v != null ? `${cx(i)},${toY(v)}` : null)
          .filter(Boolean).join(' ');

    const xLabels: { i: number; label: string }[] = [];
    candles.forEach((c, i) => {
      const d    = new Date(c.timestamp * 1000);
      const prev = i > 0 ? new Date(candles[i - 1].timestamp * 1000) : null;
      if (i === 0 || (prev && prev.getMonth() !== d.getMonth()) || i === candles.length - 1) {
        xLabels.push({ i, label: `${d.getMonth() + 1}/${d.getDate()}` });
      }
    });

    return { svgW, toY, cx, yLabels: evenLabels(vMin, vMax, 5), ma5pts: toPoints(ma5vals), ma20pts: toPoints(ma20vals), xLabels };
  }, [candles]);

  return (
    <View style={s.wrap}>

      {/* 標題列 + 週期選擇 */}
      <View style={s.hdr}>
        <View style={s.legend}>
          <View style={[s.dot, { backgroundColor: '#FF8C00' }]} />
          <Text style={s.lgTxt}>MA5</Text>
          <View style={[s.dot, { backgroundColor: '#3498DB' }]} />
          <Text style={s.lgTxt}>MA20</Text>
          <Text style={s.lgTip}>　紅漲/綠跌</Text>
        </View>
        <View style={s.periodBar}>
          {(['日', '週', '月', '年'] as Period[]).map(p => (
            <Pressable
              key={p}
              style={[s.periodBtn, period === p && s.periodActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[s.periodTxt, period === p && s.periodActiveTxt]}>{p}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#F39C12" size="small" />
          <Text style={s.hint}>載入中...</Text>
        </View>
      ) : error ? (
        <View style={s.center}><Text style={s.err}>{error}</Text></View>
      ) : chart ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 2 }}>
          <Svg width={chart.svgW} height={CHART_H}>

            {chart.yLabels.map((p, idx) => {
              const y = chart.toY(p);
              return (
                <G key={idx}>
                  <Line x1={PAD_L} y1={y} x2={chart.svgW - Y_AXIS_W} y2={y}
                    stroke="#1E3A5F" strokeWidth={0.5} strokeDasharray="3,4" />
                  <SvgText x={chart.svgW - Y_AXIS_W + 5} y={y + 4}
                    fontSize={9} fill="#4A7FA5" textAnchor="start">{fmtPrice(p)}</SvgText>
                </G>
              );
            })}

            <Polyline points={chart.ma20pts} fill="none" stroke="#3498DB" strokeWidth={1.2} strokeLinecap="round" />
            <Polyline points={chart.ma5pts}  fill="none" stroke="#FF8C00" strokeWidth={1.2} strokeLinecap="round" />

            {candles.map((c, i) => {
              const isUp    = c.close >= c.open;
              const color   = isUp ? '#E74C3C' : '#27AE60';
              const x       = chart.cx(i);
              const bodyTop = Math.min(chart.toY(c.open), chart.toY(c.close));
              const bodyH   = Math.max(Math.abs(chart.toY(c.close) - chart.toY(c.open)), 1.5);
              const bodyW   = SLOT_W * BODY_RATIO;
              return (
                <G key={c.timestamp}>
                  <Line x1={x} y1={chart.toY(c.high)} x2={x} y2={chart.toY(c.low)} stroke={color} strokeWidth={0.9} />
                  <Rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} stroke={color} strokeWidth={0.3} />
                </G>
              );
            })}

            {chart.xLabels.map(({ i, label }) => (
              <SvgText key={i} x={chart.cx(i)} y={CHART_H - 6}
                fontSize={9} fill="#4A7FA5" textAnchor="middle">{label}</SvgText>
            ))}

          </Svg>
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap:   { backgroundColor: '#162535', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#1E3A5F' },
  center: { height: 110, justifyContent: 'center', alignItems: 'center', gap: 8 },

  hdr: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#1E3A5F',
  },
  legend:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot:      { width: 7, height: 7, borderRadius: 3.5 },
  lgTxt:    { fontSize: 10, color: '#7A9BB5', marginRight: 2 },
  lgTip:    { fontSize: 10, color: '#3A5A78' },

  periodBar:       { flexDirection: 'row', gap: 4 },
  periodBtn:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#1E3A5F' },
  periodActive:    { backgroundColor: '#E74C3C' },
  periodTxt:       { fontSize: 11, color: '#7A9BB5', fontWeight: '600' },
  periodActiveTxt: { color: '#FFF' },

  hint: { fontSize: 12, color: '#4A7FA5' },
  err:  { fontSize: 13, color: '#FF6B6B' },
});
