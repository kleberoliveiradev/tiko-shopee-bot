'use strict';
const { rid, clampNum, validTz, hhmm } = require('./util');
const { DEFAULT_TEMPLATE, upgradeTemplate } = require('./message');
const { parseChannel } = require('./source');
const { validIds } = require('./niches');
const plan = require('./plan');

class ValidationError extends Error {}

const TOKEN_RE = /^\d{5,}:[\w-]{30,}$/;
const CHAT_RE = /^(-?\d{5,}|@[A-Za-z][\w]{3,})$/;

function defaultBot(name) {
  return {
    id: rid(6),
    name: name || 'Novo robô',
    enabled: false,
    channels: { telegram: true, whatsapp: true }, // o que o cliente contratou (o dono escolhe)
    inviteToken: rid(18),
    createdAt: Date.now(),
    shopee: { appId: '', secret: '', subId: 'robo' },
    telegram: { token: '', chatId: '', botUsername: '', pendingUsername: '', pendingAt: 0 },
    search: {
      niches: [], // ids do catálogo em niches.js; vazio = "variedades" (ou só as palavras extras)
      keywords: [], // palavras extras da pessoa (somadas ao nicho)
      sortType: 2, // 1 relevância · 2 mais vendidos · 3 maior preço · 4 menor preço · 5 maior comissão
      listType: 0, // 0 todos · 2 top performance
      pagesPerKeyword: 2,
      ranking: 'desconto', // desconto | vendas | comissao | misto
    },
    source: { channels: [], mode: 'only', applyFilters: true },
    whatsapp: { enabled: false, accepted: false, groupIds: [], dests: [], sources: [], includeImage: true, maxPerDay: 40, maxPerHour: 8, minGapSec: 45 },
    filters: {
      minDiscount: 20, minRating: 4.3, minSales: 50, minPrice: 0, maxPrice: 0,
      minCommission: 0, onlyWithImage: true, blockWords: [],
    },
    schedule: {
      intervalMinutes: 30, postsPerCycle: 3, delaySec: 8,
      activeFrom: '08:00', activeTo: '22:00', timezone: 'America/Sao_Paulo', dedupeDays: 7,
    },
    message: { template: DEFAULT_TEMPLATE },
  };
}

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// Robôs criados antes do recurso de fonte não têm o campo: preenche o padrão.
function ensureSource(bot) {
  const s = (bot.source ||= {});
  if (!Array.isArray(s.channels)) s.channels = [];
  if (s.mode !== 'mix') s.mode = 'only';
  if (typeof s.applyFilters !== 'boolean') s.applyFilters = true;
  return s;
}

// Robôs antigos: garante o campo de nichos e tira a lista de exemplo que era o padrão antigo.
const LEGACY_KEYWORDS = ['fone bluetooth', 'air fryer', 'smartwatch', 'tênis masculino', 'organizador'];
function ensureSearch(bot) {
  const s = bot.search;
  if (!Array.isArray(s.niches)) s.niches = [];
  if (!Array.isArray(s.keywords)) s.keywords = [];
  if (s.keywords.length === LEGACY_KEYWORDS.length && LEGACY_KEYWORDS.every((k, i) => s.keywords[i] === k)) s.keywords = [];
  return s;
}

// Canais contratados: robôs antigos ficam com os dois. Sempre pelo menos um.
function ensureChannels(bot) {
  const c = (bot.channels ||= { telegram: true, whatsapp: true });
  c.telegram = c.telegram !== false;
  c.whatsapp = c.whatsapp !== false;
  if (!c.telegram && !c.whatsapp) c.telegram = true;
  return c;
}

// WhatsApp (módulo experimental): preenche o padrão em robôs antigos.
function ensureWa(bot) {
  const w = (bot.whatsapp ||= {});
  w.enabled = !!w.enabled;
  w.accepted = !!w.accepted;
  if (!Array.isArray(w.groupIds)) w.groupIds = [];
  if (!Array.isArray(w.dests)) w.dests = [];
  if (!Array.isArray(w.sources)) w.sources = [];
  if (typeof w.displayName !== 'string') w.displayName = '';
  if (typeof w.includeImage !== 'boolean') w.includeImage = true;
  w.maxPerDay = Number.isFinite(w.maxPerDay) ? w.maxPerDay : 40;
  w.maxPerHour = Number.isFinite(w.maxPerHour) ? w.maxPerHour : 8;
  w.minGapSec = Number.isFinite(w.minGapSec) ? w.minGapSec : 45;
  return w;
}

function list(v, maxItems = 40, maxLen = 60) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[\n,;]+/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean).map((s) => s.slice(0, maxLen)))].slice(0, maxItems);
}

const pick = (v, allowed, def) => (allowed.includes(Number(v)) ? Number(v) : allowed.includes(v) ? v : def);

// Aplica a entrada validada. scope 'client' = só o que o afiliado pode mexer.
function applyInput(bot, input, scope) {
  const admin = scope === 'admin';
  const i = input || {};

  if (typeof i.name === 'string' && i.name.trim()) bot.name = str(i.name, 60);

  const s = i.shopee || {};
  if (typeof s.appId === 'string') bot.shopee.appId = str(s.appId, 40).replace(/\s/g, '');
  if (typeof s.secret === 'string' && s.secret.trim()) bot.shopee.secret = str(s.secret, 200).replace(/\s/g, '');
  if (typeof s.subId === 'string') bot.shopee.subId = str(s.subId, 30).replace(/[^\w-]/g, '');

  const t = i.telegram || {};
  if (typeof t.token === 'string' && t.token.trim()) {
    const tk = t.token.trim();
    if (!TOKEN_RE.test(tk)) throw new ValidationError('Token do bot inválido. Ele tem o formato 123456789:AAxxxxxxxx (copie do @BotFather).');
    if (tk !== bot.telegram.token) {
      bot.telegram.botUsername = ''; // token colado à mão: o @ do bot é descoberto de novo quando preciso
      bot.telegram.pendingUsername = '';
    }
    bot.telegram.token = tk;
  }
  if (typeof t.chatId === 'string') {
    const ids = t.chatId.split(/[,;\s]+/).filter(Boolean);
    for (const c of ids) if (!CHAT_RE.test(c)) throw new ValidationError(`ID do grupo inválido: "${c}". Use algo como -1001234567890 ou @meucanal.`);
    bot.telegram.chatId = ids.join(',');
  }

  const se = i.search || {};
  ensureSearch(bot);
  if ('keywords' in se) bot.search.keywords = list(se.keywords);
  if ('niches' in se) bot.search.niches = validIds(list(se.niches, 30, 40)).slice(0, 6);

  const so = i.source || {};
  if ('channels' in so) {
    const src = ensureSource(bot);
    const names = [];
    for (const raw of list(so.channels, 10, 120)) {
      const n = parseChannel(raw);
      if (!n) throw new ValidationError(`Canal inválido: "${raw}". Use o endereço de um canal público, como t.me/nomedocanal (links de convite privados não funcionam).`);
      if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    src.channels = names;
  }
  if ('mode' in so) ensureSource(bot).mode = so.mode === 'mix' ? 'mix' : 'only';
  if ('applyFilters' in so) ensureSource(bot).applyFilters = !!so.applyFilters;

  const wi = i.whatsapp || {};
  if (Object.keys(wi).length) {
    const wa = ensureWa(bot);
    if ('accepted' in wi) wa.accepted = !!wi.accepted;
    if ('includeImage' in wi) wa.includeImage = !!wi.includeImage;
    if ('groupIds' in wi) {
      const ids = list(wi.groupIds, 5, 80);
      for (const g of ids) if (!/^[\w.-]+@g\.us$/.test(g)) throw new ValidationError('Grupo de WhatsApp inválido. Escolha o grupo na lista, depois de conectar.');
      wa.groupIds = ids;
    }
    if ('enabled' in wi) {
      if (wi.enabled && !ensureChannels(bot).whatsapp) throw new ValidationError('O WhatsApp não está incluído no seu plano.');
      if (wi.enabled && !wa.accepted) throw new ValidationError('Para ligar o WhatsApp, marque que você entendeu os riscos.');
      if (wi.enabled && !wa.groupIds.length) throw new ValidationError('Escolha pelo menos um grupo de WhatsApp antes de ligar.');
      wa.enabled = !!wi.enabled;
    }
  }

  const f = i.filters || {};
  if ('minDiscount' in f) bot.filters.minDiscount = clampNum(f.minDiscount, 0, 95, bot.filters.minDiscount);

  const sc = i.schedule || {};
  if ('intervalMinutes' in sc) bot.schedule.intervalMinutes = clampNum(sc.intervalMinutes, 5, 1440, bot.schedule.intervalMinutes);
  if ('postsPerCycle' in sc) bot.schedule.postsPerCycle = Math.round(clampNum(sc.postsPerCycle, 1, 10, bot.schedule.postsPerCycle));

  if (!admin) return;

  if (i.channels && typeof i.channels === 'object') {
    const c = ensureChannels(bot);
    const next = { telegram: 'telegram' in i.channels ? !!i.channels.telegram : c.telegram, whatsapp: 'whatsapp' in i.channels ? !!i.channels.whatsapp : c.whatsapp };
    if (!next.telegram && !next.whatsapp) throw new ValidationError('Escolha pelo menos um canal: Telegram e/ou WhatsApp.');
    bot.channels = next;
    if (!next.whatsapp) ensureWa(bot).enabled = false;
  }

  if ('sortType' in se) bot.search.sortType = pick(se.sortType, [1, 2, 3, 4, 5], bot.search.sortType);
  if ('listType' in se) bot.search.listType = pick(se.listType, [0, 2], bot.search.listType);
  if ('pagesPerKeyword' in se) bot.search.pagesPerKeyword = Math.round(clampNum(se.pagesPerKeyword, 1, 5, bot.search.pagesPerKeyword));
  if ('ranking' in se) bot.search.ranking = pick(se.ranking, ['desconto', 'vendas', 'comissao', 'misto'], bot.search.ranking);

  if ('minRating' in f) bot.filters.minRating = clampNum(f.minRating, 0, 5, bot.filters.minRating);
  if ('minSales' in f) bot.filters.minSales = Math.round(clampNum(f.minSales, 0, 1e7, bot.filters.minSales));
  if ('minPrice' in f) bot.filters.minPrice = clampNum(f.minPrice, 0, 1e6, bot.filters.minPrice);
  if ('maxPrice' in f) bot.filters.maxPrice = clampNum(f.maxPrice, 0, 1e6, bot.filters.maxPrice);
  if ('minCommission' in f) bot.filters.minCommission = clampNum(f.minCommission, 0, 100, bot.filters.minCommission);
  if ('onlyWithImage' in f) bot.filters.onlyWithImage = !!f.onlyWithImage;
  if ('blockWords' in f) bot.filters.blockWords = list(f.blockWords, 60, 40).map((w) => w.toLowerCase());

  if (Object.keys(wi).length) {
    const wa = ensureWa(bot);
    if ('maxPerDay' in wi) wa.maxPerDay = Math.round(clampNum(wi.maxPerDay, 1, 80, wa.maxPerDay));
    if ('maxPerHour' in wi) wa.maxPerHour = Math.round(clampNum(wi.maxPerHour, 1, 15, wa.maxPerHour));
    if ('minGapSec' in wi) wa.minGapSec = Math.round(clampNum(wi.minGapSec, 20, 300, wa.minGapSec));
  }

  if ('delaySec' in sc) bot.schedule.delaySec = clampNum(sc.delaySec, 1, 120, bot.schedule.delaySec);
  if ('activeFrom' in sc) bot.schedule.activeFrom = hhmm(sc.activeFrom, null) === null ? bot.schedule.activeFrom : str(sc.activeFrom, 5);
  if ('activeTo' in sc) bot.schedule.activeTo = hhmm(sc.activeTo, null) === null ? bot.schedule.activeTo : str(sc.activeTo, 5);
  if ('timezone' in sc && validTz(sc.timezone)) bot.schedule.timezone = sc.timezone;
  if ('dedupeDays' in sc) bot.schedule.dedupeDays = Math.round(clampNum(sc.dedupeDays, 1, 90, bot.schedule.dedupeDays));

  const m = i.message || {};
  if (typeof m.template === 'string') bot.message.template = m.template.trim() ? m.template.slice(0, 1500) : DEFAULT_TEMPLATE;
}

const hint = (v) => (v ? `••••${String(v).slice(-4)}` : '');

// Visão enviada ao navegador: segredos nunca saem do servidor.
function publicBot(bot, scope) {
  const admin = scope === 'admin';
  const out = {
    name: bot.name,
    enabled: bot.enabled,
    channels: { ...ensureChannels(bot) },
    shopee: { appId: bot.shopee.appId, subId: bot.shopee.subId, secretSet: !!bot.shopee.secret, secretHint: hint(bot.shopee.secret) },
    telegram: { chatId: bot.telegram.chatId, tokenSet: !!bot.telegram.token, tokenHint: hint(bot.telegram.token), botUsername: bot.telegram.botUsername || '' },
    source: { ...ensureSource(bot) },
    whatsapp: { ...ensureWa(bot) },
    search: { niches: ensureSearch(bot).niches, keywords: bot.search.keywords, ...(admin ? { sortType: bot.search.sortType, listType: bot.search.listType, pagesPerKeyword: bot.search.pagesPerKeyword, ranking: bot.search.ranking } : {}) },
    plan: plan.view(bot, admin),
    filters: admin ? bot.filters : { minDiscount: bot.filters.minDiscount },
    schedule: admin ? bot.schedule : { intervalMinutes: bot.schedule.intervalMinutes, postsPerCycle: bot.schedule.postsPerCycle },
  };
  if (admin) {
    out.id = bot.id;
    out.inviteToken = bot.inviteToken;
    out.message = { template: upgradeTemplate(bot.message.template) };
  }
  return out;
}

function missingSetup(bot, { needTelegram = true } = {}) {
  const miss = [];
  if (!bot.shopee.appId || !bot.shopee.secret) miss.push('AppID e Secret da Shopee');
  const ch = ensureChannels(bot);
  if (needTelegram && ch.telegram && (!bot.telegram.token || !bot.telegram.chatId)) miss.push('token do bot e ID do grupo do Telegram');
  if (needTelegram && !ch.telegram) {
    const w = ensureWa(bot);
    if (!w.enabled || !w.groupIds.length) miss.push('WhatsApp conectado, com o grupo escolhido e ligado');
  }
  return miss;
}

module.exports = { defaultBot, applyInput, publicBot, missingSetup, ensureSource, ensureWa, ensureSearch, ensureChannels, ValidationError, TOKEN_RE };
