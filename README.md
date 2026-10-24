# 媽媽的廚房 (Mom's Kitchen) — 原型

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
