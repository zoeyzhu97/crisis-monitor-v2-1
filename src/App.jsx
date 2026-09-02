import { useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════
// 指标定义
// ═══════════════════════════════════════════════════════════
const INDICATORS = [
  { key: "credit_spread", name: "高收益信用利差 (HY OAS)", unit: " bps", thresholds: [350, 500, 700], weight: 3.0, desc: "核心信号：企业违约风险定价", isPrimary: true, fmt: v => Math.round(v),
    note: "ICE BofA 美国高收益指数期权调整利差（FRED: BAMLH0A0HYM2）。104年数据中预警16/18次衰退，平均领先4个月。评分取「水平」与「20日速度」两者中较高者：20日内扩大超过100 bps 视同进入警戒期，超过200 bps 视同确认期。" },
  { key: "vix", name: "VIX 恐慌指数", unit: "", thresholds: [20, 30, 40], weight: 2.0, desc: "确认信号：市场恐慌程度", fmt: v => v.toFixed(2),
    note: "同步/滞后指标。VIX 飙升时危机已在发生，它的作用是确认而不是预警。" },
  { key: "us_10y", name: "美国10年期国债收益率", unit: "%", thresholds: [4.5, 5.0, 5.5], weight: 1.5, desc: "全球资产定价之锚", fmt: v => v.toFixed(2),
    note: "只对「利率冲击型」危机（2022）有效。信用危机中资金涌入美债，收益率反而下降，此时本项会降低总分，这是设计上已知的局限。" },
  { key: "uk_10y", name: "英国10年期国债收益率", unit: "%", thresholds: [4.5, 5.0, 5.5], weight: 1.5, desc: "英国主权债务压力", fmt: v => v.toFixed(2),
    note: "英格兰银行 10 年期票面收益率（IUDMNPY）。2022年 mini-budget 危机时从3.5%升到4.5%即引发养老基金连锁爆仓。" },
  { key: "brent", name: "布伦特原油", unit: " $/桶", thresholds: [85, 105, 130], weight: 1.5, desc: "外生能源冲击", fmt: v => v.toFixed(2),
    note: "高油价制造滞胀陷阱，束缚央行降息空间。" },
  { key: "gbp_cny", name: "英镑/人民币", unit: "", thresholds: [9.0, 8.5, 8.0], weight: 1.0, desc: "英镑强弱（学费相关）", inverted: true, fmt: v => v.toFixed(3),
    note: "2008年从15跌至10，跌幅33%。" },
  { key: "gold", name: "黄金", unit: " $/oz", thresholds: [2800, 3500, 4200], weight: 0.8, desc: "避险需求", fmt: v => v.toFixed(0),
    note: "阈值已根据央行购金结构性牛市上调。金价高企不等于危机，权重最低。" },
  { key: "dxy", name: "美元指数 DXY", unit: "", thresholds: [101, 106, 112], weight: 0.8, desc: "美元避险强度", fmt: v => v.toFixed(2),
    note: "危机中资金涌入美元推高 DXY。" },
];

const SPEED_THRESHOLDS = [100, 200, 350]; // HY OAS 20 日扩大幅度（bps）
const HY_PROXY_THRESHOLDS = [-2, -5, -10]; // HYG/IEI 20 日变化（%，越负压力越大）

// ═══════════════════════════════════════════════════════════
// 历史危机数据
// ═══════════════════════════════════════════════════════════
const CRISES = [
  { name: "1998 俄罗斯/LTCM", type: "流动性冲击", typeBg: "#E3F2FD", typeColor: "#1565C0", drop: -26, downMonths: 3, fullRecovery: "3个月", trigger: "美联储9月降息" },
  { name: "2000 互联网泡沫", type: "估值崩塌", typeBg: "#F3E5F5", typeColor: "#7B1FA2", drop: -78, downMonths: 31, fullRecovery: "15年", trigger: "估值逐渐合理化" },
  { name: "2007 全球金融危机", type: "信用危机", typeBg: "#FFEBEE", typeColor: "#C62828", drop: -56, downMonths: 17, fullRecovery: "约3年", trigger: "美联储零利率+QE" },
  { name: "2011 欧债危机", type: "局部冲击", typeBg: "#E3F2FD", typeColor: "#1565C0", drop: -20, downMonths: 3, fullRecovery: "7个月", trigger: "ECB干预" },
  { name: "2015 能源/中国", type: "局部冲击", typeBg: "#E3F2FD", typeColor: "#1565C0", drop: -18, downMonths: 7, fullRecovery: "约1年", trigger: "油价企稳+中国刺激" },
  { name: "2018 流动性紧缩", type: "流动性冲击", typeBg: "#E3F2FD", typeColor: "#1565C0", drop: -24, downMonths: 4, fullRecovery: "8个月", trigger: "美联储2019年1月转鸽" },
  { name: "2020 COVID", type: "外生冲击", typeBg: "#FFF8E1", typeColor: "#F57F17", drop: -30, downMonths: 1, fullRecovery: "3个月", trigger: "美联储无限QE+财政刺激" },
  { name: "2022 通胀紧缩", type: "利率冲击", typeBg: "#FFF3E0", typeColor: "#E65100", drop: -37, downMonths: 11, fullRecovery: "约2年", trigger: "通胀见顶+AI概念" },
];

// ═══════════════════════════════════════════════════════════
// 评分
// ═══════════════════════════════════════════════════════════
function scoreOne(v, t, inv) {
  if (v == null) return null;
  if (inv) return v >= t[0] ? 1 : v >= t[1] ? 4 : v >= t[2] ? 7 : 9.5;
  return v <= t[0] ? 1 : v <= t[1] ? 4 : v <= t[2] ? 7 : 9.5;
}

// 核心信用信号：OAS 水平、OAS 速度和 HYG/IEI 实时速度取最高风险分
function spreadScore(level, chg20, hyProxy20) {
  const a = scoreOne(level, INDICATORS[0].thresholds, false);
  const b = chg20 != null ? scoreOne(chg20, SPEED_THRESHOLDS, false) : null;
  const c = hyProxy20 != null ? scoreOne(hyProxy20, HY_PROXY_THRESHOLDS, true) : null;
  const valid = [a, b, c].filter(v => v != null);
  return valid.length ? Math.max(...valid) : null;
}

const MAX_STALE_BDAYS = 3;
function isStale(meta, key) { return !!meta?.[key]?.stale; }

function computeAll(values, derived, meta) {
  if (!values) return { scores: INDICATORS.map(() => null), overall: null, avg: null, floored: false, excluded: [] };
  const excluded = [];
  const sc = INDICATORS.map(i => {
    if (i.key === "credit_spread") {
      const oasStale = isStale(meta, "credit_spread");
      const proxyStale = isStale(meta, "hyg") || isStale(meta, "iei");
      if (oasStale) excluded.push(i.key);
      return spreadScore(
        oasStale ? null : values.credit_spread,
        oasStale ? null : derived?.credit_spread_20d_change,
        proxyStale ? null : derived?.hy_proxy_20d_pct,
      );
    }
    if (isStale(meta, i.key)) { excluded.push(i.key); return null; }
    return scoreOne(values[i.key], i.thresholds, i.inverted);
  });
  let tw = 0, ts = 0;
  sc.forEach((s, i) => { if (s != null) { tw += INDICATORS[i].weight; ts += s * INDICATORS[i].weight; } });
  const avg = tw > 0 ? ts / tw : null;
  // 核心信号地板：其余 7 项平静时，利差单独进入确认/危机期也必须把总分拉进高风险区
  const floor = sc[0] != null ? sc[0] * 0.85 : null;
  const overall = avg == null ? null : floor == null ? avg : Math.max(avg, floor);
  return { scores: sc, overall, avg, floored: overall != null && avg != null && overall > avg + 0.05, excluded };
}

function rc(s) { return s == null ? "#9C948A" : s <= 2.5 ? "#2E7D32" : s <= 5 ? "#F9A825" : s <= 7.5 ? "#E65100" : "#C62828"; }
function rbg(s) { return s == null ? "#F2EFE9" : s <= 2.5 ? "#E8F5E9" : s <= 5 ? "#FFF8E1" : s <= 7.5 ? "#FFF3E0" : "#FFEBEE"; }
function rl(s) { return s == null ? "等待数据" : s <= 2.5 ? "低风险" : s <= 5 ? "中等" : s <= 7.5 ? "高风险" : "极高风险"; }

function daysBetween(a, b) { return Math.round((new Date(a) - new Date(b)) / 86400000); }

// ═══════════════════════════════════════════════════════════
// 三层危机评估
// ═══════════════════════════════════════════════════════════
function assessCrisisLayers(values, derived) {
  if (!values) return null;
  const dd = derived?.nasdaq_drawdown_pct;
  const valStatus = dd == null ? "monitor" : dd < -30 ? "critical" : dd < -20 ? "high" : dd < -10 ? "elevated" : "normal";
  const layers = [
    {
      name: "外生冲击层", icon: "⛽",
      status: values.brent > 130 ? "critical" : values.brent > 105 ? "high" : values.brent > 85 ? "elevated" : "normal",
      desc: values.brent > 130 ? "能源危机级别，类似1973/2022年。滞胀陷阱风险极高。"
        : values.brent > 105 ? "油价偏高，通胀压力上升，央行降息空间被压缩。"
        : values.brent > 85 ? "油价温和偏高，尚未构成系统性威胁。"
        : "能源价格正常，无外生冲击。",
    },
    {
      name: "主权债务层", icon: "🏛",
      status: values.uk_10y > 5.5 ? "critical" : values.uk_10y > 5.0 ? "high" : values.uk_10y > 4.5 ? "elevated" : "normal",
      desc: values.uk_10y > 5.5 ? "英国国债收益率超过2008年水平，主权债务危机信号。"
        : values.uk_10y > 5.0 ? "英国国债收益率处于高风险区间，财政脆弱性暴露。远超2022年mini-budget危机水平。"
        : values.uk_10y > 4.5 ? "英国国债收益率偏高，需关注秋季预算和财政走势。"
        : "英国国债收益率在可控范围内。",
    },
    {
      name: "估值泡沫层", icon: "🤖",
      status: valStatus,
      desc: dd == null ? "缺少纳斯达克回撤数据。"
        : `纳斯达克距 52 周高点回撤 ${dd.toFixed(1)}%，近 20 日 ${derived.nasdaq_20d_pct >= 0 ? "+" : ""}${derived.nasdaq_20d_pct?.toFixed(1)}%。`
          + (dd < -20 ? " 估值重估已在进行，参考2000/2022年。" : dd < -10 ? " 已进入调整区间。" : " 尚未出现估值重估迹象，但AI概念集中度风险仍在，回撤是确认信号而非预警。"),
    },
  ];
  const statusColor = { critical: "#C62828", high: "#E65100", elevated: "#F9A825", normal: "#2E7D32", monitor: "#1565C0" };
  const statusLabel = { critical: "危险", high: "高风险", elevated: "偏高", normal: "正常", monitor: "持续观察" };
  const statusBg = { critical: "#FFEBEE", high: "#FFF3E0", elevated: "#FFF8E1", normal: "#E8F5E9", monitor: "#E3F2FD" };

  const active = layers.filter(l => l.status === "critical" || l.status === "high").length;
  let r;
  if (active === 0) r = { label: "当前无叠加危机信号", desc: "如果发生调整，大概率是局部冲击或流动性事件，参考1998/2018/2020模式。", timeline: "预计跌15-25%，央行干预后3-6个月恢复。", color: "#2E7D32" };
  else if (active === 1) r = { label: "单层压力", desc: "一个风险层处于高位，但未形成叠加。参考2011欧债或2015能源模式。", timeline: "预计跌20-30%，1-2年恢复至前高。", color: "#F9A825" };
  else if (active === 2) r = { label: "双层叠加", desc: "两个风险层同时恶化。参考2007-2009模式。如果央行因通胀无法降息，恢复将显著更慢。", timeline: "预计跌35-50%，3-5年恢复至前高。", color: "#E65100" };
  else r = { label: "三层叠加（最危险）", desc: "能源冲击+主权债务危机+估值重估同时发生。央行被通胀困住无法救市（滞胀陷阱）。", timeline: "预计跌50-70%，恢复至前高可能需要5-10年。不会出现V型反弹。", color: "#C62828" };
  return { layers, statusColor, statusLabel, statusBg, recoveryScenario: r };
}

// ═══════════════════════════════════════════════════════════
// 纳斯达克建议
// ═══════════════════════════════════════════════════════════
function nasdaqAdvice(score, cs, chg20) {
  if (score == null) return { action: "等待数据", detail: "", phase: "", reentry: "" };
  const fast = chg20 != null && chg20 >= SPEED_THRESHOLDS[0];
  const speedNote = fast ? ` 近20日利差扩大 ${Math.round(chg20)} bps，速度信号已触发。` : "";

  if (cs != null && (cs > 700 || (chg20 != null && chg20 >= SPEED_THRESHOLDS[2]))) return {
    action: "立即大幅减仓",
    detail: "信用利差进入危机期。历史上无一例外伴随20%以上股市跌幅。2008年利差突破700后纳斯达克又跌了36%，底部在16个月后。" + speedNote,
    phase: "当前相当于2008年3月的位置。",
    reentry: "等待美联储宣布降息或重启QE。历史上每一次持续反弹都由央行政策转向触发。在此之前的任何反弹都可能是死猫跳。",
  };
  if (cs != null && (cs > 500 || (chg20 != null && chg20 >= SPEED_THRESHOLDS[1]))) return {
    action: "显著减仓至50%以下",
    detail: "信用利差进入确认期。三次信用驱动型危机（1998、2007、2015）中均在此后出现15%以上下跌。" + speedNote,
    phase: "关键观察：如果利差在几周内回落（1998模式），可能只是局部冲击，3-6个月恢复。如果继续攀升（2008模式），做好12-18个月下跌的准备。",
    reentry: "",
  };
  if (cs != null && (cs > 350 || fast)) return {
    action: "开始减仓，降低杠杆",
    detail: (cs > 350 ? "信用利差突破350，从历史低位进入警戒区。" : "利差水平仍低，但20日扩大速度已达警戒阈值。") + "2007年利差突破350后纳斯达克还有约4个月才见顶。" + speedNote,
    phase: "这是行动窗口，不是恐慌信号。减少10-15%仓位，停止追涨，准备后续方案。",
    reentry: "",
  };
  if (score <= 2.5) return {
    action: "正常持有",
    detail: "信用利差处于低位且未加速，系统性风险信号均未触发。可按既定策略持有。",
    phase: "当前状态类似2005-2006年或2017年。注意2007年6月利差也是241的「完美安全」水平，6周后开始转向。低利差是平静，不是保证。",
    reentry: "",
  };
  return {
    action: "谨慎持有，保留现金",
    detail: "部分指标升温但信用利差未突破关键阈值。建议保留15-20%现金。",
    phase: "",
    reentry: "",
  };
}

// ═══════════════════════════════════════════════════════════
// 数据加载（静态 JSON，由 scripts/fetch_daily.py 每日生成）
// ═══════════════════════════════════════════════════════════
const BASE = import.meta.env.BASE_URL || "./";
async function loadJSON(name) {
  const r = await fetch(`${BASE}data/${name}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.json();
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
const S = { card: { background: "#fff", border: "1px solid #EDE9E1", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" } };

function Gauge({ score }) {
  const pct = ((score ?? 0) / 10) * 100;
  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 200 110" style={{ width: "100%", maxWidth: 260 }}>
        <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="#EDE9E1" strokeWidth="10" strokeLinecap="round" />
        <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke={rc(score)} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * 267} 267`} style={{ transition: "stroke-dasharray 0.8s" }} />
        <text x="100" y="82" textAnchor="middle" fill={rc(score)} style={{ fontSize: 34, fontWeight: 800, fontFamily: "var(--mono)" }}>
          {score != null ? score.toFixed(1) : "—"}
        </text>
        <text x="100" y="100" textAnchor="middle" fill={rc(score)} style={{ fontSize: 13, fontWeight: 700 }}>{rl(score)}</text>
      </svg>
    </div>
  );
}

function Sparkline({ points, color }) {
  if (!points || points.length < 2) return null;
  const vs = points.map(p => p.v);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const W = 600, H = 70;
  const path = vs.map((v, i) => `${i === 0 ? "M" : "L"}${(i / (vs.length - 1)) * W},${H - ((v - min) / span) * (H - 6) - 3}`).join(" ");
  const bands = [350, 500, 700].filter(b => b > min && b < max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 70, display: "block" }} preserveAspectRatio="none">
      {bands.map(b => <line key={b} x1="0" x2={W} y1={H - ((b - min) / span) * (H - 6) - 3} y2={H - ((b - min) / span) * (H - 6) - 3} stroke="#E5E0D8" strokeDasharray="4 4" />)}
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function IndicatorCard({ ind, value, score, meta, derived, today }) {
  const [open, setOpen] = useState(false);
  const staleB = meta?.stale_bdays ?? null;
  const isStaleCard = !!meta?.stale;
  const chg = ind.isPrimary ? derived?.credit_spread_20d_change : null;
  return (
    <div style={{ ...S.card, borderLeft: !isStaleCard && score > 5 ? `3px solid ${rc(score)}` : undefined, cursor: "pointer", opacity: isStaleCard ? 0.55 : 1, background: isStaleCard ? "#FAFAF8" : "#fff" }} onClick={() => setOpen(!open)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#6B635A" }}>{ind.desc}</span>
        {isStaleCard
          ? <span style={{ fontSize: 10, fontWeight: 600, color: "#6B635A", background: "#EDE9E1", padding: "3px 10px", borderRadius: 20 }}>数据过期，未计分</span>
          : <span style={{ fontSize: 10, fontWeight: 600, color: rc(score), background: rbg(score), padding: "3px 10px", borderRadius: 20 }}>{rl(score)}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--mono)" }}>{value != null ? ind.fmt(value) : "—"}</span>
        <span style={{ fontSize: 12, color: "#9C948A" }}>{ind.unit}</span>
        {chg != null && (
          <span style={{ marginLeft: 8, fontSize: 12, fontFamily: "var(--mono)", fontWeight: 600, color: chg >= SPEED_THRESHOLDS[0] ? "#C62828" : chg > 0 ? "#E65100" : "#2E7D32" }}>
            20日 {chg >= 0 ? "+" : ""}{Math.round(chg)} bps
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#6B635A", fontWeight: 500, marginTop: 2 }}>{ind.name}</div>
      {ind.isPrimary && <div style={{ fontSize: 10, color: "#C9651A", marginTop: 4, fontWeight: 600 }}>★ 核心信号（权重 ×3.0，OAS 与 HYG/IEI 速度取高）</div>}
      <div style={{ height: 3, background: "#F2EFE9", borderRadius: 2, marginTop: 8 }}>
        <div style={{ height: "100%", borderRadius: 2, background: rc(score), width: `${((score ?? 0) / 10) * 100}%`, transition: "width 0.6s" }} />
      </div>
      <div style={{ fontSize: 10, color: isStaleCard ? "#E65100" : "#9C948A", marginTop: 6 }}>
        {meta ? `${meta.source} · 数据日期 ${meta.as_of}${staleB > 0 ? ` · ${staleB} 个交易日前` : ""}` : "无来源信息"}
      </div>
      {open && <div style={{ marginTop: 10, fontSize: 11, color: "#9C948A", lineHeight: 1.7, borderTop: "1px solid #EDE9E1", paddingTop: 8 }}>{ind.note}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadJSON("latest.json").then(setLatest).catch(e => setError(`无法读取 latest.json（${e.message}）。请先运行 python3 scripts/fetch_daily.py，或检查 GitHub Actions 是否已执行。`));
    loadJSON("history.json").then(setHistory).catch(() => {});
    loadJSON("series.json").then(setSeries).catch(() => {});
  }, []);

  const values = latest?.values, derived = latest?.derived, meta = latest?.meta;
  const today = latest?.date ?? new Date().toISOString().slice(0, 10);
  const { scores, overall, avg, floored, excluded } = computeAll(values, derived, meta);
  const fresh = latest?.freshness;
  const advice = nasdaqAdvice(overall, values?.credit_spread, derived?.credit_spread_20d_change);
  const crisis = assessCrisisLayers(values, derived);
  const fetchedAgo = latest ? daysBetween(new Date().toISOString().slice(0, 10), latest.date) : null;
  const histScored = history.map(h => ({ date: h.date, score: computeAll(h, h, null).overall })).filter(h => h.score != null);

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 16px", minHeight: "100vh" }}>
      <header style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: "#9C948A", letterSpacing: 3, textTransform: "uppercase" }}>Global Financial Crisis Monitor</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "4px 0" }}>全球金融危机监测仪表盘</h1>
        <p style={{ fontSize: 12, color: "#9C948A", margin: 0 }}>信用利差驱动 · 三层危机模型 · 每日自动抓取</p>
        {latest && (
          <div style={{ fontSize: 11, color: fetchedAgo > 2 ? "#E65100" : "#9C948A", marginTop: 6 }}>
            数据抓取于 {new Date(latest.fetched_at).toLocaleString("zh-CN")}
            {fetchedAgo > 2 && ` · 已 ${fetchedAgo} 天未更新，请检查自动任务`}
          </div>
        )}
      </header>

      {error && <div style={{ background: "#FFEBEE", border: "1px solid #FFCDD2", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "#C62828", textAlign: "center" }}>{error}</div>}

      {/* 数据新鲜度 */}
      {fresh && (
        <div style={{ ...S.card, marginBottom: 16, padding: "12px 20px", background: excluded.length ? "#FFF3E0" : "#E8F5E9", border: `1px solid ${excluded.length ? "#FFE0B2" : "#C8E6C9"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: excluded.length ? "#E65100" : "#2E7D32" }}>
              {excluded.length ? `本次评分剔除 ${excluded.length} 项过期指标` : "全部指标均在 3 个交易日内更新，评分可信"}
            </span>
            <span style={{ color: "#6B635A" }}>
              最旧一项：{INDICATORS.find(i => i.key === fresh.oldest_key)?.name ?? fresh.oldest_key}，数据日期 {fresh.oldest_as_of}（{fresh.oldest_bdays} 个交易日前）
            </span>
          </div>
          {excluded.length > 0 && (
            <div style={{ fontSize: 11, color: "#6B635A", marginTop: 6, lineHeight: 1.7 }}>
              已剔除：{excluded.map(k => `${INDICATORS.find(i => i.key === k)?.name}（${meta[k].as_of}，${meta[k].stale_bdays} 个交易日）`).join("；")}。
              过期数据继续参与评分会给出看似完整的错误结论，所以宁可缺项。请检查抓取日志对应数据源。
            </div>
          )}
        </div>
      )}

      {/* 综合评分 */}
      <div style={{ ...S.card, textAlign: "center", marginBottom: 16 }}>
        <Gauge score={overall} />
        <div style={{ fontSize: 11, color: "#9C948A", marginTop: 4 }}>综合评分 · 0 安全 → 10 极度危险</div>
        {floored && <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>加权均值为 {avg.toFixed(1)}，但信用利差单项已进入高风险区，总分按核心信号上调。</div>}
      </div>

      {/* 纳斯达克建议 */}
      <div style={{ ...S.card, marginBottom: 16, borderLeft: `3px solid ${rc(overall)}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>纳斯达克操作建议</span>
          {values?.nasdaq && <span style={{ fontSize: 13, fontFamily: "var(--mono)", color: "#6B635A" }}>NASDAQ {Math.round(values.nasdaq).toLocaleString()}{derived?.nasdaq_drawdown_pct != null && ` (${derived.nasdaq_drawdown_pct.toFixed(1)}% vs 52周高)`}</span>}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: rc(overall), marginBottom: 8 }}>{advice.action}</div>
        <div style={{ fontSize: 13, color: "#6B635A", lineHeight: 1.8 }}>{advice.detail}</div>
        {advice.phase && <div style={{ fontSize: 12, color: "#9C948A", marginTop: 8, padding: "8px 12px", background: "#F2EFE9", borderRadius: 8 }}>{advice.phase}</div>}
        {advice.reentry && <div style={{ fontSize: 12, color: "#C62828", marginTop: 8, padding: "8px 12px", background: "#FFEBEE", borderRadius: 8, fontWeight: 600 }}>何时重新入场：{advice.reentry}</div>}
      </div>

      {/* 信用利差：水平 + 速度 + 实时代理 */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>信用利差阶段模型</span>
          <span style={{ fontSize: 11, color: "#9C948A" }}>近 250 个交易日 HY OAS</span>
        </div>
        <Sparkline points={series?.credit_spread} color={rc(scores[0])} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, margin: "12px 0" }}>
          <Stat label="OAS 水平" v={values?.credit_spread != null ? `${Math.round(values.credit_spread)} bps` : "—"} />
          <Stat label="20 日变化" v={derived?.credit_spread_20d_change != null ? `${derived.credit_spread_20d_change >= 0 ? "+" : ""}${Math.round(derived.credit_spread_20d_change)} bps` : "—"}
            warn={derived?.credit_spread_20d_change >= SPEED_THRESHOLDS[0]} />
          <Stat label="HYG/IEI 比值 20 日" v={derived?.hy_proxy_20d_pct != null ? `${derived.hy_proxy_20d_pct >= 0 ? "+" : ""}${derived.hy_proxy_20d_pct.toFixed(2)}%` : "—"}
            warn={derived?.hy_proxy_20d_pct != null && derived.hy_proxy_20d_pct < -2}
            hint="实时代理，久期匹配。跌超2%通常对应利差扩大约100 bps，可比 FRED 早一天看到。" />
        </div>
        {[
          { range: "< 350 bps", label: "平静期", color: "#2E7D32", bg: "#E8F5E9", desc: "类似2005-2006年、2017年。信用市场自满。", active: scores[0] != null && scores[0] <= 1 },
          { range: "350–500 或 20日 +100", label: "警戒期", color: "#F9A825", bg: "#FFF8E1", desc: "2007年7月水平。距离股市见顶平均约4个月。", active: scores[0] === 4 },
          { range: "500–700 或 20日 +200", label: "确认期", color: "#E65100", bg: "#FFF3E0", desc: "如果几周内回落→局部冲击（3-6个月恢复）。如果继续攀升→系统性危机（12-18个月下跌）。", active: scores[0] === 7 },
          { range: "> 700 或 20日 +350", label: "危机期", color: "#C62828", bg: "#FFEBEE", desc: "2008年3月水平。每次都伴随20%+跌幅。底部信号：等待央行政策转向。", active: scores[0] === 9.5 },
        ].map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", background: p.active ? p.bg : "#FAFAF8", borderRadius: 8, marginBottom: 6, border: p.active ? `2px solid ${p.color}` : "1px solid transparent", opacity: p.active ? 1 : 0.45 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, marginTop: 5, flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: p.active ? p.color : "#6B635A" }}>{p.label}</span>
              <span style={{ fontSize: 11, color: "#9C948A", marginLeft: 6 }}>（{p.range}）</span>
              {p.active && <span style={{ marginLeft: 8, fontSize: 9, background: p.color, color: "#fff", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>当前</span>}
              <div style={{ fontSize: 11, color: "#6B635A", marginTop: 2, lineHeight: 1.6 }}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 三层危机模型 */}
      {crisis && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>三层危机模型</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {crisis.layers.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", background: crisis.statusBg[l.status], borderRadius: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20 }}>{l.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: crisis.statusColor[l.status], background: "#fff", padding: "2px 8px", borderRadius: 10 }}>{crisis.statusLabel[l.status]}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6B635A", lineHeight: 1.7 }}>{l.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: "14px 16px", background: crisis.recoveryScenario.color + "10", borderRadius: 8, border: `1px solid ${crisis.recoveryScenario.color}30` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: crisis.recoveryScenario.color, marginBottom: 6 }}>恢复预判：{crisis.recoveryScenario.label}</div>
            <div style={{ fontSize: 12, color: "#6B635A", lineHeight: 1.8, marginBottom: 6 }}>{crisis.recoveryScenario.desc}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1A1612" }}>{crisis.recoveryScenario.timeline}</div>
          </div>
        </div>
      )}

      {/* 指标网格 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 16 }}>
        {INDICATORS.map((ind, i) => <IndicatorCard key={ind.key} ind={ind} value={values ? values[ind.key] : null} score={scores[i]} meta={meta?.[ind.key]} derived={derived} today={today} />)}
      </div>

      {/* 危机比较表 */}
      <div style={{ ...S.card, marginBottom: 16, overflowX: "auto" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>历史危机比较（含恢复时间线）</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #E5E0D8" }}>
              {["危机", "类型", "跌幅", "下跌月数", "收复前高", "反弹触发"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "8px 5px", color: "#6B635A", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CRISES.map((c, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #EDE9E1" }}>
                <td style={{ padding: "8px 5px", fontWeight: 600, whiteSpace: "nowrap" }}>{c.name}</td>
                <td style={{ padding: "8px 5px" }}><span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 600, background: c.typeBg, color: c.typeColor }}>{c.type}</span></td>
                <td style={{ padding: "8px 5px", fontFamily: "var(--mono)", fontWeight: 700, color: c.drop < -30 ? "#C62828" : "#E65100" }}>{c.drop}%</td>
                <td style={{ padding: "8px 5px", fontFamily: "var(--mono)" }}>{c.downMonths}</td>
                <td style={{ padding: "8px 5px", fontWeight: 600, color: c.fullRecovery.includes("年") && parseInt(c.fullRecovery) > 3 ? "#C62828" : "#1A1612" }}>{c.fullRecovery}</td>
                <td style={{ padding: "8px 5px", fontSize: 10, color: "#6B635A" }}>{c.trigger}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 11, color: "#9C948A", lineHeight: 1.8 }}>
          核心规律：每次持续反弹都由央行政策转向触发。恢复速度取决于危机类型：流动性冲击最快（数月），信用危机中等（数年），估值泡沫最慢（5-15年）。
        </div>
      </div>

      {/* 历史评分 */}
      {histScored.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>历史风险评分（近 30 天）</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
            {histScored.slice(-30).map((h, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 8, fontFamily: "var(--mono)", color: rc(h.score), fontWeight: 600 }}>{h.score.toFixed(1)}</span>
                <div style={{ width: "100%", height: Math.max((h.score / 10) * 50, 3), background: rc(h.score), borderRadius: 2, opacity: 0.7 }} />
                <span style={{ fontSize: 7, color: "#9C948A" }}>{new Date(h.date).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 方法论 */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>模型说明</div>
        <div style={{ fontSize: 12, color: "#6B635A", lineHeight: 2 }}>
          核心信号是 ICE BofA 美国高收益指数期权调整利差（HY OAS），权重 ×3.0。该项评分取「绝对水平」与「20 日扩大速度」两者较高者，因为危机看的是速度而不只是水平（2020 年三周内从 350 到 1000）。综合评分是加权均值，但设有核心信号地板：其余指标平静时，利差单独进入确认期或危机期也会把总分拉到相应区间，避免出现「建议大幅减仓、总分却显示中等」的矛盾。HYG/IEI 比值作为实时代理，选 IEI 而不是 TLT 是为了让国债端久期与 HYG 匹配，消除利率变动带来的假信号。已知局限：信用利差对估值型危机（2000）和利率型危机（2022）预警较弱；美债收益率项在信用危机中会因避险买盘反向变动。所有数据由 scripts/fetch_daily.py 每日从 FRED、Yahoo Finance 和英格兰银行抓取，每张卡片标注来源和数据日期。不构成投资建议。
        </div>
      </div>

      <footer style={{ textAlign: "center", fontSize: 10, color: "#9C948A", marginTop: 24, padding: "12px 0" }}>
        数据来源：FRED · Yahoo Finance · Bank of England · 每日自动更新
      </footer>
    </div>
  );
}

function Stat({ label, v, warn, hint }) {
  return (
    <div style={{ padding: "8px 12px", background: warn ? "#FFEBEE" : "#F2EFE9", borderRadius: 8 }} title={hint}>
      <div style={{ fontSize: 10, color: "#9C948A" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--mono)", color: warn ? "#C62828" : "#1A1612" }}>{v}</div>
      {hint && <div style={{ fontSize: 9, color: "#9C948A", marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}
