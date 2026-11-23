'use strict';
// Robô de Ofertas Shopee → Telegram. Servidor sem dependências externas (Node >= 20).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Store } = require('./src/store');
const { Engine } = require('./src/engine');
const { defaultBot, applyInput, publicBot, missingSetup, ensureWa, ensureChannels, ValidationError } = require('./src/bots');
const { publicNiches } = require('./src/niches');
const { render, VARIABLES, SAMPLE_PRODUCT, DEFAULT_TEMPLATE } = require('./src/message');
const telegram = require('./src/telegram');
const { rid, inWindow } = require('./src/util');
const plan = require('./src/plan');

const PORT = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TICK_MS = Number(process.env.SCHEDULER_TICK_MS) || 20000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_MS = 7 * 86400000;

const { Managed } = require('./src/managed');
const { WhatsApp } = require('./src/whatsapp');

const store = new Store(DATA_DIR);
const engine = new Engine(store);
const managed = new Managed(store);
const wa = new WhatsApp(store, DATA_DIR);
engine.wa = wa;

/* ───────────── Segurança: chave de sessão, senha, limites ───────────── */
const keyFile = path.join(DATA_DIR, 'secret.key');
fs.mkdirSync(DATA_DIR, { recursive: true });
let SESSION_KEY;
try {
  SESSION_KEY = fs.readFileSync(keyFile, 'utf8').trim();
} catch {
  SESSION_KEY = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFile, SESSION_KEY, { mode: 0o600 });
}
const hmac = (s) => crypto.createHmac('sha256', SESSION_KEY).update(s).digest('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const ENV_PASSWORD = process.env.ADMIN_PASSWORD || '';
const authConfigured = () => !!ENV_PASSWORD || !!store.config.auth;
let setupCode = '';
if (!authConfigured()) {
  setupCode = process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex');
}

function checkPassword(pw) {
  if (ENV_PASSWORD) return safeEq(pw, ENV_PASSWORD);
  const a = store.config.auth;
  if (!a) return false;
  const h = crypto.scryptSync(String(pw), Buffer.from(a.salt, 'hex'), 64).toString('hex');
  return safeEq(h, a.hash);
}

const buckets = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  b.n++;
  return b.n <= max;
}
const tooMany = (key, max, windowMs) => !allow(key, max, windowMs);
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 600000).unref();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (x) return x;
  }
  return req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isAuthed(req) {
  const v = parseCookies(req).sid;
  if (!v) return false;
  const [exp, sig] = v.split('.');
  return !!sig && safeEq(sig, hmac(exp)) && Number(exp) > Date.now();
}

function sessionCookie(req, value, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `sid=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// CSRF: aceita a requisição se não há Origin (ferramentas), se o Origin bate com o Host
// (ou com o X-Forwarded-Host atrás de proxy), ou se o navegador declara Sec-Fetch-Site: same-origin.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers.host) return true;
  if (TRUST_PROXY) {
    const xfh = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    if (xfh && host === xfh) return true;
    if (req.headers['sec-fetch-site'] === 'same-origin') return true;
  }
  return false;
}

/* ───────────── Infra HTTP ───────────── */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Requisição grande demais.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

/* ───────────── Regras de negócio compartilhadas (admin e afiliado) ───────────── */
function updateBot(bot, input, scope) {
  const draft = structuredClone(bot);
  applyInput(draft, input, scope);
  Object.assign(bot, draft);
  store.saveConfig();
}

function summary(bot) {
  const st = store.st(bot.id);
  return {
    id: bot.id, name: bot.name, enabled: bot.enabled, running: engine.isRunning(bot.id),
    configured: missingSetup(bot).length === 0, posted: st.stats.posted,
    plan: plan.view(bot),
  };
}

function activity(bot) {
  const st = store.st(bot.id);
  const hist = store.hist(bot.id);
  return {
    enabled: bot.enabled,
    running: engine.isRunning(bot.id),
    plan: plan.view(bot),
    configured: missingSetup(bot).length === 0,
    inWindow: inWindow(bot.schedule.activeFrom, bot.schedule.activeTo, bot.schedule.timezone),
    nextRunAt: bot.enabled ? st.nextRunAt : 0,
    stats: st.stats,
    logs: (store.logs.get(bot.id) || []).slice(-80),
    recent: hist.recent.slice(0, 15),
  };
}

function setEnabled(bot, enabled) {
  if (enabled) {
    if (!plan.isActive(bot)) throw new HttpError(402, 'O plano está vencido ou ainda não foi ativado. Para ligar o robô, fale com quem te enviou o robô para ativar ou renovar.');
    const miss = missingSetup(bot);
    if (miss.length) throw new HttpError(400, `Antes de ligar, preencha: ${miss.join(' e ')}.`);
    store.st(bot.id).nextRunAt = Date.now() + 3000;
    store.log(bot.id, 'info', 'Robô ligado.');
  } else {
    store.log(bot.id, 'info', 'Robô pausado.');
  }
  bot.enabled = !!enabled;
  store.saveConfig();
}

async function testShopee(bot, input) {
  const s = input.shopee || {};
  const appId = String(s.appId || bot.shopee.appId || '').trim();
  const secret = String(s.secret || '').trim() || bot.shopee.secret;
  if (!appId || !secret) throw new HttpError(400, 'Informe o AppID e o Secret da Shopee.');
  try {
    const r = await engine.testShopee({ appId, secret });
    return { ok: true, message: r.sample ? `Conectado à Shopee! Exemplo de produto: ${r.sample.slice(0, 70)}` : 'Conectado à Shopee!' };
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

function resolveTelegramInput(bot, input) {
  const t = input.telegram || {};
  const token = String(t.token || '').trim() || bot.telegram.token;
  const chatId = typeof t.chatId === 'string' ? t.chatId.trim() : bot.telegram.chatId;
  return { token, chatId };
}

async function testTelegram(bot, input) {
  const { token, chatId } = resolveTelegramInput(bot, input);
  if (!token) throw new HttpError(400, 'Informe o token do bot do Telegram.');
  if (!chatId) throw new HttpError(400, 'Informe o ID do grupo (ou use "Detectar grupo").');
  const probe = structuredClone(bot);
  applyInput(probe, { telegram: { token, chatId } }, 'client'); // valida formato
  try {
    const r = await engine.testTelegram(token, probe.telegram.chatId, bot.name);
    return { ok: true, message: `Telegram OK (@${r.username}). Enviei uma mensagem de teste ao grupo.` };
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

async function detectChats(bot, input) {
  const { token } = resolveTelegramInput(bot, input);
  if (!token) throw new HttpError(400, 'Informe o token do bot primeiro.');
  try {
    const me = await telegram.getMe(token);
    const chats = await telegram.detectChats(token);
    return { username: me.username, chats };
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

// Estado da criação automática do bot (usado pela página do afiliado).
async function managedInfo(bot) {
  const t = bot.telegram;
  if (t.token && !t.botUsername) {
    try {
      t.botUsername = (await telegram.getMe(t.token)).username || '';
      store.saveConfig();
    } catch { /* token ruim: o teste de conexão mostra o motivo */ }
  }
  return { available: managed.available(), connected: !!t.token, botUsername: t.botUsername || '', pending: !!t.pendingUsername, chatId: t.chatId, ...managed.groupLinks(t.botUsername) };
}

function runNow(bot) {
  if (!plan.isActive(bot)) throw new HttpError(402, 'O plano está vencido ou ainda não foi ativado.');
  const miss = missingSetup(bot);
  if (miss.length) throw new HttpError(400, `Falta configurar: ${miss.join(' e ')}.`);
  if (engine.isRunning(bot.id)) throw new HttpError(409, 'O robô já está executando.');
  engine.runCycle(bot, { manual: true }).catch(() => {});
  return { started: true };
}

/* ───────────── Rotas ───────────── */
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
}

const adminBot = (fn) => (ctx) => {
  if (!isAuthed(ctx.req)) throw new HttpError(401, 'Faça login.');
  const bot = store.getBot(ctx.params.id);
  if (!bot) throw new HttpError(404, 'Robô não encontrado.');
  return fn(bot, ctx, 'admin');
};
const adminOnly = (fn) => (ctx) => {
  if (!isAuthed(ctx.req)) throw new HttpError(401, 'Faça login.');
  return fn(ctx);
};
const clientBot = (fn) => (ctx) => {
  const ip = clientIp(ctx.req);
  if (tooMany(`c:${ip}`, 300, 900000)) throw new HttpError(429, 'Muitas requisições. Aguarde alguns minutos.');
  const bot = store.findByToken(ctx.params.token);
  if (!bot) {
    if (tooMany(`cbad:${ip}`, 30, 900000)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    throw new HttpError(404, 'Link inválido ou expirado. Peça um novo link para quem te enviou.');
  }
  return fn(bot, ctx, 'client');
};

// Rotas iguais para o painel do dono (admin) e para a página do afiliado (client).
function sharedRoutes(base, wrap) {
  route('GET', base, wrap((bot, _c, scope) => ({ bot: publicBot(bot, scope), activity: activity(bot), variables: VARIABLES, defaultTemplate: DEFAULT_TEMPLATE, niches: publicNiches() })));
  route('PUT', base, wrap(async (bot, ctx, scope) => {
    updateBot(bot, ctx.body, scope);
    return { ok: true, bot: publicBot(bot, scope) };
  }));
  route('POST', `${base}/enable`, wrap((bot, ctx) => {
    setEnabled(bot, !!ctx.body.enabled);
    return { ok: true, enabled: bot.enabled };
  }));
  route('POST', `${base}/test-shopee`, wrap((bot, ctx) => testShopee(bot, ctx.body)));
  route('POST', `${base}/test-telegram`, wrap((bot, ctx) => testTelegram(bot, ctx.body)));
  route('POST', `${base}/telegram-chats`, wrap((bot, ctx) => detectChats(bot, ctx.body)));
  route('GET', `${base}/activity`, wrap((bot) => activity(bot)));
  route('POST', `${base}/test-source`, wrap(async (bot, ctx) => {
    const draft = structuredClone(bot);
    applyInput(draft, { source: { channels: ctx.body.source?.channels ?? draft.source?.channels ?? [] } }, 'client'); // valida e normaliza
    const channels = draft.source.channels;
    if (!channels.length) throw new HttpError(400, 'Informe pelo menos um canal público (ex.: t.me/nomedocanal).');
    return { results: await engine.testSource(bot, channels) };
  }));
  route('GET', `${base}/whatsapp`, wrap((bot) => wa.status(bot)));
  route('POST', `${base}/whatsapp/connect`, wrap(async (bot, ctx) => {
    if (!ensureWa(bot).accepted) throw new HttpError(400, 'Marque que você entendeu os riscos antes de conectar.');
    try {
      return await wa.connect(bot, ctx.body.phone);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }));
  route('POST', `${base}/whatsapp/groups`, wrap(async (bot) => {
    try {
      return { groups: await wa.listGroups(bot) };
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }));
  route('POST', `${base}/whatsapp/disconnect`, wrap(async (bot) => {
    await wa.disconnect(bot.id);
    ensureWa(bot).enabled = false;
    bot.whatsapp.sources = [];
    bot.whatsapp.dests = [];
    bot.whatsapp.groupIds = [];
    store.st(bot.id).waLinks = [];
    store.saveConfig();
    store.saveState();
    return wa.status(bot);
  }));
  // WhatsApp: o robô LÊ os grupos de ofertas (source) e POSTA no grupo do cliente (dest).
  const addWaGroup = (kind) => wrap(async (bot, ctx) => {
    if (!ensureChannels(bot).whatsapp) throw new HttpError(400, 'O WhatsApp não está incluído no seu plano.');
    if (!ensureWa(bot).accepted) throw new HttpError(400, 'Marque que você entendeu os riscos antes de continuar.');
    try {
      return await wa.addGroup(bot, ctx.body.link, kind);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  });
  route('POST', `${base}/whatsapp/source`, addWaGroup('source'));
  route('POST', `${base}/whatsapp/dest`, addWaGroup('dest'));
  route('POST', `${base}/whatsapp/source/remove`, wrap((bot, ctx) => wa.removeSource(bot, String(ctx.body.id || ''))));
  route('POST', `${base}/whatsapp/dest/remove`, wrap((bot, ctx) => wa.removeDest(bot, String(ctx.body.id || ''))));
  route('POST', `${base}/whatsapp/profile-name`, wrap(async (bot, ctx) => {
    if (!ensureChannels(bot).whatsapp) throw new HttpError(400, 'O WhatsApp não está incluído no seu plano.');
    try {
      return await wa.setProfileName(bot, ctx.body.name);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }));
  route('POST', `${base}/whatsapp/test`, wrap(async (bot) => {
    try {
      return await wa.sendTest(bot);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }));
  route('GET', `${base}/managed`, wrap((bot) => managedInfo(bot)));
  route('POST', `${base}/managed/start`, wrap(async (bot) => {
    let r;
    try {
      r = managed.start(bot);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    return { ...r, ...(await managedInfo(bot)) };
  }));
  // Procura o grupo onde o bot foi adicionado; se houver só um, já escolhe.
  route('POST', `${base}/auto-group`, wrap(async (bot) => {
    if (!bot.telegram.token) throw new HttpError(400, 'Crie o bot do Telegram primeiro.');
    let found;
    try {
      found = await telegram.detectAll(bot.telegram.token);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const chats = found.groups;
    let selected = null;
    // IDs de grupo/canal são negativos; positivo = conversa privada. Se o cliente estava usando o privado
    // e depois criou um grupo, o grupo passa a ser o destino.
    const usingPrivate = Number(bot.telegram.chatId) > 0;
    if (chats.length === 1 && (!bot.telegram.chatId || usingPrivate)) {
      updateBot(bot, { telegram: { chatId: chats[0].id } }, 'client');
      selected = chats[0];
    }
    return { chats, selected, chatId: bot.telegram.chatId, privateChat: found.privates[0] || null };
  }));
}

// Autenticação do painel
route('GET', '/api/site', () => ({ whatsapp: String(process.env.SALES_WHATSAPP || '').replace(/\D/g, '') }));
route('GET', '/api/auth/status', (ctx) => ({ configured: authConfigured(), loggedIn: isAuthed(ctx.req), envPassword: !!ENV_PASSWORD }));
route('POST', '/api/auth/setup', (ctx) => {
  const ip = clientIp(ctx.req);
  if (authConfigured()) throw new HttpError(403, 'A senha já foi criada.');
  if (tooMany(`auth:${ip}`, 8, 900000)) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  if (!safeEq(String(ctx.body.code || ''), setupCode)) throw new HttpError(403, 'Código de configuração incorreto (veja o terminal/logs do servidor).');
  const pw = String(ctx.body.password || '');
  if (pw.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
  const salt = crypto.randomBytes(16);
  store.config.auth = { salt: salt.toString('hex'), hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
  store.saveConfig();
  setupCode = '';
  return login(ctx);
});
function login(ctx) {
  const exp = Date.now() + SESSION_MS;
  ctx.setHeaders['Set-Cookie'] = sessionCookie(ctx.req, `${exp}.${hmac(String(exp))}`, SESSION_MS / 1000);
  return { ok: true };
}
route('POST', '/api/auth/login', (ctx) => {
  const ip = clientIp(ctx.req);
  if (tooMany(`auth:${ip}`, 8, 900000)) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  if (!authConfigured() || !checkPassword(String(ctx.body.password || ''))) throw new HttpError(401, 'Senha incorreta.');
  buckets.delete(`auth:${ip}`);
  return login(ctx);
});
route('POST', '/api/auth/logout', (ctx) => {
  ctx.setHeaders['Set-Cookie'] = sessionCookie(ctx.req, '', 0);
  return { ok: true };
});

// Bot gerenciador (criação automática dos bots dos afiliados)
route('GET', '/api/manager', adminOnly(() => ({ configured: managed.available(), username: managed.manager?.username || '' })));
route('PUT', '/api/manager', adminOnly(async (ctx) => {
  try {
    const me = await managed.setManager(ctx.body.token);
    return { configured: true, username: me.username };
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}));
route('DELETE', '/api/manager', adminOnly(() => {
  managed.clearManager();
  return { ok: true };
}));

// Painel do dono
route('GET', '/api/bots',adminOnly(() => ({ bots: store.bots.map(summary) })));
route('POST', '/api/bots', adminOnly((ctx) => {
  if (store.bots.length >= 100) throw new HttpError(400, 'Limite de 100 robôs.');
  const bot = defaultBot(String(ctx.body.name || '').trim().slice(0, 60));
  if (ctx.body.channels && typeof ctx.body.channels === 'object') {
    const t = ctx.body.channels.telegram !== false;
    const w = ctx.body.channels.whatsapp !== false;
    if (!t && !w) throw new HttpError(400, 'Escolha pelo menos um canal: Telegram e/ou WhatsApp.');
    bot.channels = { telegram: t, whatsapp: w };
  }
  const chargeDefault = process.env.PLAN_CHARGE_NEW !== '0'; // novos clientes começam sem plano (só trabalham depois de ativados)
  const wantCharge = ctx.body.plan && typeof ctx.body.plan.managed === 'boolean' ? ctx.body.plan.managed : chargeDefault;
  plan.ensurePlan(bot).managed = wantCharge;
  store.addBot(bot);
  return { id: bot.id };
}));
sharedRoutes('/api/bots/:id', adminBot);
route('DELETE', '/api/bots/:id', adminBot(async (bot) => {
  await wa.disconnect(bot.id);
  store.removeBot(bot.id);
  return { ok: true };
}));
route('POST', '/api/bots/:id/plan', adminBot((bot, ctx) => {
  const b = ctx.body || {};
  const p = plan.ensurePlan(bot);
  if (b.action === 'grant') {
    const days = plan.parseDays(b.days ?? plan.DEFAULT_DAYS);
    if (!days) throw new HttpError(400, 'Informe de 1 a 366 dias.');
    const r = plan.grant(bot, days);
    store.log(bot.id, 'ok', `Plano ativo até ${plan.fmtDate(r.expiresAt, bot.schedule.timezone)} (+${days} dias).`);
    // Primeira ativação de um cliente que já deixou tudo configurado: liga o robô sozinho.
    if (r.firstTime && !bot.enabled && missingSetup(bot).length === 0) {
      bot.enabled = true;
      store.log(bot.id, 'info', 'Robô ligado automaticamente com a ativação do plano.');
    }
    if (bot.enabled) store.st(bot.id).nextRunAt = Math.min(store.st(bot.id).nextRunAt || Infinity, Date.now() + 3000);
    store.saveState();
  } else if (b.action === 'revoke') {
    plan.revoke(bot);
    store.log(bot.id, 'warn', 'Plano desativado pelo administrador.');
  } else if (b.action === 'manage') {
    p.managed = !!b.managed;
    store.log(bot.id, 'info', p.managed ? 'Controle de plano ligado para este cliente.' : 'Controle de plano desligado: o robô funciona sem vencimento.');
  } else if (b.action === 'contact') {
    const raw = String(b.contact ?? '').trim();
    const c = plan.cleanContact(raw);
    if (raw && !c) throw new HttpError(400, 'Número inválido. Digite DDD + número (ex.: 11 94678-3584).');
    p.contact = c;
  } else {
    throw new HttpError(400, 'Ação inválida.');
  }
  store.saveConfig();
  return { ok: true, plan: plan.view(bot, true), enabled: bot.enabled };
}));
route('POST', '/api/bots/:id/regen-token', adminBot((bot) => {
  bot.inviteToken = rid(18);
  store.saveConfig();
  return { inviteToken: bot.inviteToken };
}));
route('POST', '/api/bots/:id/run', adminBot((bot) => runNow(bot)));
route('POST', '/api/bots/:id/preview', adminBot(async (bot) => {
  try {
    return await engine.runCycle(bot, { dryRun: true });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}));
route('POST', '/api/bots/:id/post-links', adminBot(async (bot, ctx) => {
  const urls = (Array.isArray(ctx.body.urls) ? ctx.body.urls : String(ctx.body.urls || '').split(/\s+/)).map(String).filter(Boolean);
  if (!urls.length) throw new HttpError(400, 'Cole pelo menos um link da Shopee.');
  try {
    return { results: await engine.postLinks(bot, urls) };
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}));
route('POST', '/api/preview-message', adminOnly((ctx) => ({ html: render(String(ctx.body.template || DEFAULT_TEMPLATE), SAMPLE_PRODUCT, 'https://s.shopee.com.br/exemplo') })));

// Página do afiliado (acesso por link secreto)
sharedRoutes('/api/c/:token', clientBot);

/* ───────────── Servidor ───────────── */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
      if (p === '/vendas' || p === '/vendas/') return serveFile(res, path.join(PUBLIC_DIR, 'vendas.html'));
      if (p === '/') return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
      if (/^\/afiliado\/[\w-]+$/.test(p)) return serveFile(res, path.join(PUBLIC_DIR, 'afiliado.html'));
      if (p.startsWith('/static/')) {
        const file = path.normalize(path.join(PUBLIC_DIR, p.slice(8)));
        if (file.startsWith(PUBLIC_DIR + path.sep)) return serveFile(res, file);
        return send(res, 404, 'Não encontrado');
      }
    }

    if (!p.startsWith('/api/')) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });

    const r = routes.find((x) => x.method === req.method && x.re.test(p));
    if (!r) return sendJson(res, 404, { error: 'Rota não encontrada.' });

    // Proteção CSRF: mutações só com JSON e, se houver Origin, do mesmo host.
    let body = {};
    if (req.method !== 'GET') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      if (!sameOrigin(req)) throw new HttpError(403, 'Origem não permitida.');
      body = await readBody(req);
    }

    const ctx = { req, res, params: r.re.exec(p).groups || {}, body, setHeaders: {} };
    const data = await r.handler(ctx);
    sendJson(res, 200, data, ctx.setHeaders);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    if (e instanceof ValidationError) return sendJson(res, 400, { error: e.message });
    console.error('Erro interno:', e);
    sendJson(res, 500, { error: 'Erro interno do servidor.' });
  }
});

/* ───────────── Agendador ───────────── */
// Avisos de vencimento: vão para o registro do robô e, quando o cliente usa o robô numa conversa privada do Telegram,
// também para ela (num grupo não: o público do grupo veria o aviso).
function planReminders(bot, now) {
  const r = plan.dueReminder(bot, now);
  if (!r) return;
  plan.ensurePlan(bot).notified.level = r.level;
  store.saveConfig();
  store.log(bot.id, r.level === 3 ? 'warn' : 'info', r.text);
  const chat = String(bot.telegram.chatId || '').split(',').map((c) => c.trim()).find((c) => Number(c) > 0);
  if (chat && bot.telegram.token) telegram.sendText(bot.telegram.token, chat, r.text).catch(() => {});
}

function tick() {
  const now = Date.now();
  for (const bot of store.bots) {
    planReminders(bot, now);
    if (!bot.enabled || engine.isRunning(bot.id)) continue;
    if (!plan.isActive(bot, now)) continue;
    if (now < store.st(bot.id).nextRunAt) continue;
    if (!inWindow(bot.schedule.activeFrom, bot.schedule.activeTo, bot.schedule.timezone)) continue;
    engine.runCycle(bot).catch(() => {}); // erros já vão para o log do robô
  }
}

function start() {
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  return new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      const addr = server.address();
      console.log(`\n🛒 Robô de Ofertas Shopee rodando em http://localhost:${addr.port}`);
      if (setupCode) {
        console.log('──────────────────────────────────────────────────────────');
        console.log(`  PRIMEIRO ACESSO: abra o painel e crie sua senha.`);
        console.log(`  Código de configuração: ${setupCode}`);
        console.log('──────────────────────────────────────────────────────────\n');
      }
      if (managed.available()) managed.restart();
      wa.resumeAll().catch(() => {});
      resolve({ server, port: addr.port, store, engine, managed, wa, tick });
    });
  });
}

if (require.main === module) {
  start();
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { start, getSetupCode: () => setupCode };
