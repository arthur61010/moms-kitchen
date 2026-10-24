// 費用上限 + 每人每日次數限制（零相依）
// 價格來源：https://ai.google.dev/gemini-api/docs/pricing （2026-10-22 版，Standard Paid Tier，USD / 1M tokens）
// 輸出價格已包含 thinking tokens。不在表上的模型一律用保守高價計算。
const fs = require('fs');
const path = require('path');
const net = require('net');

const PRICES = {
  'gemini-3.5-flash-lite': () => ({ in: 0.30, out: 2.50 }),
  'gemini-3.8-flash': (d) => d < '2027-01-01' ? { in: 0.75, out: 3.75 } : { in: 1.50, out: 7.50 },
  'gemini-3.6-flash': (d) => d < '2027-01-01' ? { in: 0.75, out: 3.75 } : { in: 1.50, out: 7.50 },
};
const FALLBACK_PRICE = { in: 1.50, out: 7.50 }; // 未列價（如 gemini-3.5-flash）→ 用 Flash 最高價，寧可高估

const BUDGET_TWD = +process.env.MONTHLY_BUDGET_TWD || 50;
const USD_TWD = +process.env.USD_TWD || 33;            // 2026-10-24 約 32.6，取 33 保守
const DAILY_LIMIT = +process.env.DAILY_LIMIT_PER_USER || 10; // 一次「使用」= 看照片 + 想食譜
const CALLS_PER_USE = 2;
const RESERVE_USD = 0.02;  // 每次呼叫前先保留的最壞情況費用，避免剛好超過
const FILE = process.env.USAGE_FILE || path.join(__dirname, 'data', 'usage.json');

const tz = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d); // YYYY-MM-DD
const monthKey = () => tz().slice(0, 7);

function costUsd(model, usage = {}) {
  const p = (PRICES[model] || (() => FALLBACK_PRICE))(tz());
  const inTok = usage.promptTokenCount ?? usage.prompt_tokens ?? 0;
  const total = usage.totalTokenCount ?? usage.total_tokens;
  // 輸出 = candidates + thoughts；用 total - prompt 較保險（包含所有計費輸出）
  const outTok = total != null ? Math.max(0, total - inTok)
    : (usage.candidatesTokenCount ?? usage.completion_tokens ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (inTok * p.in + outTok * p.out) / 1e6;
}

// ---------- 儲存：Redis（REDIS_URL，例如 Render Key Value）> 檔案 > 記憶體 ----------
let state = { month: monthKey(), spentUsd: 0, calls: 0, days: {} };
let mode = 'memory';
function loadFile() {
  try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); mode = 'file'; }
  catch (e) { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); mode = 'file'; } catch {} }
}
let saveTimer = null;
function saveFile() {
  if (mode !== 'file' || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(state)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('usage save failed', e.message); }
  }, 200);
}

// 迷你 Redis 客戶端（只用 GET / INCRBY / EXPIRE）
const REDIS_URL = process.env.REDIS_URL;
function redis(...args) {
  return new Promise((ok, fail) => {
    const u = new URL(REDIS_URL);
    const s = net.connect(+u.port || 6379, u.hostname);
    const cmds = [];
    if (u.password) cmds.push(u.username && u.username !== 'default' ? ['AUTH', decodeURIComponent(u.username), decodeURIComponent(u.password)] : ['AUTH', decodeURIComponent(u.password)]);
    cmds.push(args);
    let buf = ''; s.setTimeout(3000, () => { s.destroy(); fail(new Error('redis timeout')); });
    s.on('connect', () => s.write(cmds.map(c => `*${c.length}\r\n` + c.map(a => { a = String(a); return `$${Buffer.byteLength(a)}\r\n${a}\r\n`; }).join('')).join('')));
    s.on('data', d => { buf += d;
      const replies = buf.split('\r\n'); // 簡單解析：取最後一個完整回覆
      const lines = replies.filter(Boolean);
      if (lines.some(l => l.startsWith('-'))) { s.end(); return fail(new Error(lines.find(l => l.startsWith('-')))); }
      const need = cmds.length; let got = 0, last = null;
      for (let i = 0; i < lines.length; i++) { const l = lines[i];
        if (l[0] === '+' || l[0] === ':') { got++; last = l.slice(1); }
        else if (l === '$-1') { got++; last = null; }
        else if (l[0] === '$') { if (i + 1 < lines.length) { got++; last = lines[++i]; } } }
      if (got >= need) { s.end(); ok(last); }
    });
    s.on('error', fail);
  });
}

async function init() {
  if (REDIS_URL) { try { await redis('PING'); mode = 'redis'; return; } catch (e) { console.error('redis unavailable, fallback to file:', e.message); } }
  loadFile();
}
function rollover() {
  const m = monthKey();
  if (state.month !== m) { state = { month: m, spentUsd: 0, calls: 0, days: {} }; }
  const today = tz();
  for (const d of Object.keys(state.days)) if (d !== today) delete state.days[d];
}

async function getSpentUsd() {
  if (mode === 'redis') return (+(await redis('GET', `mk:spent:${monthKey()}`)) || 0) / 1e6;
  rollover(); return state.spentUsd;
}
async function getUserCalls(user) {
  if (mode === 'redis') return +(await redis('GET', `mk:day:${tz()}:${user}`)) || 0;
  rollover(); return state.days[tz()]?.[user] || 0;
}

const budgetUsd = () => BUDGET_TWD / USD_TWD;

// 呼叫 AI 前檢查；回傳 null = 可以，否則回傳 { status, code, error }
async function check(user) {
  try {
    const spent = await getSpentUsd();
    if (spent + RESERVE_USD >= budgetUsd())
      return { status: 429, code: 'monthly', error: '這個月的 AI 額度用完囉，下個月再來唷 🌙' };
    const calls = await getUserCalls(user);
    if (calls >= DAILY_LIMIT * CALLS_PER_USE)
      return { status: 429, code: 'daily', error: `今天已經用了 ${DAILY_LIMIT} 次囉，明天再來找我吧 ☀️` };
    return null;
  } catch (e) {
    console.error('budget check failed', e.message);
    return { status: 503, code: 'budget', error: '系統忙碌中，請稍後再試' }; // 查不到用量就不呼叫，寧可保守
  }
}

// 呼叫完成後記帳（失敗的呼叫也要算，因為可能已計費）
async function record(user, model, usage) {
  const usd = costUsd(model, usage);
  try {
    if (mode === 'redis') {
      const mk = `mk:spent:${monthKey()}`, dk = `mk:day:${tz()}:${user}`;
      await redis('INCRBY', mk, Math.ceil(usd * 1e6)); await redis('EXPIRE', mk, 40 * 86400);
      await redis('INCRBY', `mk:calls:${monthKey()}`, 1); await redis('EXPIRE', `mk:calls:${monthKey()}`, 40 * 86400);
      await redis('INCRBY', dk, 1); await redis('EXPIRE', dk, 2 * 86400);
    } else {
      rollover(); state.spentUsd += usd; state.calls++;
      const d = (state.days[tz()] ||= {}); d[user] = (d[user] || 0) + 1; saveFile();
    }
  } catch (e) { console.error('budget record failed', e.message); }
  return usd;
}
// 呼叫失敗但沒拿到 usage：只算次數
async function countOnly(user) { return record(user, '__none__', { promptTokenCount: 0, totalTokenCount: 0 }); }

async function status() {
  let spent = 0, calls = 0;
  try { spent = await getSpentUsd(); calls = mode === 'redis' ? +(await redis('GET', `mk:calls:${monthKey()}`)) || 0 : state.calls; } catch {}
  const r2 = x => Math.round(x * 100) / 100;
  return { month: monthKey(), budgetTwd: BUDGET_TWD, spentTwd: r2(spent * USD_TWD), remainingTwd: r2(Math.max(0, BUDGET_TWD - spent * USD_TWD)),
    aiCalls: calls, usdTwd: USD_TWD, dailyLimitPerUser: DAILY_LIMIT, persistence: mode, timezone: 'Asia/Taipei' };
}

module.exports = { init, check, record, countOnly, status, costUsd };
