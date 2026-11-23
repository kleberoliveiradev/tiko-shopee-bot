'use strict';
// Fonte de ofertas: lê canais PÚBLICOS do Telegram (página de pré-visualização t.me/s/<canal>)
// e extrai os links da Shopee postados lá. Nada é copiado além do link: o produto é buscado
// de novo na Shopee e a postagem é montada com o modelo e o link de afiliado do próprio robô.

const SHOPEE_HOST = /(^|\.)shopee\.com\.br$|(^|\.)shopee\.com$|^shope\.ee$|^shp\.ee$/i;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const webBase = () => process.env.TELEGRAM_WEB_URL || 'https://t.me';

// Aceita "@canal", "t.me/canal", "https://t.me/s/canal" ou "canal". Devolve null se não for um canal público.
function parseChannel(raw) {
  const s = String(raw || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?t\.me\//i, '')
    .replace(/^s\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0];
  return NAME_RE.test(s) ? s : null;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x2F;/gi, '/').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function shopeeLinks(html) {
  const out = [];
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    try {
      const u = new URL(decode(m[1]));
      if (u.protocol === 'https:' && SHOPEE_HOST.test(u.hostname)) out.push(u.href);
    } catch { /* href relativo ou inválido */ }
  }
  return out;
}

// Links da Shopee dentro de um texto solto (mensagem de WhatsApp). Só o link é aproveitado; o resto do texto é descartado.
function shopeeLinksFromText(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"'\u200e\u200f]+/gi)) {
    const raw = m[0].replace(/[.,;:!?)\]}*_~]+$/, '');
    try {
      const u = new URL(raw);
      if (SHOPEE_HOST.test(u.hostname)) { u.protocol = 'https:'; if (!out.includes(u.href)) out.push(u.href); }
    } catch { /* texto que parece link mas não é */ }
  }
  return out;
}

async function fetchPage(name, before) {
  const url = `${webBase()}/s/${name}${before ? `?before=${before}` : ''}`;
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoboOfertas/1.0)' }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(`não consegui acessar o canal (${e.cause?.code || e.message}).`);
  }
  if (res.status >= 300 && res.status < 400) throw new Error('esse canal não é público ou não permite pré-visualização na web. Só funciona com canais abertos (t.me/nomedocanal).');
  if (!res.ok) throw new Error(`o Telegram respondeu HTTP ${res.status}.`);
  const html = await res.text();
  if (!html.includes('tgme_widget_message')) throw new Error('não encontrei mensagens públicas nesse endereço. Confira se é um canal aberto.');
  return html;
}

// Devolve os links da Shopee do canal, do mais novo para o mais antigo: [{ post, url }].
async function fetchChannelLinks(name, { pages = 2 } = {}) {
  const found = [];
  const seen = new Set();
  let before = 0;
  for (let i = 0; i < pages; i++) {
    const html = await fetchPage(name, before);
    const marks = [...html.matchAll(/data-post="[^"/]+\/(\d+)"/g)].map((m) => ({ id: Number(m[1]), at: m.index }));
    if (!marks.length) break;
    const msgs = marks.map((mk, k) => ({ id: mk.id, links: shopeeLinks(html.slice(mk.at, k + 1 < marks.length ? marks[k + 1].at : html.length)) }));
    for (const msg of msgs.reverse()) {
      for (const url of msg.links) {
        if (seen.has(url)) continue;
        seen.add(url);
        found.push({ post: msg.id, url });
      }
    }
    const minId = Math.min(...marks.map((x) => x.id));
    if (minId <= 1 || minId === before) break;
    before = minId;
  }
  return found;
}

module.exports = { SHOPEE_HOST, parseChannel, fetchChannelLinks, shopeeLinksFromText };
