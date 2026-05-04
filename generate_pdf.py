from fpdf import FPDF
import os
from datetime import date

FONT_PATH = "/System/Library/Fonts/PingFang.ttc"
OUTPUT = os.path.expanduser("~/Desktop/StockApp架構說明.pdf")

class PDF(FPDF):
    def header(self):
        self.set_font("PF", size=9)
        self.set_text_color(150, 150, 150)
        self.cell(0, 8, "StockApp 專案完整架構說明", align="R")
        self.ln(4)
        self.set_draw_color(220, 220, 220)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("PF", size=8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"第 {self.page_no()} 頁", align="C")

pdf = PDF()
pdf.add_font("PF", style="", fname=FONT_PATH)
pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_page()
pdf.set_margins(20, 20, 20)

def title(text, size=20, color=(30, 30, 30)):
    pdf.set_font("PF", size=size)
    pdf.set_text_color(*color)
    pdf.multi_cell(0, size * 0.6, text)
    pdf.ln(2)

def h1(text):
    pdf.ln(4)
    pdf.set_font("PF", size=14)
    pdf.set_text_color(0, 80, 180)
    pdf.set_fill_color(235, 244, 255)
    pdf.cell(0, 10, f"  {text}", fill=True, ln=True)
    pdf.ln(2)

def h2(text):
    pdf.ln(2)
    pdf.set_font("PF", size=11)
    pdf.set_text_color(40, 40, 40)
    pdf.set_fill_color(245, 245, 245)
    pdf.cell(0, 8, f"  {text}", fill=True, ln=True)
    pdf.ln(1)

def body(text, size=9.5, indent=0):
    pdf.set_font("PF", size=size)
    pdf.set_text_color(50, 50, 50)
    pdf.set_x(pdf.l_margin + indent)
    pdf.multi_cell(0, 6, text)

def bullet(text, indent=6):
    pdf.set_font("PF", size=9.5)
    pdf.set_text_color(50, 50, 50)
    pdf.set_x(pdf.l_margin + indent)
    pdf.multi_cell(0, 6, f"• {text}")

def code(text):
    pdf.set_font("PF", size=8.5)
    pdf.set_text_color(30, 60, 30)
    pdf.set_fill_color(245, 250, 245)
    pdf.set_x(pdf.l_margin + 4)
    pdf.multi_cell(0, 5.5, text, fill=True)

def table_row(cols, widths, is_header=False):
    if is_header:
        pdf.set_fill_color(50, 100, 200)
        pdf.set_text_color(255, 255, 255)
    else:
        pdf.set_fill_color(250, 250, 250)
        pdf.set_text_color(40, 40, 40)
    pdf.set_font("PF", size=9)
    for col, w in zip(cols, widths):
        pdf.cell(w, 7, col, border=1, fill=True)
    pdf.ln()

def divider():
    pdf.set_draw_color(200, 200, 200)
    pdf.line(pdf.l_margin, pdf.get_y() + 2, pdf.w - pdf.r_margin, pdf.get_y() + 2)
    pdf.ln(4)


# ── 封面 ──────────────────────────────────────────────
pdf.ln(8)
title("StockApp", size=28, color=(0, 70, 160))
title("專案完整架構說明", size=18, color=(60, 60, 60))
pdf.ln(2)
pdf.set_font("PF", size=9)
pdf.set_text_color(120, 120, 120)
pdf.cell(0, 6, f"版本日期：{date.today().strftime('%Y-%m-%d')}　　部署網址：https://twwone.vercel.app", ln=True)
pdf.cell(0, 6, "全棧台美股技術分析工具 | Expo Router + Vercel Serverless + Redis + Telegram", ln=True)
pdf.ln(6)
divider()

# ── 1. 專案概述 ──────────────────────────────────────
h1("1. 專案概述")
body(
    "StockApp 是一個個人台美股技術分析工具，前端使用 Expo Router（React Native）建構，"
    "可同時運行於 Web 瀏覽器與手機 App。後端使用 Vercel Serverless Functions，"
    "資料庫使用 Redis（ioredis），整合 Telegram Bot 即時推播訊號通知。"
    "部署於 Vercel，Production 網址為 twwone.vercel.app。"
)
pdf.ln(2)
body("核心功能：")
bullet("股票分析頁：台股大盤即時行情、自選股報價、技術訊號分析")
bullet("我的庫存：持股損益追蹤，跨裝置同步")
bullet("強勢雷達：全市場自動掃描，台股前 100 + 美股 50 大，每 30 分鐘更新")
bullet("訊號設定：自訂進場/離場條件，Telegram 即時推播")
pdf.ln(2)

# ── 2. 技術堆疊 ──────────────────────────────────────
h1("2. 技術堆疊")
w = [45, 95, 30]
table_row(["層級", "技術", "版本"], w, is_header=True)
for r in [
    ("前端框架", "Expo Router（React Native）", "~6.0.23"),
    ("Web 支援", "react-native-web", "0.21.0"),
    ("語言", "TypeScript（strict mode）", "~5.9.2"),
    ("後端", "Vercel Serverless Functions（maxDuration 90s）", "-"),
    ("資料庫", "Redis via ioredis", "-"),
    ("本地儲存", "AsyncStorage", "2.2.0"),
    ("推播", "Telegram Bot API", "-"),
    ("股價資料", "Yahoo Finance（台股）、富果 Fugle API（即時報價）", "-"),
    ("大盤資料", "TWSE OpenAPI（台交所）", "-"),
    ("排程", "cron-job.org（外部 Cron 服務）", "-"),
    ("部署", "Vercel（Hobby Plan）", "-"),
]:
    table_row(r, w)
pdf.ln(3)

# ── 3. 目錄結構 ──────────────────────────────────────
h1("3. 目錄結構")
code("""StockApp/
├── app/
│   ├── _layout.tsx              根佈局、深色/淺色主題
│   └── (tabs)/
│       ├── _layout.tsx          4 個 Tab 導航配置
│       ├── index.tsx            股票分析頁
│       ├── portfolio.tsx        我的庫存頁
│       ├── explore.tsx          強勢雷達頁（台股/美股切換）
│       └── alerts.tsx           通知設定頁
├── api/
│   ├── stock.ts                 個股報價（富果即時 + Yahoo 歷史）
│   ├── twse.ts                  台交所大盤數據
│   ├── market-top.ts            讀取雷達掃描結果（支援 ?market=tw/us）
│   ├── market-bell.ts           開收盤 Telegram 通知
│   ├── settings.ts              使用者設定讀寫（Redis）
│   ├── portfolio.ts             持股記錄（Redis）
│   ├── stock-names.ts           台股公司名稱表（Redis 快取 6h）
│   ├── scan.ts                  全市場掃描 + 訊號推播 Cron 主程式
│   └── register.ts              批量同步設定到後台
├── lib/
│   ├── signals.ts               技術指標計算 & 訊號偵測引擎
│   └── stockNames.ts            股票代號 → 中文名稱映射
├── constants/theme.ts           主題配色
├── hooks/                       useColorScheme 等
├── generate_pdf.py              本文件產生腳本
├── app.json                     Expo 配置
└── vercel.json                  buildCommand: expo export -p web""")
pdf.ln(3)

# ── 4. 主要頁面 ──────────────────────────────────────
h1("4. 四個主要頁面")

h2("4-1  股票分析頁（index.tsx）")
body("分三個子 Tab：")
bullet("市場 Tab：台股加權指數即時行情、漲跌家數、成交金額、8 檔重點個股")
bullet("自選股 Tab：使用者自訂清單，AsyncStorage 本地 + Redis 雲端雙層同步")
bullet("搜尋/訊號 Tab：輸入代號或中文名，自動計算技術指標輸出綜合訊號")
bullet("指標：MA5/MA20、RSI(14)、成交量 vs VMA5", indent=12)
bullet("訊號：[綠] 強烈買進 / [黃] 中立觀望 / [紅] 趨勢向下", indent=12)

h2("4-2  我的庫存頁（portfolio.tsx）")
bullet("記錄買入/賣出交易（支援多筆、張/股單位）")
bullet("計算加權平均成本、未實現損益、已實現損益")
bullet("跨裝置同步：AsyncStorage @portfolio_v1 + /api/portfolio Redis")

h2("4-3  強勢雷達頁（explore.tsx）")
bullet("台股/美股市場切換（台股 / 美股 按鈕切換）")
bullet("台股：TWSE 當日成交量前 100 名標的池，MA20 以上濾網，6 大進場訊號評分")
bullet("美股：固定 50 大高流動性標的池（NVDA、AAPL、TSLA 等），同樣評分邏輯")
bullet("評分：每個進場訊號 +30 分，多頭排列（price > MA5 > MA20）+15 分")
bullet("結果依分數降冪，取前 20 名，每 30 分鐘更新，結果存 Redis 最多 26 小時")
bullet("一鍵「加入自選股」，同步 AsyncStorage + Redis，系統即刻開始追蹤")

h2("4-4  通知設定頁（alerts.tsx）")
bullet("支援多組訊號設定檔（profile）")
bullet("進場訊號（6 種）：KD 黃金交叉、RSI 超賣反彈、MA 黃金交叉、布林下軌反彈、帶量突破、MACD 零軸上穿")
bullet("離場訊號（5 種）：KD 死亡交叉、RSI 超買回落、MA 死亡交叉、布林上軌反壓、MACD 零軸下穿")
bullet("每個訊號可自訂參數，設定後同步後台，Cron 觸發時推播 Telegram")

# ── 5. API 路由 ──────────────────────────────────────
h1("5. API 路由")
w2 = [50, 20, 100]
table_row(["路由", "方法", "功能"], w2, is_header=True)
for r in [
    ("/api/stock", "GET", "個股報價代理：台股走富果即時報價，美股/歷史走 Yahoo Finance"),
    ("/api/twse", "GET", "台交所大盤數據（漲跌家數、成交金額）"),
    ("/api/market-top", "GET", "讀取雷達結果，?market=tw 或 us，從 Redis 取快取"),
    ("/api/market-bell", "GET", "Telegram 開收盤通知，?type=tw-open/tw-close 等"),
    ("/api/settings", "GET/PATCH", "Redis 讀寫（watchlist、訊號設定、updatedAt）"),
    ("/api/portfolio", "GET/POST", "Redis 持股記錄讀寫"),
    ("/api/stock-names", "GET", "台股完整名稱表（TWSE OpenAPI，Redis 快取 6h）"),
    ("/api/scan", "GET", "Cron 主程式：?mode=fast/full，?market=tw/us"),
    ("/api/register", "POST", "批量同步所有設定到後台"),
]:
    table_row(r, w2)
pdf.ln(3)

# ── 6. 強勢雷達掃描邏輯 ──────────────────────────────
h1("6. 強勢雷達掃描邏輯（api/scan.ts）")

h2("6-1  Full Scan — 全市場海選")
body("有兩個市場版本，邏輯相同：")
bullet("台股（?market=tw）：從 TWSE OpenAPI 拉取當日成交量，取前 100 名，快取 30 分鐘")
bullet("美股（?market=us）：固定池 50 檔（NVDA、AAPL、TSLA、AMD、META、MSFT、GOOGL、PLTR 等）")
pdf.ln(1)
body("海選使用 FULL_CONFIG（所有進場訊號全開，離場訊號全關）：")
w3 = [55, 30, 85]
table_row(["訊號", "參數", "觸發條件"], w3, is_header=True)
for r in [
    ("KD 低檔黃金交叉", "oversold=20", "K 上穿 D，且 K < 50（低檔區）"),
    ("RSI 超賣反彈", "threshold=30", "RSI 從 < 30 站回 ≥ 30"),
    ("MA 黃金交叉", "5/20", "MA5 上穿 MA20"),
    ("布林下軌反彈", "stdDev=2", "前日收在下軌以下，今日收回通道"),
    ("帶量突破", "1.5x / 5日", "今日量 > 5日均量 × 1.5，且收盤突破近 5 日高"),
    ("MACD 零軸上交叉", "-", "histogram 由負翻正，且 MACD 值 > 0"),
]:
    table_row(r, w3)
pdf.ln(2)
body("硬性門檻（兩道）：")
bullet("price > MA20（股價須在 20 日均線以上，確保趨勢向上）")
bullet("至少 1 個進場訊號觸發（score = 0 直接剔除）")
pdf.ln(1)
body("評分公式：分數 = 進場訊號數 × 30 + (多頭排列加分 15)")
body("多頭排列條件：price > MA5 且 MA5 > MA20")
pdf.ln(1)
body("結果取分數前 20 名，存入 Redis，TTL 26 小時。台股同時存 radar_picks 供追蹤用。")
pdf.ln(1)
body("介面分數等級：")
bullet("分數 ≥ 90：極強訊號（紅色）")
bullet("分數 ≥ 60：強勢訊號（橘色）")
bullet("分數 < 60：入場訊號（藍綠色）")

h2("6-2  Fast Scan — 自選股定時掃描")
body("掃描範圍：使用者自選股 + 持股庫存 + 上次雷達推薦標的（radar_picks）")
pdf.ln(1)
body("自選股/持股 掃描邏輯：")
bullet("買進訊號：KD 低檔黃金交叉 + (帶量突破 或 RSI 超賣) + price > MA20 → 推播「多頭進場指令」")
bullet("賣出訊號：KD 死亡交叉 + (RSI 超買 或 布林上軌) 或 跌破 MA20 → 推播「空頭離場指令」")
bullet("停損提醒：持有中，price < 成本 × 0.95（-5%）→ 推播「停損提醒」")
bullet("止盈提醒：持有中，price ≥ 成本 × 1.10（+10%）→ 推播「止盈提醒」")
pdf.ln(1)
body("雷達追蹤邏輯（radar_picks 不在自選股內的標的）：")
bullet("若出現離場訊號 或 price < MA20 → 推播「雷達追蹤警示」")
bullet("冷卻時間 8 小時（避免重複推播）")

h2("6-3  Redis 快取鍵一覽")
code("""market:top_signals        台股雷達結果（TTL 26h）
market:top_signals:us     美股雷達結果（TTL 26h）
market:radar_picks        台股雷達推薦標的清單（TTL 26h）
market:pool:v1            台股候選池快取（TTL 30min）
settings                  使用者所有設定
direct:buy:{symbol}       買進訊號冷卻（TTL 8h）
direct:sell:{symbol}      賣出訊號冷卻（TTL 8h）
stoploss:{symbol}         停損冷卻（TTL 4h）
takeprofit:{symbol}       止盈冷卻（TTL 4h）
radar:exit:{symbol}       雷達追蹤冷卻（TTL 8h）""")

# ── 7. 技術指標引擎 ──────────────────────────────────
h1("7. 技術指標引擎（lib/signals.ts）")
body("計算函式（共 5 個）：")
bullet("calcMA(closes, period) — 簡單移動平均")
bullet("calcRSI(closes, period=14) — Wilder's RSI")
bullet("calcKD(closes, highs, lows, period=9) — KD 隨機指標，%D 為 3 期 SMA")
bullet("calcMACD(closes, fast=12, slow=26, sigPeriod=9) — MACD 12/26/9")
bullet("calcBollinger(closes, period=20, stdDev=2) — 布林通道")
pdf.ln(2)
body("主函式：")
code("detectSignals(closes, volumes, highs, lows, config): TriggeredSignal[]")
body(
    "傳入最新 3 個月 K 線數據（至少 30 根）+ SignalConfig 設定，"
    "輸出所有觸發的訊號列表，每個訊號含 type、label、detail、category（entry/exit）。"
    "共 11 個訊號條件，可透過 config 個別開關與調整參數。"
)

# ── 8. Telegram 推播訊號格式 ──────────────────────────
h1("8. Telegram 推播訊號格式")
h2("多頭進場指令")
code("""[多頭] 【多頭進場指令】
-------------------------------
[目標] 標的：2330 台積電
[市價] 目前市價：980 元
[訊號] 觸發條件：KD黃金交叉 + 帶量突破
[說明] 指標細節：K 18.5 上穿 D 16.2（低檔黃金交叉）
               量 12,345張 > 均量 8,000張，突破5日高
[防守] 【系統紀律建議】
1. 執行：建議於今日收盤前以「限價單」買進。
2. 防守：硬性停損點設為 931.00 元""")
h2("止盈提醒")
code("""[止盈] 止盈提醒  ·  2330
台積電  現價 1,078
已達成本 +10%　成本 980
獲利約 980,000 元 (+10.00%)　持有 1 張
[說明] 建議考慮減碼或設移動停利保護獲利""")
h2("雷達追蹤警示")
code("""[雷達] 雷達追蹤警示  ·  1802
台玻  現價 62.3
[警示] 強勢條件出現變化：跌破 MA20 63.50
建議重新評估是否進場或繼續持有""")

# ── 9. Cron 排程 ──────────────────────────────────────
h1("9. Cron 排程（cron-job.org）")
body("時區：Asia/Taipei（台股）/ America/New_York（美股）")
pdf.ln(1)
w4 = [55, 40, 75]
table_row(["URL", "Cron 表達式", "說明"], w4, is_header=True)
for r in [
    ("/api/market-bell?type=tw-open", "0 9 * * 1-5", "台股開盤通知（Asia/Taipei）"),
    ("/api/market-bell?type=tw-close", "30 13 * * 1-5", "台股收盤通知（Asia/Taipei）"),
    ("/api/scan?mode=fast", "*/10 9-13 * * 1-5", "自選股快速掃描 每 10 分鐘（Asia/Taipei）"),
    ("/api/scan?mode=full&market=tw", "*/30 9-13 * * 1-5", "台股全市場海選 每 30 分鐘（Asia/Taipei）"),
    ("/api/scan?mode=full&market=us", "*/30 9-16 * * 1-5", "美股全市場海選 每 30 分鐘（America/New_York）"),
]:
    table_row(r, w4)
pdf.ln(3)

# ── 10. 資料來源 ──────────────────────────────────────
h1("10. 資料來源")
w5 = [60, 110]
table_row(["來源", "用途"], w5, is_header=True)
for r in [
    ("Yahoo Finance API", "台美股歷史 K 線（3 個月日線，非官方代理）"),
    ("富果 Fugle MarketData API", "台股即時現價（官方 API，穩定不被擋）"),
    ("TWSE OpenAPI", "台股當日成交量排行、上市公司中文名稱表"),
    ("TWSE 台交所官網", "大盤漲跌家數、成交金額"),
    ("Redis（ioredis）", "所有快取、設定、冷卻鍵"),
    ("Telegram Bot API", "技術訊號即時推播通知"),
]:
    table_row(r, w5)
pdf.ln(3)

# ── 11. 環境變數 ──────────────────────────────────────
h1("11. 環境變數（Vercel Environment Variables）")
code("""REDIS_URL            Redis 連線字串（ioredis）
TELEGRAM_BOT_TOKEN   Telegram Bot 推播 Token
TELEGRAM_CHAT_ID     推播目標 Chat ID
FUGLE_API_KEY        富果 MarketData API 金鑰
CRON_SECRET          /api/scan 保護密鑰（目前未設定，API 公開）""")
pdf.ln(2)
body("注意：CRON_SECRET 未設定時 API 端點對外公開，建議後續在 Vercel 補上。")

# ── 12. 資料同步機制 ──────────────────────────────────
h1("12. 資料同步機制")

h2("前後台雙向同步（四步驟標準流程）")
code("""1. 使用者在前端操作（新增自選股、更改設定等）
2. 立即寫入 AsyncStorage（本地，不等後台）
3. 背景 fetch PATCH /api/settings 同步到 Redis（不阻塞 UI）
4. 下次開啟 App 時：
   - 先讀 Redis 取得後台最新版本（帶 updatedAt 時間戳）
   - 比較與本地 updatedAt
   - 若後台較新 → 覆蓋本地 AsyncStorage
   - 若本地較新 → 維持本地（已在步驟 3 同步過）""")
pdf.ln(2)

h2("強勢雷達資料流")
code("""cron-job.org 觸發（每 30 分鐘）
  ↓  GET /api/scan?mode=full&market=tw
  TWSE OpenAPI 拉取成交量前 100
  ↓
  Yahoo Finance 抓取每檔 3 個月日線 K 線
  ↓  （分批 5 檔，批次間延遲 1 秒）
  detectSignals() 計算 6 大進場訊號
  ↓
  硬性過濾：price ≤ MA20 → 剔除
  ↓
  評分排序，取前 20 名
  ↓
  redis.set('market:top_signals', ...)  TTL 26h
  redis.set('market:radar_picks', ...)  TTL 26h
  ↓
前端 GET /api/market-top?market=tw
  ↓
顯示於強勢雷達頁""")

pdf.output(OUTPUT)
print(f"PDF 已產生：{OUTPUT}")
