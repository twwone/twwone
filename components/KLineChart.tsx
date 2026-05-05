import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

const YF_API = '/api/stock';

const PERIODS = [
  { label: '1天',      interval: '5m',  range: '1d'  },
  { label: '1週',      interval: '60m', range: '5d'  },
  { label: '1個月',    interval: '1d',  range: '1mo' },
  { label: '3個月',    interval: '1d',  range: '3mo' },
  { label: '6個月',    interval: '1d',  range: '6mo' },
  { label: '年初至今',  interval: '1d',  range: 'ytd' },
] as const;

const MA_CFGS = [
  { period: 5,  color: '#FFD60A' },
  { period: 20, color: '#32D4F5' },
  { period: 60, color: '#BF5AF2' },
];

const CHART_H = 220;
const VOL_H   = 36;
const PAD_TOP = 10;
const PAD_BOT = 24;
const Y_W     = 58;

interface Pt {
  timestamp: number;
  open: number; high: number; low: number; close: number;
  volume: number;
}
interface Meta {
  open: number; hi: number; lo: number; vol: number;
  mktCap?: number; pe?: number; wk52Hi?: number; wk52Lo?: number;
}

const fmtP  = (p: number) => p >= 1000 ? p.toFixed(1) : p.toFixed(2);
const fmtV  = (v: number) => v >= 1e8 ? `${(v/1e8).toFixed(1)}億` : v >= 1e4 ? `${Math.round(v/1e4)}萬` : v.toLocaleString();
const fmtMC = (v: number) => v >= 1e12 ? `${(v/1e12).toFixed(2)}兆` : v >= 1e8 ? `${Math.round(v/1e8)}億` : v.toLocaleString();

function fmtTime(ts: number, intra: boolean, short = false): string {
  const d = new Date(ts * 1000);
  if (intra) return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
  return short ? `${d.getMonth()+1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}

function calcMA(pts: Pt[], period: number): (number | null)[] {
  return pts.map((_, i) => {
    if (i < period - 1) return null;
    return pts.slice(i - period + 1, i + 1).reduce((s, p) => s + p.close, 0) / period;
  });
}

function buildPath(vals: (number | null)[], toX: (i: number) => number, toY: (v: number) => number): string {
  let d = ''; let first = true;
  vals.forEach((v, i) => {
    if (v == null) return;
    d += first ? `M${toX(i).toFixed(1)},${toY(v).toFixed(1)}` : ` L${toX(i).toFixed(1)},${toY(v).toFixed(1)}`;
    first = false;
  });
  return d;
}

async function load(symbol: string, interval: string, range: string): Promise<{ pts: Pt[]; meta: Meta }> {
  const res  = await fetch(`${YF_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`);
  if (!res.ok) throw new Error();
  const json = await res.json();
  const r    = json.chart.result[0];
  const m    = r.meta;
  const ts   = r.timestamp ?? [];
  const q    = r.indicators.quote[0];

  const pts: Pt[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || isNaN(c)) continue;
    pts.push({
      timestamp: ts[i],
      open:   q.open?.[i]   ?? c,
      high:   q.high?.[i]   ?? c,
      low:    q.low?.[i]    ?? c,
      close:  c,
      volume: q.volume?.[i] ?? 0,
    });
  }

  return {
    pts,
    meta: {
      open:   m.regularMarketOpen    ?? 0,
      hi:     m.regularMarketDayHigh ?? 0,
      lo:     m.regularMarketDayLow  ?? 0,
      vol:    m.regularMarketVolume  ?? 0,
      mktCap: m.marketCap,
      pe:     m.trailingPE,
      wk52Hi: m.fiftyTwoWeekHigh,
      wk52Lo: m.fiftyTwoWeekLow,
    },
  };
}

export default function KLineChart({ symbol }: { symbol: string }) {
  const W = useWindowDimensions().width;

  const [pi,        setPi]        = useState(1);
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle');
  const [pts,       setPts]       = useState<Pt[]>([]);
  const [meta,      setMeta]      = useState<Meta | null>(null);
  const [busy,      setBusy]      = useState(true);
  const [err,       setErr]       = useState<string | null>(null);
  const [crossIdx,  setCrossIdx]  = useState<number | null>(null);

  useEffect(() => {
    setBusy(true); setErr(null); setCrossIdx(null);
    const { interval, range } = PERIODS[pi];
    load(symbol, interval, range)
      .then(d => { setPts(d.pts); setMeta(d.meta); setBusy(false); })
      .catch(() => { setErr('資料載入失敗'); setBusy(false); });
  }, [symbol, pi]);

  const isIntra = pi === 0;

  const chart = useMemo(() => {
    if (pts.length < 2) return null;
    const innerW = W - Y_W;
    const innerH = CHART_H - PAD_TOP - PAD_BOT;

    const vMax   = chartType === 'candle' ? Math.max(...pts.map(p => p.high))  : Math.max(...pts.map(p => p.close));
    const vMin   = chartType === 'candle' ? Math.min(...pts.map(p => p.low))   : Math.min(...pts.map(p => p.close));
    const vRange = vMax - vMin || 1;

    const toY = (v: number) => PAD_TOP + innerH * (1 - (v - vMin) / vRange);
    const toX = (i: number) => (i / (pts.length - 1)) * innerW;

    const yLabels = Array.from({ length: 5 }, (_, i) => vMin + (vRange / 4) * i);

    const step = Math.max(1, Math.floor(pts.length / 5));
    const xLabels: { x: number; t: string }[] = [];
    for (let i = 0; i < pts.length; i += step)
      xLabels.push({ x: toX(i), t: fmtTime(pts[i].timestamp, isIntra, true) });

    const isUp      = pts[pts.length-1].close >= pts[0].close;
    const lineColor = isUp ? '#FF3B30' : '#30D158';
    const linePath  = pts.map((p, i) => `${i===0?'M':'L'}${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`).join(' ');
    const base      = CHART_H - PAD_BOT;
    const areaPath  = `${linePath} L${toX(pts.length-1).toFixed(1)},${base} L0,${base} Z`;

    const slotW   = innerW / pts.length;
    const candleW = Math.max(slotW * 0.7, 1);

    const mas  = MA_CFGS.map(cfg => ({ ...cfg, path: buildPath(calcMA(pts, cfg.period), toX, toY) }));

    const vols   = pts.map(p => p.volume);
    const volMax = Math.max(...vols) || 1;
    const barW   = Math.max(slotW - 0.5, 0.5);

    return { toY, toX, yLabels, xLabels, lineColor, linePath, areaPath, candleW, mas, vols, volMax, barW };
  }, [pts, W, isIntra, chartType]);

  // Stable callback ref so PanResponder (created once) always reads latest state
  const touchRef = useRef((_x: number) => {});
  touchRef.current = (x: number) => {
    if (!chart || pts.length < 2) return;
    const idx = Math.round((x / (W - Y_W)) * (pts.length - 1));
    setCrossIdx(Math.max(0, Math.min(pts.length - 1, idx)));
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder:        () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder:         () => true,
    onMoveShouldSetPanResponderCapture:  () => true,
    onPanResponderTerminationRequest:    () => false,
    onPanResponderGrant:     (e) => touchRef.current(e.nativeEvent.locationX),
    onPanResponderMove:      (e) => touchRef.current(e.nativeEvent.locationX),
    onPanResponderRelease:   () => setCrossIdx(null),
    onPanResponderTerminate: () => setCrossIdx(null),
  })).current;

  const crossPt = crossIdx != null ? pts[crossIdx] : null;
  const crossX  = crossIdx != null && chart ? chart.toX(crossIdx)        : null;
  const crossY  = crossPt  && chart         ? chart.toY(crossPt.close)   : null;

  return (
    <View>
      {/* Period + chart-type toolbar */}
      <View style={s.pBar}>
        {PERIODS.map((p, i) => (
          <Pressable key={p.label} style={[s.pBtn, i === pi && s.pAct]} onPress={() => setPi(i)}>
            <Text style={[s.pTxt, i === pi && s.pActTxt]}>{p.label}</Text>
          </Pressable>
        ))}
        <View style={s.div} />
        {(['candle', 'line'] as const).map(t => (
          <Pressable key={t} style={[s.pBtn, chartType === t && s.pAct]} onPress={() => setChartType(t)}>
            <Text style={[s.pTxt, chartType === t && s.pActTxt]}>{t === 'candle' ? 'K線' : '線圖'}</Text>
          </Pressable>
        ))}
      </View>

      {/* Crosshair info bar (fixed height to avoid layout jump) */}
      <View style={s.infoBar}>
        {crossPt ? (
          <>
            <Text style={s.infoT}>{fmtTime(crossPt.timestamp, isIntra)}</Text>
            {chartType === 'candle' && (
              <>
                <Text style={s.infoItem}>開 <Text style={s.infoV}>{fmtP(crossPt.open)}</Text></Text>
                <Text style={s.infoItem}>高 <Text style={[s.infoV, { color: '#FF3B30' }]}>{fmtP(crossPt.high)}</Text></Text>
                <Text style={s.infoItem}>低 <Text style={[s.infoV, { color: '#30D158' }]}>{fmtP(crossPt.low)}</Text></Text>
              </>
            )}
            <Text style={s.infoItem}>收 <Text style={s.infoV}>{fmtP(crossPt.close)}</Text></Text>
          </>
        ) : (
          <Text style={s.infoHint}>MA5  MA20  MA60</Text>
        )}
      </View>

      {busy ? (
        <View style={s.center}>
          <ActivityIndicator color="#FF3B30" />
          <Text style={s.hint}>載入中...</Text>
        </View>
      ) : err ? (
        <View style={s.center}><Text style={s.errTxt}>{err}</Text></View>
      ) : chart ? (
        <View>
          <Svg width={W} height={CHART_H + VOL_H}>

            {/* Horizontal grid lines */}
            {chart.yLabels.map((v, i) => (
              <Line key={`g${i}`} x1={0} y1={chart.toY(v)} x2={W - Y_W} y2={chart.toY(v)}
                stroke="#252525" strokeWidth={0.5} />
            ))}

            {/* Line chart */}
            {chartType === 'line' && (
              <>
                <Path d={chart.areaPath} fill={chart.lineColor} opacity={0.12} />
                <Path d={chart.linePath} fill="none" stroke={chart.lineColor}
                  strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}

            {/* Candlestick wicks */}
            {chartType === 'candle' && pts.map((p, i) => (
              <Line key={`w${i}`}
                x1={chart.toX(i)} y1={chart.toY(p.high)}
                x2={chart.toX(i)} y2={chart.toY(p.low)}
                stroke={p.close >= p.open ? '#FF3B30' : '#30D158'} strokeWidth={1} />
            ))}

            {/* Candlestick bodies */}
            {chartType === 'candle' && pts.map((p, i) => {
              const top = chart.toY(Math.max(p.open, p.close));
              const h   = Math.max(chart.toY(Math.min(p.open, p.close)) - top, 1);
              return (
                <Rect key={`b${i}`}
                  x={chart.toX(i) - chart.candleW / 2} y={top}
                  width={chart.candleW} height={h}
                  fill={p.close >= p.open ? '#FF3B30' : '#30D158'} />
              );
            })}

            {/* Moving average lines */}
            {chart.mas.map(ma => (
              ma.path ? (
                <Path key={`ma${ma.period}`} d={ma.path}
                  fill="none" stroke={ma.color} strokeWidth={1.2} />
              ) : null
            ))}

            {/* Y-axis labels */}
            {chart.yLabels.map((v, i) => (
              <SvgText key={`y${i}`} x={W - Y_W + 6} y={chart.toY(v) + 4}
                fontSize={10} fill="#666" textAnchor="start">{fmtP(v)}</SvgText>
            ))}

            {/* X-axis labels (hidden while crosshair active) */}
            {crossX == null && chart.xLabels.map(({ x, t }, i) => (
              <SvgText key={`x${i}`} x={x} y={CHART_H - 2}
                fontSize={9} fill="#555" textAnchor="middle">{t}</SvgText>
            ))}

            {/* Volume bars */}
            {chart.vols.map((v, i) => {
              const h  = Math.max((v / chart.volMax) * (VOL_H - 2), 1);
              return (
                <Rect key={`v${i}`}
                  x={chart.toX(i) - chart.barW / 2}
                  y={CHART_H + VOL_H - h}
                  width={chart.barW} height={h}
                  fill={pts[i].close >= pts[i].open ? '#FF3B30' : '#30D158'}
                  opacity={0.35} />
              );
            })}

            {/* Crosshair overlay */}
            {crossX != null && crossY != null && crossPt != null && (
              <>
                {/* Vertical dashed line */}
                <Line x1={crossX} y1={PAD_TOP} x2={crossX} y2={CHART_H - PAD_BOT}
                  stroke="#999" strokeWidth={0.5} strokeDasharray="3,3" />
                {/* Horizontal dashed line */}
                <Line x1={0} y1={crossY} x2={W - Y_W} y2={crossY}
                  stroke="#999" strokeWidth={0.5} strokeDasharray="3,3" />
                {/* Time label on X-axis */}
                <Rect x={crossX - 30} y={CHART_H - PAD_BOT + 2}
                  width={60} height={15} fill="#3A3A3A" rx={3} />
                <SvgText x={crossX} y={CHART_H - PAD_BOT + 13}
                  fontSize={9} fill="#EEE" textAnchor="middle">
                  {fmtTime(crossPt.timestamp, isIntra, true)}
                </SvgText>
                {/* Price label on Y-axis */}
                <Rect x={W - Y_W + 2} y={crossY - 8}
                  width={Y_W - 4} height={15} fill="#3A3A3A" rx={3} />
                <SvgText x={W - Y_W / 2 + 1} y={crossY + 4}
                  fontSize={10} fill="#EEE" textAnchor="middle">
                  {fmtP(crossPt.close)}
                </SvgText>
              </>
            )}
          </Svg>

          {/* Transparent touch layer over chart area (excludes Y-axis strip) */}
          <View
            style={[StyleSheet.absoluteFill, { right: Y_W }]}
            {...panResponder.panHandlers}
          />
        </View>
      ) : null}

      {/* Stats grid */}
      {meta && !busy && !err && (
        <View style={s.grid}>
          <IR l="開盤價"  v={fmtP(meta.open)} />
          <IR l="最高價"  v={fmtP(meta.hi)} />
          <IR l="最低價"  v={fmtP(meta.lo)} />
          <IR l="成交量"  v={fmtV(meta.vol)} />
          {meta.pe     ? <IR l="本益比"   v={meta.pe.toFixed(2)} />  : null}
          {meta.mktCap ? <IR l="市值"     v={fmtMC(meta.mktCap)} /> : null}
          {meta.wk52Hi ? <IR l="52週最高" v={fmtP(meta.wk52Hi)} />  : null}
          {meta.wk52Lo ? <IR l="52週最低" v={fmtP(meta.wk52Lo)} />  : null}
        </View>
      )}
    </View>
  );
}

function IR({ l, v }: { l: string; v: string }) {
  return (
    <View style={s.iRow}>
      <Text style={s.iL}>{l}</Text>
      <Text style={s.iV}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { height: 160, justifyContent: 'center', alignItems: 'center', gap: 8 },

  pBar:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#2A2A2A' },
  pBtn:    { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 14, marginHorizontal: 1 },
  pAct:    { backgroundColor: '#3A3A3A' },
  pTxt:    { fontSize: 12, color: '#666', fontWeight: '500' },
  pActTxt: { color: '#FFF', fontWeight: '700' },
  div:     { width: 0.5, height: 16, backgroundColor: '#3A3A3A', marginHorizontal: 4 },

  infoBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 28 },
  infoT:    { fontSize: 11, color: '#888', fontWeight: '600' },
  infoItem: { fontSize: 11, color: '#888' },
  infoV:    { fontSize: 11, color: '#DDD', fontWeight: '600' },
  infoHint: { fontSize: 10, color: '#444' },

  grid:  { marginHorizontal: 16, marginTop: 12, borderRadius: 12, backgroundColor: '#1C1C1E', overflow: 'hidden', marginBottom: 32 },
  iRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: '#2C2C2E' },
  iL:    { fontSize: 13, color: '#888' },
  iV:    { fontSize: 13, color: '#FFF', fontWeight: '500' },

  hint:   { fontSize: 12, color: '#555' },
  errTxt: { fontSize: 13, color: '#FF6B6B' },
});
