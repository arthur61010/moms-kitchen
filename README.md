# 家庭煮婦 (Mom's Kitchen) — 原型

iPhone 優先的 PWA：上傳 Uber Eats 訂單截圖或拍冰箱 → AI 辨識食材（可編輯）→ 產生 3 道台灣家常菜食譜。日系繪本風 UI。

## 執行
```bash
cd /workspace/moms-kitchen
OPENAI_API_KEY=sk-...  node server.js     # 或 GEMINI_API_KEY=...；都沒設 = 示範模式（假資料）
# 選用：APP_PASSCODE=xxxx（公開網址時建議）、OPENAI_MODEL、GEMINI_MODEL、PORT（預設 8787）
```
零相依套件（只需 Node 18+）。預覽食譜畫面：`http://localhost:8787/#demo`

## 檔案
- server.js — 後端（靜態檔 + /api/status、/api/ingredients、/api/recipes），金鑰只從環境變數讀
- public/index.html — 前端（照片在手機端縮到 1280px 再上傳，省流量省錢）
- public/manifest.webmanifest、sw.js、apple-touch-icon.png、icon-192/512.png — 加到主畫面
- public/huninn.woff2 — jf open 粉圓字型（SIL OFL，見 huninn-LICENSE.txt）

## 部署到 Render（免費方案）
1. 把這個資料夾推到 GitHub（公開或私人皆可）。
2. Render Dashboard → New → Blueprint，選這個 repo（會讀 `render.yaml`）；或用
   `https://render.com/deploy?repo=<你的 repo 網址>`。
3. 依提示填入 `GEMINI_API_KEY` 和 `APP_PASSCODE`，按 Deploy。
4. 網址為 `https://moms-kitchen-xxxx.onrender.com`。免費方案閒置 15 分鐘會休眠，下次打開約需 1 分鐘喚醒。

測試照片 `test/Open_refrigerator_with_food_at_night.jpg`（W.carter, CC BY-SA 4.0, Wikimedia Commons）不納入 git。

## 花費上限（每月 NT$50）
- 每次呼叫 Gemini 後，依回傳的 `usageMetadata` 實際 token 數 × 官方價目（https://ai.google.dev/gemini-api/docs/pricing ，思考 token 算在輸出）累計花費；未列價的模型一律用較高的 $1.50/$7.50 每百萬 token 估算。
- `MONTHLY_BUDGET_TWD`（預設 50）、`USD_TWD`（預設 33，略高於實際匯率）。每次呼叫前預留 US$0.02，額度不夠就婉拒並顯示「這個月的 AI 額度用完囉，下個月再來唷 🌙」。台北時間每月 1 號歸零。
- `DAILY_LIMIT_PER_USER`（預設 10 次／裝置或 IP／天），超過顯示「今天已經用了 10 次囉，明天再來找我吧 ☀️」。
- 失敗或逾時的呼叫也計入次數；額度檢查出錯時一律拒絕（fail closed）。
- 剩餘額度只在 `/api/status` 的 `budget` 欄位顯示，不出現在主畫面。
- ⚠️ Render 免費方案的磁碟在休眠／重新部署時會清空，`data/usage.json` 會跟著歸零，所以這只是「軟上限」。真正的硬上限請在 Google 端設定（AI Studio → Spend → Monthly spend cap，或使用預付且關閉自動加值）。
