'use strict';
// Valida o passo a passo da página do cliente num DOM simulado (jsdom), contra o servidor com Shopee/Telegram falsos.
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { JSDOM } = require('/tmp/jsd/node_modules/jsdom');
const { startShopeeMock, startTelegramMock, APP_ID, SECRET, TG_TOKEN } = require('./mocks');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, label, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(100); } throw new Error('Timeout: ' + label); };
let n = 0; const ok = (m) => { n++; console.log('  ✓ ' + m); };

(async () => {
  const shopee = await startShopeeMock(); const tg = await startTelegramMock();
  Object.assign(process.env, { SHOPEE_API_URL: shopee.url, TELEGRAM_API_URL: tg.url, TELEGRAM_WEB_URL: tg.url, WA_DRIVER: path.join(__dirname, 'wa-fake.js'), WA_TIME_SCALE: '0',
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ui-')), ADMIN_PASSWORD: 'senha-super-123', PORT: '0', HOST: '127.0.0.1', QUIET: '1', SHOPEE_MIN_GAP_MS: '0', SHOPEE_RETRY_SCALE: '0', SCHEDULER_TICK_MS: '300', PLAN_CHARGE_NEW: '0', MANAGER_POLL_SEC: '0' });
  const app = await require('../server').start();
  const base = `http://127.0.0.1:${app.port}`;
  let cookie = '';
  const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); const sc = r.headers.get('set-cookie'); if (sc && /^sid=/.test(sc)) cookie = sc.split(';')[0]; return r.json(); };
  await call('POST', '/api/auth/login', { password: 'senha-super-123' });
  const created = await call('POST', '/api/bots', { name: 'UI Teste' });
  const token = (await call('GET', `/api/bots/${created.id}`)).bot.inviteToken;

  const errors = [];
  const dom = await JSDOM.fromURL(`${base}/afiliado/${token}`, { runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.scrollTo = () => {}; w.addEventListener('error', (e) => errors.push(e.message)); } });
  const { window } = dom; const d = window.document;
  for (const f of ['common.js', 'wa-ui.js', 'niche-ui.js', 'afiliado.js']) window.eval(fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'));
  const $ = (s) => d.querySelector(s);
  const visible = () => [...d.querySelectorAll('.wiz')].filter((s) => !s.hidden).map((s) => s.dataset.step);
  const type = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

  await waitFor(() => !$('#page').hidden, 'página carregada');
  assert.deepEqual(visible(), ['shopee']); ok('começa no passo 1 (Shopee)');
  assert.equal(d.querySelectorAll('#stepper li').length, 5); ok('barra de progresso com 5 passos');

  type('[data-path="shopee.appId"]', '999'); type('[data-path="shopee.secret"]', 'errado');
  $('#shopeeNext').click();
  await waitFor(() => !$('#shopeeMsg').hidden && /assin|credenc|Invalid|inv/i.test($('#shopeeMsg').textContent), 'erro de Shopee');
  assert.deepEqual(visible(), ['shopee']); ok('credencial errada: fica no passo e explica o erro');

  type('[data-path="shopee.appId"]', APP_ID); type('[data-path="shopee.secret"]', SECRET);
  $('#shopeeNext').click();
  await waitFor(() => visible()[0] === 'bot', 'avançou para o robô');
  ok('Shopee válida: avança sozinho para o passo do robô');
  assert.ok(!$('#manualBot').hidden && $('#autoCreate').hidden); ok('sem gerenciador: mostra o modo manual do token');

  type('[data-path="telegram.token"]', '1:xx'); $('#tokenNext').click();
  await waitFor(() => !$('#tokenMsg').hidden, 'erro de token');
  assert.deepEqual(visible(), ['bot']); ok('token inválido: mensagem de erro, continua no passo');

  type('[data-path="telegram.token"]', TG_TOKEN); $('#tokenNext').click();
  await waitFor(() => visible()[0] === 'dest', 'avançou para o destino');
  ok('token válido: avança para o destino');
  assert.ok(!$('#destChoose').hidden && $('#destGroup').hidden); ok('destino mostra a escolha grupo/privado');

  $('#choosePrivate').click();
  await waitFor(() => visible()[0] === 'niche', 'destino privado detectado').catch(async (e) => { console.log('DBG', JSON.stringify(await call('PUT','/api/c/'+token,{telegram:{chatId:'424242424'}})), JSON.stringify((await call('GET','/api/bots/'+created.id)).bot.telegram), visible(), $('#privNote').textContent, $('[data-path="telegram.chatId"]').value, errors); throw e; });
  assert.equal($('[data-path="telegram.chatId"]').value, '424242424'); ok('privado detectado sozinho e salvo (chat privado)');

  const pick = d.querySelector('#nicheMount button, #nicheMount .chip, #nicheMount label');
  assert.ok(pick); pick.click();
  $('#nicheNext').click();
  await waitFor(() => visible()[0] === 'go' || !$('#live').hidden, 'passo ligar');
  await waitFor(() => !$('#live').hidden, 'painel ao vivo', 8000).catch((e) => { console.log('DBG', visible(), $('#goTitle').textContent, $('#goList').textContent, $('#goMsg').textContent, errors); throw e; });
  assert.match($('#liveTitle').textContent, /ligado/); ok('robô ligado automaticamente e painel mostrado');
  const bot = (await call('GET', `/api/bots/${created.id}`)).bot;
  assert.equal(bot.enabled, true); assert.equal(String(bot.telegram.chatId), '424242424'); ok('servidor confirma: robô ligado e chat salvo');

  $('#pauseBtn').click(); await waitFor(() => /pausado/.test($('#liveTitle').textContent), 'pausa'); ok('botão Pausar funciona');
  $('#resumeBtn').click(); await waitFor(() => /ligado/.test($('#liveTitle').textContent), 'religa'); ok('botão Ligar de novo funciona');
  $('#editDest').click(); assert.deepEqual(visible(), ['dest']); ok('"Mudar" volta ao passo certo');
  assert.ok(!$('#waDetails').hidden && $('#waMount').textContent.includes('Link do seu grupo')); ok('cartão do WhatsApp (origem + seu grupo) está presente no painel');
  assert.deepEqual(errors, []); ok('nenhum erro de JavaScript na página');

  // ───── cliente que contratou só WhatsApp ─────
  const wcreated = await call('POST', '/api/bots', { name: 'UI So WA', channels: { telegram: false, whatsapp: true } });
  const wtoken = (await call('GET', `/api/bots/${wcreated.id}`)).bot.inviteToken;
  const werr = [];
  const wdom = await JSDOM.fromURL(`${base}/afiliado/${wtoken}`, { runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.scrollTo = () => {}; w.addEventListener('error', (e) => werr.push(e.message)); } });
  const W = wdom.window; const wd = W.document; const w$ = (s) => wd.querySelector(s);
  for (const f of ['common.js', 'wa-ui.js', 'niche-ui.js', 'afiliado.js']) W.eval(fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'));
  const wvisible = () => [...wd.querySelectorAll('.wiz')].filter((s) => !s.hidden).map((s) => s.dataset.step);
  const wtype = (sel, v) => { const el = w$(sel); el.value = v; el.dispatchEvent(new W.Event('input', { bubbles: true })); };
  await waitFor(() => !w$('#page').hidden && wvisible().length, 'página só-WhatsApp');
  assert.equal(wd.querySelectorAll('#stepper li').length, 4); assert.deepEqual([...wd.querySelectorAll('#stepper li')].map((l) => l.textContent.replace(/[✓\d]/g, '').trim()), ['Shopee', 'WhatsApp', 'Nicho', 'Ligar']); ok('só WhatsApp: 4 passos (Shopee, WhatsApp, Nicho, Ligar), sem passo de Telegram');
  wtype('[data-path="shopee.appId"]', APP_ID); wtype('[data-path="shopee.secret"]', SECRET);
  w$('#shopeeNext').click();
  await waitFor(() => wvisible()[0] === 'wa', 'passo WhatsApp'); ok('Shopee válida: vai direto ao passo do WhatsApp');
  assert.ok(w$('#waStepHost').contains(w$('#waMount')) && w$('#waMount').textContent.includes('Link do seu grupo')); ok('o cartão do WhatsApp aparece dentro do passo (origem + seu grupo)');
  w$('#waNext').click();
  assert.ok(!w$('#waStepMsg').hidden && /conecte o número/i.test(w$('#waStepMsg').textContent)); assert.deepEqual(wvisible(), ['wa']); ok('não deixa continuar sem conectar o número');
  assert.deepEqual(werr, []); ok('sem erro de JavaScript no fluxo só-WhatsApp');
  // Faixa do plano na página do afiliado
  const pb = await call('POST', '/api/bots', { name: 'Plano UI', plan: { managed: true } });
  const ptoken = (await call('GET', `/api/bots/${pb.id}`)).bot.inviteToken;
  const perr = [];
  const pdom = await JSDOM.fromURL(`${base}/afiliado/${ptoken}`, { runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.scrollTo = () => {}; w.addEventListener('error', (e) => perr.push(e.message)); } });
  for (const f of ['common.js', 'wa-ui.js', 'niche-ui.js', 'afiliado.js']) pdom.window.eval(fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'));
  const p$ = (s) => pdom.window.document.querySelector(s);
  await waitFor(() => !p$('#page').hidden && !p$('#planBar').hidden, 'faixa do plano');
  assert.match(p$('#planBar').textContent, /ainda não foi ativado/); ok('afiliado sem plano ativo vê o aviso "plano ainda não foi ativado"');
  await call('POST', `/api/bots/${pb.id}/plan`, { action: 'grant', days: 2 });
  await waitFor(async () => { const r = await fetch(`${base}/api/c/${ptoken}`).then((x) => x.json()); return r.bot.plan.state === 'expiring'; }, 'plano perto de vencer');
  const pdom2 = await JSDOM.fromURL(`${base}/afiliado/${ptoken}`, { runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.scrollTo = () => {}; w.addEventListener('error', (e) => perr.push(e.message)); } });
  for (const f of ['common.js', 'wa-ui.js', 'niche-ui.js', 'afiliado.js']) pdom2.window.eval(fs.readFileSync(path.join(__dirname, '../public', f), 'utf8'));
  await waitFor(() => !pdom2.window.document.querySelector('#planBar').hidden && /vence em 2 dias/.test(pdom2.window.document.querySelector('#planBar').textContent), 'faixa de vencimento próximo');
  ok('afiliado com plano perto de vencer vê quantos dias faltam');
  assert.deepEqual(perr, []); ok('sem erro de JavaScript na faixa do plano');
  console.log(`\n✅ ${n} verificações de interface passaram.`); process.exit(0);
})().catch((e) => { console.error('\n❌', e.stack || e); process.exit(1); });
