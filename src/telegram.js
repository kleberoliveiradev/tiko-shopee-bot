'use strict';
const { sleep } = require('./util');

const apiBase = () => process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

class TelegramError extends Error {
  constructor(message, code = 0) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
  }
}

function friendly(desc, code) {
  const d = String(desc || '');
  if (code === 401 || /unauthorized/i.test(d)) return 'Token do bot inválido. Copie de novo no @BotFather.';
  if (/chat not found/i.test(d)) return 'Grupo não encontrado: confira o ID e adicione o bot ao grupo/canal.';
  if (/not enough rights|have no rights|bot was kicked|bot is not a member|administrator rights|CHAT_WRITE_FORBIDDEN/i.test(d))
    return 'O bot não tem permissão para postar nesse grupo/canal. Adicione-o como administrador.';
  if (/group chat was upgraded/i.test(d)) return 'O grupo virou supergrupo e mudou de ID. Detecte o grupo de novo.';
  return d;
}

async function call(token, method, params = {}, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${apiBase()}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new TelegramError(`Falha de rede com o Telegram: ${e.cause?.code || e.message}`);
    }
    const j = await res.json().catch(() => null);
    if (j?.ok) return j.result;
    const code = j?.error_code || res.status;
    if (code === 429 && attempt < retries) {
      await sleep(((j?.parameters?.retry_after || 5) + 0.5) * 1000);
      continue;
    }
    const err = new TelegramError(friendly(j?.description, code) || `HTTP ${res.status}`, code);
    err.raw = String(j?.description || '');
    throw err;
  }
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const stripHtml = (html) => decode(String(html).replace(/<[^>]+>/g, ''));

// Envia com HTML; se o Telegram reclamar do HTML, reenvia em texto puro.
async function withHtmlFallback(token, method, params) {
  try {
    return await call(token, method, { ...params, parse_mode: 'HTML' });
  } catch (e) {
    if (/parse entities|can't find end/i.test(e.raw || e.message)) {
      const p = { ...params };
      if (p.caption) p.caption = stripHtml(p.caption);
      if (p.text) p.text = stripHtml(p.text);
      return call(token, method, p);
    }
    throw e;
  }
}

// Foto + legenda; se a foto falhar (URL inválida, legenda longa), cai para mensagem de texto.
async function sendProduct(token, chatId, { image, html }) {
  if (image) {
    try {
      return await withHtmlFallback(token, 'sendPhoto', { chat_id: chatId, photo: image, caption: html });
    } catch (e) {
      if (!/photo|image|http url|wrong file|wrong type|web page content|caption is too long|failed to get/i.test(e.raw || e.message)) throw e;
    }
  }
  return withHtmlFallback(token, 'sendMessage', { chat_id: chatId, text: html });
}

const getMe = (token) => call(token, 'getMe');
const sendText = (token, chatId, text) => call(token, 'sendMessage', { chat_id: chatId, text });

// Lista os chats em que o bot apareceu (para o afiliado escolher o grupo sem precisar caçar o ID).
// O Telegram só aceita UM getUpdates por vez para o mesmo bot (senão responde "Conflict"). Como a página
// consulta sozinha a cada poucos segundos e a pessoa também clica no botão, as chamadas simultâneas
// compartilham a mesma consulta, e um conflito passageiro é repetido uma vez.
const inflight = new Map();

async function fetchChats(token) {
  const params = { limit: 100, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member'] };
  let updates;
  try {
    updates = await call(token, 'getUpdates', params);
  } catch (e) {
    if (!/conflict/i.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    updates = await call(token, 'getUpdates', params);
  }
  const found = new Map();
  const privates = new Map();
  for (const u of updates) {
    const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
    if (!chat) continue;
    if (chat.type === 'private') {
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
      privates.set(String(chat.id), { id: String(chat.id), title: name, type: 'private' });
    } else {
      found.set(String(chat.id), { id: String(chat.id), title: chat.title || chat.username || String(chat.id), type: chat.type });
    }
  }
  return { groups: [...found.values()], privates: [...privates.values()] };
}

function detectAll(token) {
  if (!inflight.has(token)) {
    const p = fetchChats(token).finally(() => inflight.delete(token));
    inflight.set(token, p);
  }
  return inflight.get(token);
}

// Só grupos e canais (o que o painel e o botão "Detectar grupo" mostram).
const detectChats = (token) => detectAll(token).then((r) => r.groups);

module.exports = { call, sendProduct, sendText, getMe, detectChats, detectAll, TelegramError, stripHtml };
