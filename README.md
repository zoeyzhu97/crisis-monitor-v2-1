# 全球金融危机监测仪表盘 v2.1

每日自动抓取 9 项宏观指标，以高收益信用利差（HY OAS）为核心信号计算风险评分，给出纳斯达克操作建议。

v2 的变化：
- 数据不再靠 AI 搜索猜数字，改为从 FRED、FRED 数据镜像、Yahoo Finance和英格兰银行抓取，每个数值带来源和日期
- 新增 HY OAS 20 日变化（速度信号）和 HYG/IEI 实时代理
- 综合评分加入核心信号地板，利差进入高风险区时总分不会再被其他平静指标稀释
- 估值层改用纳斯达克 52 周回撤量化，三层叠加场景可以真正触发
- 浏览器里不再放任何 API Key，前端只读静态 JSON
- 更新延迟与风险评分分开：最近有效值持续参与评分，延迟显示真实日期，不删除指标或改变权重。

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
4. 无需 AI API 密钥；仅使用数据源实际公布的值。
5. Actions 页面 → `daily-update` → **Run workflow** 手动跑一次，确认绿色通过。
6. 之后每小时第 17 分钟（UTC） 自动执行。访问地址在 Actions 日志的 deploy 步骤里，或 Settings → Pages 顶部。

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

正常输出应该每个字段都是 ✓，并显示来源如 `FRED BAMLH0A0HYM2`、`Autario mirror / FRED BAMLH0A0HYM2`、`Yahoo ^VIX`、`BoE IUDMNPY`。GitHub 托管运行器无法连通 St. Louis Fed 时，会自动读取同一 FRED 序列的 Autario 公开镜像，并保留真实数据日期。只有所有在线来源和本地缓存都拿不到 HY OAS 时才会以非零状态退出。

Codex 需要重点验证的三处（本地 sandbox 无法访问外网，未实测）：
- `^TNX` 在 Yahoo 上返回的是百分比形式（如 4.28）还是 ×10（如 42.8）。若是后者，在 `fetch_all()` 里对 `us_10y` 除以 10。
- 英格兰银行 CSV 端点的日期格式，脚本按 `29 Aug 2026` 解析，若格式不同会走 FRED 月度兜底。
- `DX-Y.NYB` 偶尔在 yfinance 里返回空，若持续为空可改用 `DXY=F` 或 `UUP` 作为代理。

## 监测指标与阈值

| 指标 | 权重 | 低风险 | 中等 | 高风险 | 极高 | 来源 |
|------|------|--------|------|--------|------|------|
| HY OAS 水平 | ×3.0 | <350 | 350-500 | 500-700 | >700 bps | FRED / FRED 数据镜像 |
| HY OAS 20日变化 | （同上，取高者） | <+100 | +100-200 | +200-350 | >+350 bps | FRED / FRED 数据镜像 |
| VIX | ×2.0 | <20 | 20-30 | 30-40 | >40 | Yahoo |
| 美国10Y | ×1.5 | <4.5% | 4.5-5.0 | 5.0-5.5 | >5.5% | Yahoo/FRED |
| 英国10Y | ×1.5 | <4.5% | 4.5-5.0 | 5.0-5.5 | >5.5% | BoE |
| 布伦特 | ×1.5 | <$85 | 85-105 | 105-130 | >$130 | Yahoo/FRED |
| 英镑/人民币 | ×1.0 | >9.0 | 8.5-9.0 | 8.0-8.5 | <8.0 | Yahoo |
| 黄金 | ×0.8 | <2800 | 2800-3500 | 3500-4200 | >$4200 | Yahoo |
| DXY | ×0.8 | <101 | 101-106 | 106-112 | >112 | Yahoo |

综合评分 = max(加权均值, 信用利差单项分 × 0.85)。`latest.meta[key].stale` 只标记更新延迟，不再剔除有效值或改变权重；含延迟数据时页面明确提示。

## 注意事项

- 仅供宏观风险参考，不构成投资建议
- FRED 的 OAS 通常有一个交易日延迟，HYG/IEI 代理可提前一天看到方向
- 新鲜度按对应市场的交易日计算，不把美国休市日（如 Labor Day）误计为过期天数
- 数据源可能改版，脚本每行都打印来源，出问题时看日志即可定位


### 2026-10-28 数据更新修复（取代此前的过期剔除规则）

- GitHub Actions 每小时第 17 分钟（UTC） 抓取并发布（含周末，实际启动可能受队列延迟影响）。
- HY OAS 同时检查官方 CSV、官方 dashboard 和同序列镜像，采用最新有效日期；保留历史并避免缓存日期倒退。
- 英国 10Y 使用 BoE IUDMNPY 日度序列，按日期选择最新有效记录；失败保留原日期缓存，不用月度值或 AI 估值替代。
- HY OAS / 英国 10Y 超过 2 个交易日标记延迟，其他指标超过 3 个交易日标记延迟；均保留最近有效值参与评分。BoE 官方说明日度序列通常延迟 1–2 个工作日发布：https://www.bankofengland.co.uk/boeapps/database/help.asp
- 网络请求对瞬时错误重试两次；所有指标均保留有效缓存并禁止观察日期倒退。记录每轮 checked_at 和 fetch_status，区分核验成功与连接失败。
- 云端 Ubuntu 与 macOS 均实测存在 FRED 超时，因此云端继续使用 Ubuntu + 同序列镜像；本机 Codex 每小时运行 `scripts/recover_official.py` 补抓官方源，只在取得更新日期或同日修订时同步并触发部署。补抓使用临时检出，不覆盖工作区；本机通道需要电脑和 Codex 运行，云端通道不依赖本机。
- 每日抓取不等于来源每日已发布；尚未公布的数据不会伪造为当天值。页面每 10 分钟同步刷新数值、历史和图表。
