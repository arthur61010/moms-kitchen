// Mom's Kitchen — zero-dependency Node server (Node 18+)
// Env: OPENAI_API_KEY (preferred) or GEMINI_API_KEY. Neither set => MOCK mode.
// Optional: OPENAI_MODEL (default gpt-4o-mini), GEMINI_MODEL (default gemini-3.5-flash), GEMINI_FALLBACK_MODEL, GEMINI_THINKING, AI_TIMEOUT_MS, PORT (default 8787),
//           APP_PASSCODE (if set, client must send it — protects your API quota on a public URL).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PASSCODE = process.env.APP_PASSCODE || '';
const PROVIDER = OPENAI_KEY ? 'openai' : GEMINI_KEY ? 'gemini' : 'mock';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_FALLBACK = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_THINKING = process.env.GEMINI_THINKING || 'low';   // low = 快；gemini-3.8-flash 實測太慢（簡單問題 28 秒以上）
const AI_TIMEOUT_MS = +process.env.AI_TIMEOUT_MS || 45000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const PROMPT_INGREDIENTS = (kind) => `你是家庭廚房助手。這張圖片是${kind === 'order' ? 'Uber Eats 等外送平台的生鮮訂單截圖' : '冰箱內部或食材的照片'}。
請辨識圖中所有可用來烹飪的食材（忽略非食品、運費、價格）。用繁體中文（台灣用語）。
只輸出 JSON：{"ingredients":[{"name":"高麗菜","amount":"1顆"}]}，amount 不確定可留空字串。`;

const PROMPT_RECIPES = (ingredients, prefs) => `你是台灣媽媽的家常菜顧問。現有食材：${ingredients.join('、')}。
${prefs ? '額外需求：' + prefs + '。' : ''}
請設計 3 道台灣家常菜（可假設家裡有基本調味料：鹽、糖、醬油、米酒、油、蒜、蔥、薑、香油、太白粉），盡量用到現有食材，步驟簡單清楚。
用繁體中文（台灣用語）。只輸出 JSON：
{"recipes":[{"name":"","time":"20 分鐘","servings":"2-3 人","ingredients":["高麗菜 半顆"],"steps":["..."],"tip":""}]}`;

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 12e6) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { fail(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString()));
    req.on('error', fail);
  });
}
function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

async function callLLM(prompt, imageDataUrl) {
  if (PROVIDER === 'openai') {
    const content = [{ type: 'text', text: prompt }];
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'auto' } });
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }] }),
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error?.message || 'OpenAI error'), { status: r.status });
    return parseJSON(j.choices[0].message.content);
  }
  if (PROVIDER === 'gemini') {
    const parts = [{ text: prompt }];
    if (imageDataUrl) {
      const [, mime, b64] = imageDataUrl.match(/^data:(.+?);base64,(.*)$/);
      parts.push({ inline_data: { mime_type: mime, data: b64 } });
    }
    const tryModel = async (model) => {
      const t0 = Date.now();
      const gen = { responseMimeType: 'application/json' };
      if (!/lite/.test(model) && GEMINI_THINKING) gen.thinkingConfig = { thinkingLevel: GEMINI_THINKING };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: gen }),
      });
      const j = await r.json();
      if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Gemini error'), { status: r.status });
      console.log(new Date().toISOString(), model, `${Date.now() - t0}ms`, JSON.stringify(j.usageMetadata || {}));
      return parseJSON(j.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join(''));
    };
    try { return await tryModel(GEMINI_MODEL); }
    catch (e) {
      // 額度/金鑰問題換模型也沒用；其他錯誤（忙碌、逾時、503）改用備援模型
      if (!GEMINI_FALLBACK || [400, 401, 402, 403].includes(e.status)) throw e;
      console.error(new Date().toISOString(), GEMINI_MODEL, 'failed, fallback:', e.status || e.name, e.message);
      return await tryModel(GEMINI_FALLBACK);
    }
  }
  throw new Error('no provider');
}

// ---- MOCK mode (no API key) ----
const MOCK_INGREDIENTS = { ingredients: [
  { name: '高麗菜', amount: '1顆' }, { name: '雞蛋', amount: '10顆' }, { name: '豬絞肉', amount: '300g' },
  { name: '番茄', amount: '3顆' }, { name: '青蔥', amount: '1把' }, { name: '板豆腐', amount: '1盒' } ] };
const MOCK_RECIPES = { recipes: [
  { name: '番茄炒蛋', time: '15 分鐘', servings: '2-3 人', ingredients: ['番茄 2顆', '雞蛋 3顆', '青蔥 1支', '糖 1小匙', '鹽 少許'],
    steps: ['番茄切塊，蔥切段，蛋打散加一點鹽。', '熱油，倒入蛋液炒到半熟先盛起。', '原鍋下番茄炒軟出汁，加糖、鹽調味。', '倒回炒蛋、加蔥段拌勻即可。'], tip: '番茄先炒出汁再放蛋，味道更濃。' },
  { name: '蒜炒高麗菜', time: '10 分鐘', servings: '2-3 人', ingredients: ['高麗菜 半顆', '蒜頭 3瓣', '鹽 少許'],
    steps: ['高麗菜用手剝成片洗淨瀝乾，蒜切片。', '熱油爆香蒜片。', '下高麗菜大火快炒，沿鍋邊淋一點水。', '炒軟後加鹽調味起鍋。'], tip: '大火快炒，菜才會脆甜。' },
  { name: '肉末燒豆腐', time: '20 分鐘', servings: '2-3 人', ingredients: ['板豆腐 1盒', '豬絞肉 150g', '醬油 2大匙', '青蔥 1支', '太白粉水 少許'],
    steps: ['豆腐切小塊，蔥切花。', '熱油炒絞肉到變色，加醬油炒香。', '加入豆腐和半碗水，小火燜 5 分鐘。', '太白粉水勾芡，撒蔥花即可。'], tip: '豆腐輕輕推，不要大力翻。' } ] };

const FAILS = new Map(); // 密碼錯誤次數（每個 IP，10 分鐘 10 次）
async function handleApi(req, res, url) {
  if (url.pathname === '/api/status') return send(res, 200, { provider: PROVIDER, mock: PROVIDER === 'mock', needPasscode: !!PASSCODE });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  let body;
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  const now = Date.now(), rec = FAILS.get(ip) || { n: 0, t: now };
  if (now - rec.t > 10 * 60e3) { rec.n = 0; rec.t = now; }
  if (PASSCODE && rec.n >= 10) return send(res, 429, { error: '試太多次了，請休息 10 分鐘再試' });
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: '圖片太大或格式錯誤' }); }
  if (PASSCODE && String(body.passcode || '') !== PASSCODE) { rec.n++; FAILS.set(ip, rec); return send(res, 401, { error: '通關密碼錯誤' }); }
  if (url.pathname === '/api/check') return send(res, 200, { ok: true });
  try {
    if (url.pathname === '/api/ingredients') {
      if (!/^data:image\//.test(body.image || '')) return send(res, 400, { error: '請提供圖片' });
      if (PROVIDER === 'mock') return send(res, 200, { ...MOCK_INGREDIENTS, mock: true });
      return send(res, 200, await callLLM(PROMPT_INGREDIENTS(body.kind), body.image));
    }
    if (url.pathname === '/api/recipes') {
      const list = (body.ingredients || []).map(String).filter(Boolean).slice(0, 60);
      if (!list.length) return send(res, 400, { error: '請至少輸入一樣食材' });
      if (PROVIDER === 'mock') return send(res, 200, { ...MOCK_RECIPES, mock: true });
      return send(res, 200, await callLLM(PROMPT_RECIPES(list, String(body.prefs || '').slice(0, 200))));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(new Date().toISOString(), e.status || '', e.message);
    const msg = e.status === 402 ? 'AI 的額度用完了，請通知 Arthur 儲值' :
                e.status === 429 ? 'AI 現在太忙了，請等一分鐘再試' :
                (e.status === 401 || e.status === 403) ? 'AI 金鑰有問題，請通知 Arthur' : 'AI 暫時無法回應，請再試一次';
    send(res, 502, { error: msg });
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(PUB, p);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Mom's Kitchen on http://localhost:${PORT}  provider=${PROVIDER}`));
