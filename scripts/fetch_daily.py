#!/usr/bin/env python3
"""
每日自动抓取脚本 —— 全球金融危机监测仪表盘

数据来源（全部免费，无需 API Key）：
  FRED  (fredgraph.csv 公开端点)   HY OAS、VIX、美国10Y、布伦特（备用）
  Yahoo Finance (yfinance)         VIX、美国10Y、英镑/人民币、布伦特、黄金、DXY、纳斯达克、HYG、IEI
  Bank of England IADB (CSV)       英国10年期国债票面收益率

可选：设置 ANTHROPIC_API_KEY 后，任何抓取失败的字段会用 Claude + web_search 补齐。

输出（写入 public/data/，前端直接读取，不再需要浏览器里放任何密钥）：
  latest.json    今日所有指标 + 来源 + 数据日期 + 派生信号
  history.json   每日一条记录，最多保留 500 天
  series.json    HY OAS 近 250 个交易日序列（用于画图和 20 日变化）

用法：
  python scripts/fetch_daily.py            正常抓取
  python scripts/fetch_daily.py --dry-run  用内置样例数据跑一遍流程（不联网）
"""
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

TIMEOUT = 30
UA = {"User-Agent": "crisis-monitor/2.0 (personal research dashboard)"}

# 合理区间：超出即视为抓取错误，丢弃该值（防止把脏数据写进历史）
VALID_RANGE = {
    "credit_spread": (150, 3000),   # bps
    "vix": (5, 100),
    "us_10y": (0.5, 12),
    "uk_10y": (0.5, 12),
    "brent": (15, 250),
    "gbp_cny": (6, 14),
    "gold": (1000, 10000),
    "dxy": (70, 140),
    "nasdaq": (5000, 60000),
    "hyg": (40, 120),
    "iei": (90, 160),
}


def business_days_between(as_of, today):
    """as_of/today 为 YYYY-MM-DD；返回两者之间的工作日数（周一至周五），as_of 当天不计。"""
    try:
        a = datetime.strptime(as_of[:10], "%Y-%m-%d").date()
        b = datetime.strptime(today[:10], "%Y-%m-%d").date()
    except Exception:
        return None
    if b <= a:
        return 0
    n, d = 0, a
    while d < b:
        d = d.fromordinal(d.toordinal() + 1)
        if d.weekday() < 5:
            n += 1
    return n


MAX_STALE_BDAYS = 3   # 超过 3 个交易日未更新的指标不参与评分


def log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def in_range(key, v):
    lo, hi = VALID_RANGE.get(key, (-1e18, 1e18))
    return v is not None and lo <= v <= hi


# ─────────────────────────────────────────────────────────────
# FRED 公开 CSV 端点（无需密钥）
# ─────────────────────────────────────────────────────────────
def fred_series(series_id, n=400):
    """返回 [(date_str, value), ...] 按日期升序，最多 n 条，自动跳过缺失值。"""
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    # urllib 在本地与 GitHub Actions 都直接读取公开 CSV；部分网络环境下
    # requests 会在该端点无响应直至超时，而同一 URL 的系统 TLS 栈可正常访问。
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        text = r.read().decode("utf-8")
    rows = []
    for line in text.strip().splitlines()[1:]:
        d, v = line.split(",", 1)
        v = v.strip()
        if v in ("", "."):
            continue
        rows.append((d, float(v)))
    return rows[-n:]


# ─────────────────────────────────────────────────────────────
# Yahoo Finance
# ─────────────────────────────────────────────────────────────
def yahoo_history(ticker, period="2y"):
    """返回 pandas Series（收盘价，索引为日期）。失败返回 None。"""
    try:
        import yfinance as yf
        df = yf.Ticker(ticker).history(period=period, auto_adjust=False)
        if df is None or df.empty:
            return None
        s = df["Close"].dropna()
        s.index = [d.strftime("%Y-%m-%d") for d in s.index]
        return s
    except Exception as e:
        log(f"  yahoo {ticker} 失败: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# Bank of England 10年期国债票面收益率（IUDMNPY）
# ─────────────────────────────────────────────────────────────
def boe_uk_10y():
    url = (
        "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp"
        "?csv.x=yes&Datefrom=01/Jan/2024&Dateto=now&SeriesCodes=IUDMNPY"
        "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N"
    )
    r = requests.get(url, timeout=TIMEOUT, headers=UA)
    r.raise_for_status()
    lines = [l for l in r.text.strip().splitlines() if l and not l.startswith("DATE")]
    last = None
    for line in lines:
        parts = line.split(",")
        if len(parts) >= 2:
            try:
                last = (parts[0].strip(), float(parts[1]))
            except ValueError:
                continue
    if not last:
        raise RuntimeError("BoE CSV 无有效行")
    # BoE 日期格式 "29 Aug 2026"
    d = datetime.strptime(last[0], "%d %b %Y").strftime("%Y-%m-%d")
    return d, last[1]


# ─────────────────────────────────────────────────────────────
# Claude 兜底（仅用于抓取失败的字段）
# ─────────────────────────────────────────────────────────────
def claude_fallback(missing_keys):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not missing_keys:
        return {}
    desc = {
        "credit_spread": "ICE BofA US High Yield Index Option-Adjusted Spread in basis points",
        "vix": "CBOE VIX index level",
        "us_10y": "US 10-year Treasury yield in percent",
        "uk_10y": "UK 10-year gilt yield in percent",
        "brent": "Brent crude price in USD per barrel",
        "gbp_cny": "GBP/CNY exchange rate",
        "gold": "Gold spot price in USD per troy ounce",
        "dxy": "US Dollar Index DXY level",
        "nasdaq": "NASDAQ Composite index level",
    }
    wanted = {k: desc[k] for k in missing_keys if k in desc}
    prompt = (
        "Search the web for the most recent closing values of these items. "
        "Return ONLY a JSON object with these exact keys and numeric values, plus a key "
        "'as_of' with the date (YYYY-MM-DD) the values refer to. No markdown.\n"
        + json.dumps(wanted, indent=2)
    )
    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 800,
                "tools": [{"type": "web_search_20250305", "name": "web_search"}],
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=120,
        )
        r.raise_for_status()
        txt = "\n".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text")
        import re
        m = re.search(r"\{[\s\S]*\}", txt)
        if not m:
            return {}
        p = json.loads(m.group(0).replace("```json", "").replace("```", ""))
        as_of = p.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out = {}
        for k in wanted:
            v = p.get(k)
            if isinstance(v, (int, float)) and in_range(k, float(v)):
                out[k] = {"value": float(v), "source": "claude+web_search", "as_of": as_of}
        return out
    except Exception as e:
        log(f"  Claude 兜底失败: {e}")
        return {}


# ─────────────────────────────────────────────────────────────
# 派生信号
# ─────────────────────────────────────────────────────────────
def pct_change_n(series_values, n):
    """series_values: 升序 list[float]；返回相对 n 个交易日前的百分比变化。"""
    if series_values is None or len(series_values) <= n:
        return None
    a, b = series_values[-1 - n], series_values[-1]
    return (b / a - 1) * 100 if a else None


def compute_derived(fields, oas_series, hyg_s, iei_s, ndx_s):
    d = {}
    # 1) HY OAS 20 日变化（bps）—— 危机信号看的是速度而不是水平
    vals = [v for _, v in oas_series]
    if len(vals) > 20:
        d["credit_spread_20d_change"] = round(vals[-1] - vals[-21], 1)
        d["credit_spread_20d_min"] = round(min(vals[-21:]), 1)
    # 2) HYG/IEI 比值 20 日变化（%）—— 实时代理，OAS 在 FRED 上有 1 个交易日延迟
    #    选 IEI（3–7 年国债，久期 ≈ HYG）而不是 TLT，是为了消除久期错配带来的假信号
    if hyg_s is not None and iei_s is not None:
        common = hyg_s.index.intersection(iei_s.index)
        ratio = (hyg_s.loc[common] / iei_s.loc[common]).dropna()
        rv = ratio.tolist()
        chg = pct_change_n(rv, 20)
        if chg is not None:
            d["hy_proxy_20d_pct"] = round(chg, 2)
            d["hy_proxy_ratio"] = round(rv[-1], 4)
    # 3) 纳斯达克：距 252 日高点回撤（%）和 20 日变化
    if ndx_s is not None and len(ndx_s) > 20:
        nv = ndx_s.tolist()
        hi = max(nv[-252:])
        d["nasdaq_drawdown_pct"] = round((nv[-1] / hi - 1) * 100, 2)
        d["nasdaq_20d_pct"] = round(pct_change_n(nv, 20), 2)
        d["nasdaq_52w_high"] = round(hi, 2)
    return d


# ─────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────
def fetch_all():
    fields = {}   # key -> {"value", "source", "as_of"}

    def put(key, value, source, as_of):
        if in_range(key, value):
            fields[key] = {"value": round(float(value), 4), "source": source, "as_of": as_of}
            log(f"  ✓ {key:14s} {value:>10.4f}  ({source}, {as_of})")
        else:
            log(f"  ✗ {key} 值 {value} 超出合理范围，丢弃 ({source})")

    # ── FRED ──
    log("FRED …")
    oas_series = []
    try:
        oas_series = [(d, v * 100) for d, v in fred_series("BAMLH0A0HYM2", 400)]  # % → bps
        put("credit_spread", oas_series[-1][1], "FRED BAMLH0A0HYM2", oas_series[-1][0])
    except Exception as e:
        log(f"  FRED OAS 失败: {e}")
    fred_backup = {}
    for key, sid in [("vix", "VIXCLS"), ("us_10y", "DGS10"), ("brent", "DCOILBRENTEU")]:
        try:
            rows = fred_series(sid, 5)
            fred_backup[key] = (rows[-1][0], rows[-1][1], f"FRED {sid}")
        except Exception as e:
            log(f"  FRED {sid} 失败: {e}")

    # ── Yahoo ──
    log("Yahoo Finance …")
    ymap = {
        "vix": "^VIX", "us_10y": "^TNX", "gbp_cny": "GBPCNY=X", "brent": "BZ=F",
        "gold": "GC=F", "dxy": "DX-Y.NYB", "nasdaq": "^IXIC", "hyg": "HYG", "iei": "IEI",
    }
    yseries = {}
    for key, tk in ymap.items():
        s = yahoo_history(tk)
        if s is not None and len(s):
            yseries[key] = s
            put(key, float(s.iloc[-1]), f"Yahoo {tk}", s.index[-1])

    # Yahoo 缺失时用 FRED 备份
    for key, (d, v, src) in fred_backup.items():
        if key not in fields:
            put(key, v, src, d)

    # ── Bank of England ──
    log("Bank of England …")
    try:
        d, v = boe_uk_10y()
        put("uk_10y", v, "BoE IUDMNPY", d)
    except Exception as e:
        log(f"  BoE 失败: {e}")
        try:
            rows = fred_series("IRLTLT01GBM156N", 3)   # 月度，仅作兜底
            put("uk_10y", rows[-1][1], "FRED IRLTLT01GBM156N (monthly)", rows[-1][0])
        except Exception as e2:
            log(f"  FRED 英国10Y 兜底失败: {e2}")

    # ── Claude 兜底 ──
    required = ["credit_spread", "vix", "us_10y", "uk_10y", "brent", "gbp_cny", "gold", "dxy", "nasdaq"]
    missing = [k for k in required if k not in fields]
    if missing:
        log(f"缺失字段 {missing}，尝试 Claude 兜底 …")
        for k, rec in claude_fallback(missing).items():
            fields[k] = rec
            log(f"  ✓ {k} = {rec['value']} (claude)")

    derived = compute_derived(fields, oas_series, yseries.get("hyg"), yseries.get("iei"), yseries.get("nasdaq"))
    return fields, derived, oas_series


def sample_data():
    """--dry-run 用：不联网，验证流程和文件结构。"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    fields = {k: {"value": v, "source": "sample", "as_of": today} for k, v in {
        "credit_spread": 269, "vix": 14.5, "us_10y": 4.73, "uk_10y": 5.07, "brent": 68,
        "gbp_cny": 9.6, "gold": 3400, "dxy": 98, "nasdaq": 21000, "hyg": 80, "iei": 118,
    }.items()}
    oas = [(f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", 260 + (i % 7)) for i in range(60)]
    derived = {"credit_spread_20d_change": 3.0, "credit_spread_20d_min": 260, "hy_proxy_20d_pct": 0.1,
               "hy_proxy_ratio": 0.678, "nasdaq_drawdown_pct": -2.1, "nasdaq_20d_pct": 1.4, "nasdaq_52w_high": 21450}
    return fields, derived, oas


def main():
    dry = "--dry-run" in sys.argv
    fields, derived, oas_series = sample_data() if dry else fetch_all()

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    flat = {k: v["value"] for k, v in fields.items()}

    meta = {}
    for k, v in fields.items():
        bd = business_days_between(v["as_of"], today)
        meta[k] = {"source": v["source"], "as_of": v["as_of"], "stale_bdays": bd,
                   "stale": bd is not None and bd > MAX_STALE_BDAYS}
    core = ["credit_spread", "vix", "us_10y", "uk_10y", "brent", "gbp_cny", "gold", "dxy"]
    stale_list = [k for k in core if k in meta and meta[k]["stale"]]
    worst = max((k for k in core if k in meta), key=lambda k: meta[k]["stale_bdays"] or 0, default=None)
    freshness = {
        "max_stale_bdays_allowed": MAX_STALE_BDAYS,
        "excluded_from_score": stale_list,
        "oldest_key": worst,
        "oldest_bdays": meta[worst]["stale_bdays"] if worst else None,
        "oldest_as_of": meta[worst]["as_of"] if worst else None,
    }
    for k in stale_list:
        log(f"  ⚠ {k} 数据日期 {meta[k]['as_of']}，已 {meta[k]['stale_bdays']} 个交易日未更新，剔除出评分")

    latest = {
        "fetched_at": now.isoformat(),
        "date": today,
        "values": flat,
        "meta": meta,
        "derived": derived,
        "freshness": freshness,
    }
    (OUT_DIR / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2))

    # history：同一天覆盖，最多 500 条
    hist_path = OUT_DIR / "history.json"
    try:
        history = json.loads(hist_path.read_text()) if hist_path.exists() else []
    except Exception:
        history = []
    history = [h for h in history if h.get("date") != today]
    history.append({"date": today, **flat, **derived})
    history = history[-500:]
    hist_path.write_text(json.dumps(history, ensure_ascii=False, indent=1))

    # series：OAS 近 250 个交易日
    if oas_series:
        (OUT_DIR / "series.json").write_text(json.dumps(
            {"credit_spread": [{"d": d, "v": round(v, 1)} for d, v in oas_series[-250:]]},
            ensure_ascii=False))

    missing = [k for k in ["credit_spread", "vix", "us_10y", "uk_10y", "brent", "gbp_cny", "gold", "dxy", "nasdaq"]
               if k not in flat]
    log(f"完成。写入 {OUT_DIR}。缺失字段: {missing or '无'}")
    # 核心信号缺失时以非零退出，让 GitHub Actions 标红提醒
    if "credit_spread" in missing:
        sys.exit(2)


if __name__ == "__main__":
    main()
