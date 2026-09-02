# 全球金融危机监测仪表盘 v2.1

每日自动抓取 9 项宏观指标，以高收益信用利差（HY OAS）为核心信号计算风险评分，给出纳斯达克操作建议。

v2 的变化：
- 数据不再靠 AI 搜索猜数字，改为直接从 FRED、Yahoo Finance、英格兰银行抓取，每个数值带来源和日期
- 新增 HY OAS 20 日变化（速度信号）和 HYG/IEI 实时代理
- 综合评分加入核心信号地板，利差进入高风险区时总分不会再被其他平静指标稀释
- 估值层改用纳斯达克 52 周回撤量化，三层叠加场景可以真正触发
- 浏览器里不再放任何 API Key，前端只读静态 JSON
- 数据新鲜度硬规则：任何指标超过 3 个交易日未更新即剔除评分并变灰，页面顶部显示最旧一项是哪个

先看 `CODEX_TASKS.md`。

## 目录结构

```
scripts/fetch_daily.py       抓取脚本（Python，无需任何 API Key）
public/data/latest.json      今日数据（脚本生成）
public/data/history.json     每日一条，最多 500 天
public/data/series.json      HY OAS 近 250 个交易日
.github/workflows/daily.yml  GitHub Actions 定时任务
src/App.jsx                  前端
```

## 方案 A：GitHub Actions 全自动（推荐，零服务器，免费）

交给 Codex 执行的步骤：

1. 在 GitHub 新建一个仓库（可以是私有仓库），把本项目推上去，默认分支为 `main`。
2. 仓库 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
3. 仓库 Settings → Actions → General → Workflow permissions 选 **Read and write permissions**。
4. （可选）Settings → Secrets and variables → Actions → New repository secret，名称 `ANTHROPIC_API_KEY`。不填也能跑，只是抓取失败的字段不会用 Claude 补齐。
5. Actions 页面 → `daily-update` → **Run workflow** 手动跑一次，确认绿色通过。
6. 之后每个工作日 UTC 12:30 自动执行。访问地址在 Actions 日志的 deploy 步骤里，或 Settings → Pages 顶部。

注意：GitHub 的定时任务在仓库 60 天无 commit 时会自动暂停，但本任务每天自己 commit 数据，所以不会触发这个规则。

## 方案 B：本地运行

```bash
pip install -r requirements.txt
npm install
npm run update      # 抓取一次数据
npm run dev         # 打开 http://localhost:3000
```

想在自己电脑上每日自动跑，macOS/Linux 用 cron：

```
30 13 * * 1-6 cd /path/to/crisis-monitor && /usr/bin/python3 scripts/fetch_daily.py >> fetch.log 2>&1
```

Windows 用「任务计划程序」调用同一条命令。

## 验证脚本是否正常

```bash
python3 scripts/fetch_daily.py --dry-run   # 不联网，检查流程
python3 scripts/fetch_daily.py             # 真实抓取，看每行 ✓/✗
```

正常输出应该每个字段都是 ✓，并显示来源如 `FRED BAMLH0A0HYM2`、`Yahoo ^VIX`、`BoE IUDMNPY`。如果某个源失败，脚本会自动尝试备用源；只有核心信号 HY OAS 完全拿不到时才会以非零状态退出，让 Actions 标红。

Codex 需要重点验证的三处（本地 sandbox 无法访问外网，未实测）：
- `^TNX` 在 Yahoo 上返回的是百分比形式（如 4.28）还是 ×10（如 42.8）。若是后者，在 `fetch_all()` 里对 `us_10y` 除以 10。
- 英格兰银行 CSV 端点的日期格式，脚本按 `29 Aug 2026` 解析，若格式不同会走 FRED 月度兜底。
- `DX-Y.NYB` 偶尔在 yfinance 里返回空，若持续为空可改用 `DXY=F` 或 `UUP` 作为代理。

## 监测指标与阈值

| 指标 | 权重 | 低风险 | 中等 | 高风险 | 极高 | 来源 |
|------|------|--------|------|--------|------|------|
| HY OAS 水平 | ×3.0 | <350 | 350-500 | 500-700 | >700 bps | FRED |
| HY OAS 20日变化 | （同上，取高者） | <+100 | +100-200 | +200-350 | >+350 bps | FRED |
| VIX | ×2.0 | <20 | 20-30 | 30-40 | >40 | Yahoo |
| 美国10Y | ×1.5 | <4.5% | 4.5-5.0 | 5.0-5.5 | >5.5% | Yahoo/FRED |
| 英国10Y | ×1.5 | <4.5% | 4.5-5.0 | 5.0-5.5 | >5.5% | BoE |
| 布伦特 | ×1.5 | <$85 | 85-105 | 105-130 | >$130 | Yahoo/FRED |
| 英镑/人民币 | ×1.0 | >9.0 | 8.5-9.0 | 8.0-8.5 | <8.0 | Yahoo |
| 黄金 | ×0.8 | <2800 | 2800-3500 | 3500-4200 | >$4200 | Yahoo |
| DXY | ×0.8 | <101 | 101-106 | 106-112 | >112 | Yahoo |

综合评分 = max(加权均值, 信用利差单项分 × 0.85)。数据日期超过 3 个交易日的指标不参与加权（`latest.meta[key].stale`）。

## 注意事项

- 仅供宏观风险参考，不构成投资建议
- FRED 的 OAS 有一个交易日延迟，HYG/IEI 代理可提前一天看到方向
- 数据源可能改版，脚本每行都打印来源，出问题时看日志即可定位
