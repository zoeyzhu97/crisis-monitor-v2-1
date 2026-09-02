# 给 Codex 的任务清单

本压缩包（v2.1）已经把数据层和评分规则全部改好并通过构建。Codex 只需要做两件事。

## 任务 1：用本项目替换现有仪表盘的数据层与评分逻辑

现有版本存在三个问题，本项目已修复：

| 问题 | 现有版本 | 本项目 |
|------|----------|--------|
| 英国 10Y 用了月度序列，数据停在 7/31 | BoE 月末/月均序列 | BoE 日度序列 IUDMNPY，兜底 FRED |
| 布伦特用 EIA 周度现货，滞后一周 | U.S. EIA | Yahoo BZ=F 日度，兜底 FRED DCOILBRENTEU |
| 核心信号只有 HYG/IEI 20 日变化，没有 OAS 水平 | 缺 350/500/700 阈值的输入 | FRED BAMLH0A0HYM2 提供水平 + HYG/IEI 提供速度，取高者计分 |
| 过期数据仍以原权重参与评分 | 32 天前的英国国债仍算"高风险" | 超过 3 个交易日未更新即剔除并变灰，页面顶部显示最旧一项 |

两种做法任选：
- **A（推荐）**：直接使用本项目，若想保留现有版本的视觉样式（编号卡片、衬线数字、"查看说明 +"），把现有 UI 移植到本项目的 `src/App.jsx` 上，数据读取和 `computeAll` 逻辑不要改。
- **B**：保留现有项目，把本项目的 `scripts/fetch_daily.py`、`.github/workflows/daily.yml`、`requirements.txt` 拷过去，前端改为读取 `public/data/latest.json`，并按 `latest.meta[key].stale === true` 剔除该项评分。评分规则见 README「监测指标与阈值」。

## 任务 2：真实联网验证抓取脚本（沙盒无法联网，以下三处未实测）

```bash
pip install -r requirements.txt
python3 scripts/fetch_daily.py
```

逐行看输出，每个字段应为 ✓ 并显示来源和数据日期。需要确认：

1. `^TNX` 在 yfinance 返回的是 4.79 这种百分比形式还是 47.9。若是后者，在 `fetch_all()` 里对 `us_10y` 除以 10。
2. 英格兰银行 CSV 的日期格式。脚本按 `29 Aug 2026` 解析；若失败会走 FRED 月度兜底并在日志里打印 `BoE 失败`，此时请把实际返回的前几行贴出来改 `boe_uk_10y()` 的解析。
3. `DX-Y.NYB` 若返回空，改用 `DXY=F` 或 `UUP`（后者是 ETF 价格，需换算，不推荐）。若现有版本用 ECB 汇率自行合成 DXY，权重必须是 EUR 57.6% / JPY 13.6% / GBP 11.9% / CAD 9.1% / SEK 4.2% / CHF 3.6%。

验证标准：`public/data/latest.json` 里 `freshness.excluded_from_score` 为空数组，`uk_10y` 和 `brent` 的 `as_of` 为最近一个交易日。

## 部署

按 README「方案 A」六步设置 GitHub Actions + Pages，之后每个工作日 UTC 12:30 自动更新，无需人工干预。
