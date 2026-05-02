import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Defs,
  Line,
  LinearGradient as SvgGrad,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

const YF_API = '/api/stock';

const PERIODS = [
  { label: '1天',     interval: '5m',  range: '1d'  },
  { label: '1週',     interval: '60m', range: '5d'  },
  { label: '1個月',   interval: '1d',  range: '1mo' },
  { label: '3個月',   interval: '1d',  range: '3mo' },
  { label: '6個月',   interval: '1d',  range: '6mo' },
  { label: '年初至今', interval: '1d',  range: 'ytd' },
] as const;

const CHART_H = 200;
const VOL_H   = 36;
const PAD_TOP = 10;
const PAD_BOT = 22;
const Y_W     = 52;

interface Pt { timestamp: number; close: number; volume: number }
interface Meta {
  open: number; hi: number; lo: number; vol: number;
  mktCap?: number; pe?: number; wk52Hi?: number; wk52Lo?: number;
}

const fmtP  = (p: number) => p >= 1000 ? p.toFixed(1) : p.toFixed(2);
const fmtV  = (v: number) => v >= 1e8 ? `${(v/1e8).toFixed(1)}億` : v >= 1e4 ? `${Math.round(v/1e4)}萬` : v.toLocaleString();
const fmtMC = (v: number) => v >= 1e12 ? `${(v/1e12).toFixed(2)}兆` : v >= 1e8 ? `${Math.round(v/1e8)}億` : v.toLocaleString();

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
    pts.push({ timestamp: ts[i], close: c, volume: q.volume?.[i] ?? 0 });
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

  const [pi,  setPi]  = useState(1);
  const [pts, setPts] = useState<Pt[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(true);
  const [err,  setErr]  = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setErr(null);
    const { interval, range } = PERIODS[pi];
    load(symbol, interval, range)
      .then(d => { setPts(d.pts); setMeta(d.meta); setBusy(false); })
      .catch(() => { setErr('資料載入失敗'); setBusy(false); });
  }, [symbol, pi]);

  const isIntra = pi <= 1;

  const chart = useMemo(() => {
    if (pts.length < 2) return null;

    const innerW = W - Y_W;
    const innerH = CHART_H - PAD_TOP - PAD_BOT;
    const closes = pts.map(p => p.close);
    const vMax   = Math.max(...closes);
    const vMin   = Math.min(...closes);
    const vRange = vMax - vMin || 1;

    const toY = (v: number) => PAD_TOP + innerH * (1 - (v - vMin) / vRange);
    const toX = (i: number) => (i / (pts.length - 1)) * innerW;

    const isUp  = closes[closes.length - 1] >= closes[0];
    const color = isUp ? '#FF3B30' : '#30D158';

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`).join(' ');
    const base = CHART_H - PAD_BOT;
    const area = `${line} L${toX(pts.length - 1).toFixed(1)},${base} L0,${base} Z`;

    const yLabels = Array.from({ length: 5 }, (_, i) => vMin + (vRange / 4) * i);

    const step = Math.max(1, Math.floor(pts.length / 5));
    const xLabels: { x: number; t: string }[] = [];
    for (let i = 0; i < pts.length; i += step) {
      const d = new Date(pts[i].timestamp * 1000);
      xLabels.push({
        x: toX(i),
        t: isIntra
          ? d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })
          : `${d.getMonth() + 1}/${d.getDate()}`,
      });
    }

    const vols   = pts.map(p => p.volume);
    const volMax = Math.max(...vols) || 1;
    const barW   = Math.max(innerW / pts.length - 0.5, 0.5);

    return { color, line, area, yLabels, xLabels, toY, toX, vols, volMax, barW };
  }, [pts, W, isIntra]);

  return (
    <View>
      {/* 週期選擇 */}
      <View style={s.pBar}>
        {PERIODS.map((p, i) => (
          <Pressable key={p.label} style={[s.pBtn, i === pi && s.pAct]} onPress={() => setPi(i)}>
            <Text style={[s.pTxt, i === pi && s.pActTxt]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {busy ? (
        <View style={s.center}>
          <ActivityIndicator color="#FF3B30" />
          <Text style={s.hint}>載入中...</Text>
        </View>
      ) : err ? (
        <View style={s.center}><Text style={s.errTxt}>{err}</Text></View>
      ) : chart ? (
        <>
          <Svg width={W} height={CHART_H + VOL_H}>
            <Defs>
              <SvgGrad id="grad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%"   stopColor={chart.color} stopOpacity={0.4} />
                <Stop offset="100%" stopColor={chart.color} stopOpacity={0}   />
              </SvgGrad>
            </Defs>

            {/* 格線 */}
            {chart.yLabels.map((v, i) => (
              <Line key={i} x1={0} y1={chart.toY(v)} x2={W - Y_W} y2={chart.toY(v)} stroke="#2A2A2A" strokeWidth={0.5} />
            ))}

            {/* 面積漸層 + 折線 */}
            <Path d={chart.area} fill="url(#grad)" />
            <Path d={chart.line} fill="none" stroke={chart.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />

            {/* Y 軸標籤 */}
            {chart.yLabels.map((v, i) => (
              <SvgText key={i} x={W - Y_W + 6} y={chart.toY(v) + 4} fontSize={10} fill="#666" textAnchor="start">{fmtP(v)}</SvgText>
            ))}

            {/* X 軸標籤 */}
            {chart.xLabels.map(({ x, t }, i) => (
              <SvgText key={i} x={x} y={CHART_H - 2} fontSize={9} fill="#555" textAnchor="middle">{t}</SvgText>
            ))}

            {/* 成交量柱 */}
            {chart.vols.map((v, i) => {
              const h = Math.max((v / chart.volMax) * (VOL_H - 2), 1);
              return (
                <Rect key={i}
                  x={chart.toX(i) - chart.barW / 2}
                  y={CHART_H + VOL_H - h}
                  width={chart.barW} height={h}
                  fill={chart.color} opacity={0.35}
                />
              );
            })}
          </Svg>

          {/* 資訊格 */}
          {meta && (
            <View style={s.grid}>
              <IR l="開盤價"  v={fmtP(meta.open)} />
              <IR l="最高價"  v={fmtP(meta.hi)} />
              <IR l="最低價"  v={fmtP(meta.lo)} />
              <IR l="成交量"  v={fmtV(meta.vol)} />
              {meta.pe     ? <IR l="本益比"    v={meta.pe.toFixed(2)} />  : null}
              {meta.mktCap ? <IR l="市值"      v={fmtMC(meta.mktCap)} /> : null}
              {meta.wk52Hi ? <IR l="52週最高"  v={fmtP(meta.wk52Hi)} />  : null}
              {meta.wk52Lo ? <IR l="52週最低"  v={fmtP(meta.wk52Lo)} />  : null}
            </View>
          )}
        </>
      ) : null}
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

  pBar:    { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#2A2A2A' },
  pBtn:    { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14 },
  pAct:    { backgroundColor: '#3A3A3A' },
  pTxt:    { fontSize: 12, color: '#666', fontWeight: '500' },
  pActTxt: { color: '#FFF', fontWeight: '700' },

  grid:  { marginHorizontal: 16, marginTop: 12, borderRadius: 12, backgroundColor: '#1C1C1E', overflow: 'hidden', marginBottom: 32 },
  iRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: '#2C2C2E' },
  iL:    { fontSize: 13, color: '#888' },
  iV:    { fontSize: 13, color: '#FFF', fontWeight: '500' },

  hint:   { fontSize: 12, color: '#555' },
  errTxt: { fontSize: 13, color: '#FF6B6B' },
});
