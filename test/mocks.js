'use strict';
// Servidores falsos da Shopee e do Telegram, só para testar o robô sem gastar API real.
const http = require('http');
const crypto = require('crypto');

const APP_ID = '1234567890';
const SECRET = 'segredo-de-teste-shopee';
const TG_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CHAT_ID = '-1001234567890';
const MGR_TOKEN = '987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

async function startShopeeMock() {
  const state = { calls: [], shortLinks: [], rejectField: null, failNext: 0, failMatch: '', counter: 0, badSignatures: 0 };
  const { server, url } = await listen(async (req, res) => {
    const body = await readBody(req);
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const m = /Credential=(\d+), Timestamp=(\d+), Signature=([0-9a-f]{64})/.exec(req.headers.authorization || '');
    const expected = m && crypto.createHash('sha256').update(`${m[1]}${m[2]}${body}${SECRET}`).digest('hex');
    if (!m || m[1] !== APP_ID || m[3] !== expected) {
      state.badSignatures++;
      return send({ errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] });
    }
    const { query } = JSON.parse(body);
    state.calls.push(query);
    // Simula a instabilidade real da Shopee: "10000 System Error" aleatório.
    const sysErr = () => send({ errors: [{ message: 'error [10000]: System Error', extensions: { code: 10000 } }] });
    if (state.failNext > 0) { state.failNext--; return sysErr(); }
    if (state.failMatch && query.includes(state.failMatch)) return sysErr();

    if (query.includes('generateShortLink')) {
      const origin = /originUrl: ("(?:[^"\\]|\\.)*")/.exec(query);
      const subs = /subIds: (\[[^\]]*\])/.exec(query);
      state.shortLinks.push({ originUrl: origin && JSON.parse(origin[1]), subIds: subs ? JSON.parse(subs[1]) : [] });
      return send({ data: { generateShortLink: { shortLink: `https://s.shopee.com.br/MOCK${++state.counter}` } } });
    }

    if (state.rejectField && query.includes(state.rejectField)) {
      return send({ errors: [{ message: `Cannot query field "${state.rejectField}" on type "ProductOfferV2".`, extensions: { code: 10010 } }] });
    }

    const arg = (name) => { const x = new RegExp(`${name}: ("(?:[^"\\\\]|\\\\.)*"|\\d+)`).exec(query); return x ? JSON.parse(x[1]) : null; };
    const itemId = arg('itemId');
    const page = Number(arg('page')) || 1;
    const keyword = arg('keyword') || '';
    const mk = (id, idx, discount, extra = {}) => ({
      itemId: String(id), shopId: String(5000 + idx), productName: `Produto ${keyword || 'geral'} ${id}`,
      productLink: `https://shopee.com.br/product/${5000 + idx}/${id}`, offerLink: `https://shope.ee/offer${id}`,
      imageUrl: `https://img.test/${id}.jpg`, priceMin: String(50 + idx * 10), priceMax: String(50 + idx * 10),
      priceDiscountRate: discount, sales: 100 + idx * 500, ratingStar: '4.8', commissionRate: '0.08', shopName: `Loja ${idx}`, ...extra,
    });
    if (itemId) return send({ data: { productOfferV2: { nodes: [mk(itemId, 99, 33)], pageInfo: { page: 1, limit: 1, hasNextPage: false } } } });
    if (page >= 4) return send({ data: { productOfferV2: { nodes: [], pageInfo: { page, limit: 50, hasNextPage: false } } } });

    const base = keyword.length * 1000 + page * 100;
    const discounts = [45, 40, 35, 30, 25, 22, 20, 15, 10, 5, 50, 0];
    const nodes = discounts.map((d, i) => mk(base + i, i, d, i === 10 ? { imageUrl: 'https://img.test/badimg.jpg' } : {}));
    nodes.push(mk(base + 20, 13, 60, { ratingStar: '3.0' })); // reprovado pela nota
    nodes.push(mk(base + 21, 14, 60, { sales: 3 })); // reprovado por vendas
    send({ data: { productOfferV2: { nodes, pageInfo: { page, limit: 50, hasNextPage: true } } } });
  });
  return { server, url, state };
}

async function startTelegramMock() {
  const state = { sent: [], methods: [], managerQueue: [], managerCanManage: true, webHits: [] };
  const { server, url } = await listen(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}');
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    // Pré-visualização web de canais públicos (t.me/s/<canal>), usada pela fonte de ofertas.
    const web = /^\/s\/(\w+)(?:\?before=(\d+))?$/.exec(req.url);
    if (web) {
      state.webHits.push(req.url);
      if (web[1] === 'canalprivado') { res.writeHead(302, { Location: '/canalprivado' }); return res.end(); }
      const post = (id, ...links) => `<div class="tgme_widget_message" data-post="${web[1]}/${id}"><div class="tgme_widget_message_text">${links.map((l) => `<a href="${l}">oferta</a>`).join(' ')}</div></div>`;
      const html = web[2]
        ? post(99, 'https://shopee.com.br/product/114/2004') + post(100, 'https://shopee.com.br/product/115/2005')
        : post(101, 'https://shopee.com.br/product/111/2001?utm=a&amp;x=1') + post(102, 'https://evil.example/x', 'https://shopee.com.br/product/112/2002') + post(103, 'https://shopee.com.br/product/111/2001?utm=a&amp;x=1', 'https://shopee.com.br/product/113/2003');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><body>${html}</body></html>`);
    }
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (m && m[1] === MGR_TOKEN) {
      // Bot gerenciador (Managed Bots): getMe, getUpdates (com offset) e getManagedBotToken.
      state.methods.push(`mgr:${m[2]}`);
      if (m[2] === 'getMe') return reply(200, { ok: true, result: { id: 2, username: 'GerenteBot', can_manage_bots: state.managerCanManage !== false } });
      if (m[2] === 'getUpdates') return reply(200, { ok: true, result: state.managerQueue.filter((u) => u.update_id >= (body.offset || 0)) });
      if (m[2] === 'getManagedBotToken') {
        if (body.user_id !== 777) return reply(400, { ok: false, error_code: 400, description: 'Bad Request: bot not found' });
        return reply(200, { ok: true, result: TG_TOKEN });
      }
      return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
    }
    if (!m || m[1] !== TG_TOKEN) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    const method = m[2];
    state.methods.push(method);
    if (method === 'getMe') return reply(200, { ok: true, result: { id: 1, username: 'mockbot' } });
    if (method === 'getUpdates') return reply(200, { ok: true, result: [{ update_id: 1, my_chat_member: { chat: { id: Number(CHAT_ID), title: 'Grupo Teste', type: 'supergroup' } } }, { update_id: 2, message: { chat: { id: 424242424, type: 'private' } } }] });
    if (method === 'sendMessage' || method === 'sendPhoto') {
      if (String(body.chat_id) !== CHAT_ID && String(body.chat_id) !== '424242424') return reply(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
      if (method === 'sendPhoto') {
        if (String(body.photo).includes('badimg')) return reply(400, { ok: false, error_code: 400, description: 'Bad Request: failed to get HTTP URL content' });
        if ((body.caption || '').length > 1024) return reply(400, { ok: false, error_code: 400, description: 'Bad Request: message caption is too long' });
      }
      state.sent.push({ method, text: body.caption || body.text || '', photo: body.photo, parse_mode: body.parse_mode });
      return reply(200, { ok: true, result: { message_id: state.sent.length } });
    }
    reply(404, { ok: false, error_code: 404, description: 'Not Found' });
  });
  return { server, url, state };
}

module.exports = { startShopeeMock, startTelegramMock, APP_ID, SECRET, TG_TOKEN, CHAT_ID, MGR_TOKEN };
