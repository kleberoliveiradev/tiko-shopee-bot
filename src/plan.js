'use strict';
// Plano do cliente: o robô só trabalha enquanto o plano está ativo.
// Fluxo manual: o cliente paga o Pix, o dono clica em "Ativar 30 dias". Renovar antes de vencer soma os dias.
// Robôs antigos (sem controle de plano) continuam funcionando como sempre.

const DAY = 86400000;
const DEFAULT_DAYS = 30;
const HISTORY_LIMIT = 30;

function ensurePlan(bot) {
  const p = (bot.plan ||= { managed: false });
  p.managed = !!p.managed;
  if (!Number.isFinite(p.expiresAt)) p.expiresAt = 0;
  if (!Array.isArray(p.history)) p.history = [];
  if (typeof p.contact !== 'string') p.contact = '';
  if (!p.notified || typeof p.notified !== 'object') p.notified = {};
  return p;
}

// state: free (sem controle) | none (ainda não ativado) | active | expiring (faltam até 3 dias) | expired
function status(bot, now = Date.now()) {
  const p = ensurePlan(bot);
  if (!p.managed) return { managed: false, active: true, state: 'free', expiresAt: 0, daysLeft: null };
  if (p.expiresAt <= now) return { managed: true, active: false, state: p.expiresAt ? 'expired' : 'none', expiresAt: p.expiresAt, daysLeft: 0 };
  const daysLeft = Math.ceil((p.expiresAt - now) / DAY);
  return { managed: true, active: true, state: daysLeft <= 3 ? 'expiring' : 'active', expiresAt: p.expiresAt, daysLeft };
}

const isActive = (bot, now) => status(bot, now).active;

function parseDays(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 366) return 0;
  return n;
}

function pushHistory(p, entry) {
  p.history.unshift(entry);
  if (p.history.length > HISTORY_LIMIT) p.history.length = HISTORY_LIMIT;
}

// Soma dias: se o plano ainda está valendo, soma ao vencimento; senão conta a partir de agora.
function grant(bot, days = DEFAULT_DAYS, now = Date.now()) {
  const p = ensurePlan(bot);
  const firstTime = !p.expiresAt;
  const base = p.expiresAt > now ? p.expiresAt : now;
  p.managed = true;
  p.expiresAt = base + days * DAY;
  p.notified = {};
  pushHistory(p, { t: now, kind: 'grant', days, expiresAt: p.expiresAt });
  return { firstTime, expiresAt: p.expiresAt };
}

function revoke(bot, now = Date.now()) {
  const p = ensurePlan(bot);
  p.managed = true;
  p.expiresAt = now;
  p.notified = {};
  pushHistory(p, { t: now, kind: 'revoke', expiresAt: now });
}

function fmtDate(ts, tz = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ts));
}

// Contato do cliente (só dígitos; ganha o 55 do Brasil quando vem só com DDD).
function cleanContact(raw) {
  let d = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : '';
}

// Qual aviso deve sair agora (um por nível: 1 = faltam ≤3 dias, 2 = faltam ≤1 dia, 3 = venceu). null = nenhum.
function dueReminder(bot, now = Date.now()) {
  const p = ensurePlan(bot);
  const s = status(bot, now);
  if (!s.managed || !p.expiresAt) return null;
  let level = 0;
  if (!s.active) level = now - p.expiresAt < 2 * DAY ? 3 : 0; // vencido há muito tempo: não incomoda
  else if (s.daysLeft <= 1) level = 2;
  else if (s.daysLeft <= 3) level = 1;
  if (!level || level <= (p.notified.level || 0)) return null;
  const tz = bot.schedule?.timezone || 'America/Sao_Paulo';
  const date = fmtDate(p.expiresAt, tz);
  const how = 'Para renovar, fale com quem te enviou o robô.';
  const text = level === 3
    ? `⛔ Seu plano do robô de ofertas venceu em ${date}. O robô parou de postar. ${how}`
    : level === 2
      ? `⏰ Seu plano do robô de ofertas vence em menos de 24 horas (${date}). ${how}`
      : `⏰ Seu plano do robô de ofertas vence em ${s.daysLeft} dias (${date}). ${how}`;
  return { level, text };
}

// Visão enviada ao navegador. O histórico e o contato só vão para o painel do dono.
function view(bot, admin = false, now = Date.now()) {
  const p = ensurePlan(bot);
  const out = { ...status(bot, now) };
  if (admin) {
    out.contact = p.contact;
    out.history = p.history.slice(0, 10);
  }
  return out;
}

module.exports = { DAY, DEFAULT_DAYS, ensurePlan, status, isActive, parseDays, grant, revoke, cleanContact, dueReminder, view, fmtDate };
