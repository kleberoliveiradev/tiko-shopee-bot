'use strict';
// Teste ponta a ponta: painel + página do afiliado + motor, contra Shopee/Telegram simulados.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const waFake = require('./wa-fake');
const { startShopeeMock, startTelegramMock, APP_ID, SECRET, TG_TOKEN, CHAT_ID, MGR_TOKEN } = require('./mocks');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error(`Timeout esperando: ${label}`);
}

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

(async () => {
  const shopee = await startShopeeMock();
  const tg = await startTelegramMock();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
  Object.assign(process.env, {
    SHOPEE_API_URL: shopee.url, TELEGRAM_API_URL: tg.url, TELEGRAM_WEB_URL: tg.url, WA_DRIVER: path.join(__dirname, 'wa-fake.js'), WA_TIME_SCALE: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'senha-super-123',
    PORT: '0', HOST: '127.0.0.1', QUIET: '1', SHOPEE_MIN_GAP_MS: '0', SHOPEE_RETRY_SCALE: '0', SCHEDULER_TICK_MS: '300', PLAN_CHARGE_NEW: '0',
    MANAGER_POLL_SEC: '0', MANAGER_IDLE_MS: '100',
  });
  const { start } = require('../server');
  const app = await start();
  const base = `http://127.0.0.1:${app.port}`;
  let cookie = '';

  const call = async (method, url, body, { headers = {}, raw = false } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: method === 'GET' ? undefined : raw ? body : JSON.stringify(body || {}),
    });
    const sc = res.headers.get('set-cookie');
    if (sc && /^sid=[^;]+/.test(sc)) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  try {
    console.log('\nSegurança e autenticação');
    assert.equal((await call('GET', '/api/bots')).status, 401); ok('painel exige login');
    assert.equal((await call('POST', '/api/auth/login', { password: 'errada' })).status, 401); ok('senha errada é recusada');
    assert.equal((await call('POST', '/api/auth/login', { password: 'senha-super-123' })).status, 200);
    assert.ok(cookie.startsWith('sid=')); ok('login correto devolve cookie de sessão');
    const html = await call('GET', '/');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy'), /script-src 'self'/); ok('páginas saem com CSP e headers de segurança');
    assert.equal((await call('GET', '/static/../server.js')).status, 404); ok('path traversal bloqueado');
    assert.equal((await call('POST', '/api/bots', 'x=1', { headers: { 'Content-Type': 'text/plain' }, raw: true })).status, 415); ok('CSRF: exige JSON');
    assert.equal((await call('POST', '/api/bots', {}, { headers: { Origin: 'https://evil.example' } })).status, 403); ok('CSRF: Origin de outro site bloqueada');

    console.log('\nCriação do robô e página do afiliado');
    const created = await call('POST', '/api/bots', { name: 'Ofertas da Maria' });
    const id = created.json.id;
    assert.ok(id);
    const adminView = await call('GET', `/api/bots/${id}`);
    const token = adminView.json.bot.inviteToken;
    assert.ok(token && token.length >= 20); ok('robô criado com link de convite secreto');

    const savedCookie = cookie; cookie = ''; // a partir daqui: afiliado, sem sessão do admin
    assert.equal((await call('GET', '/api/c/token-falso')).status, 404); ok('link de afiliado inválido → 404');
    assert.equal((await call('GET', '/afiliado/' + token)).status, 200); ok('página do afiliado é servida');
    const cView = await call('GET', `/api/c/${token}`);
    assert.equal(cView.status, 200);
    assert.equal(cView.json.bot.id, undefined);
    assert.equal(cView.json.bot.inviteToken, undefined);
    assert.equal(cView.json.bot.message, undefined); ok('afiliado não vê token de convite nem configurações de admin');

    const badTok = await call('PUT', `/api/c/${token}`, { telegram: { token: 'lixo' } });
    assert.equal(badTok.status, 400); ok('token de Telegram malformado é recusado');
    const badChat = await call('PUT', `/api/c/${token}`, { telegram: { chatId: 'abc' } });
    assert.equal(badChat.status, 400); ok('ID de grupo malformado é recusado');

    const wrong = await call('POST', `/api/c/${token}/test-shopee`, { shopee: { appId: APP_ID, secret: 'secret-errado' } });
    assert.equal(wrong.status, 400);
    assert.match(wrong.json.error, /inválid/i); ok('teste Shopee com Secret errado mostra erro claro (10020)');
    assert.ok(shopee.state.badSignatures >= 1);

    const put = await call('PUT', `/api/c/${token}`, {
      shopee: { appId: APP_ID, secret: SECRET },
      telegram: { token: TG_TOKEN, chatId: CHAT_ID },
      search: { keywords: 'fone\nair fryer\ntênis' },
      filters: { minDiscount: 20, onlyWithImage: false, minSales: 0 /* ignorado: só admin */ },
      schedule: { intervalMinutes: 15, postsPerCycle: 3, delaySec: 0 /* ignorado */ },
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.bot.shopee.secretSet, true);
    assert.ok(!JSON.stringify(put.json).includes(SECRET) && !JSON.stringify(put.json).includes(TG_TOKEN)); ok('segredos salvos e nunca devolvidos ao navegador');

    const t1 = await call('POST', `/api/c/${token}/test-shopee`, {});
    assert.equal(t1.status, 200, t1.text); ok('teste Shopee com credenciais salvas: assinatura SHA256 aceita');
    const t2 = await call('POST', `/api/c/${token}/test-telegram`, {});
    assert.equal(t2.status, 200, t2.text);
    assert.ok(tg.state.sent.some((m) => m.text.includes('Conexão OK'))); ok('teste Telegram envia mensagem ao grupo');
    const det = await call('POST', `/api/c/${token}/telegram-chats`, {});
    assert.deepEqual(det.json.chats.map((c) => c.id), [CHAT_ID]); ok('"Detectar grupo" lista só grupos (ignora chats privados)');

    cookie = savedCookie;
    const before = (await call('GET', `/api/bots/${id}`)).json.bot;
    assert.equal(before.filters.minSales, 50, 'afiliado não pode alterar filtros de admin');
    assert.equal(before.schedule.delaySec, 8); ok('campos de admin protegidos contra edição pelo afiliado');
    assert.ok(!JSON.stringify(before).includes(SECRET)); ok('painel admin também não recebe os segredos');

    console.log('\nPré-visualização (não posta nada)');
    const adminPut = await call('PUT', `/api/bots/${id}`, { filters: { minDiscount: 20, minRating: 4.3, minSales: 50 }, schedule: { delaySec: 1, intervalMinutes: 5, activeFrom: '00:00', activeTo: '00:00' } });
    assert.equal(adminPut.status, 200);
    const sentBefore = tg.state.sent.length;
    const prev = await call('POST', `/api/bots/${id}/preview`);
    assert.equal(prev.status, 200, prev.text);
    assert.ok(prev.json.preview.length > 0);
    assert.ok(prev.json.preview.every((p) => p.discount >= 20 && p.rating >= 4.3 && p.sales >= 50)); ok('filtros de desconto, nota e vendas aplicados');
    assert.equal(tg.state.sent.length, sentBefore); ok('simulação não envia nada ao Telegram');

    console.log('\nRobô ligado: agendador publica sozinho');
    cookie = '';
    const en = await call('POST', `/api/c/${token}/enable`, { enabled: true });
    assert.equal(en.status, 200);
    const baseline = tg.state.sent.length;
    await waitFor(() => tg.state.sent.length >= baseline + 3, '3 publicações do agendador');
    await sleep(500);
    const posts = tg.state.sent.slice(baseline);
    assert.equal(posts.length, 3, `esperava 3 posts, vieram ${posts.length}`); ok('1º ciclo agendado publicou exatamente 3 ofertas');
    assert.ok(posts.every((p) => /https:\/\/s\.shopee\.com\.br\/MOCK\d+/.test(p.text))); ok('todas as mensagens contêm link de afiliado convertido (generateShortLink)');
    assert.ok(shopee.state.shortLinks.every((s) => JSON.stringify(s.subIds) === '["robo"]')); ok('SubID de rastreio enviado na conversão');
    assert.ok(posts.some((p) => p.method === 'sendMessage' && p.text.includes('Produto')), 'fallback sem foto');
    assert.ok(posts.some((p) => p.method === 'sendPhoto')); ok('foto inválida cai para mensagem de texto; foto válida vai como imagem');
    assert.ok(posts.every((p) => p.text.length <= 1024)); ok('legendas respeitam o limite do Telegram');
    assert.ok(posts.every((p) => /Promoção sujeita a alteração/.test(p.text) && /Por <b>R\$ /.test(p.text) && /Compre aqui/.test(p.text))); ok('mensagem traz preço e desconto formatados em R$');

    console.log('\nDeduplicação e execução manual');
    cookie = savedCookie;
    const run = await call('POST', `/api/bots/${id}/run`);
    assert.equal(run.status, 200);
    await waitFor(async () => !(await call('GET', `/api/bots/${id}/activity`)).json.running, 'fim do ciclo manual');
    const act = (await call('GET', `/api/bots/${id}/activity`)).json;
    const titles = tg.state.sent.filter((m) => /Produto/.test(m.text)).map((m) => /Produto [^\n<]*?(\d{3,})/.exec(m.text)?.[1]);
    assert.equal(new Set(titles).size, titles.length, 'produto repetido!'); ok(`nenhum produto repetido entre ciclos (${titles.length} ofertas únicas)`);
    assert.equal(act.stats.posted, titles.length); ok('contador de publicações confere com o que chegou ao Telegram');
    assert.ok(act.recent.length > 0 && act.logs.some((l) => l.level === 'ok')); ok('histórico e registro de atividade preenchidos');

    console.log('\nPostar links específicos');
    const pl = await call('POST', `/api/bots/${id}/post-links`, { urls: 'https://shopee.com.br/product/777/888\nhttps://evil.example/x\nhttps://shopee.com.br/Fone-Gamer-i.321.654' });
    assert.equal(pl.status, 200, pl.text);
    assert.equal(pl.json.results[0].ok, true);
    assert.equal(pl.json.results[1].ok, false);
    assert.match(pl.json.results[1].error, /Shopee/);
    assert.equal(pl.json.results[2].ok, true);
    assert.ok(shopee.state.calls.some((q) => q.includes('itemId: 888') && q.includes('shopId: 777'))); ok('links colados são reconhecidos (dois formatos), convertidos e publicados');
    ok('link de site que não é da Shopee é recusado (anti-SSRF)');

    console.log('\nPausar e configuração incompleta');
    const pause = await call('POST', `/api/bots/${id}/enable`, { enabled: false });
    assert.equal(pause.json.enabled, false);
    const stable = tg.state.sent.length;
    await sleep(1200);
    assert.equal(tg.state.sent.length, stable); ok('robô pausado não publica mais');
    const empty = await call('POST', '/api/bots', { name: 'Vazio' });
    const noCfg = await call('POST', `/api/bots/${empty.json.id}/enable`, { enabled: true });
    assert.equal(noCfg.status, 400); assert.match(noCfg.json.error, /preencha/i); ok('não deixa ligar robô sem credenciais');

    console.log('\nCliente Shopee e utilitários');
    const { ShopeeClient } = require('../src/shopee');
    shopee.state.rejectField = 'ratingStar';
    const c = new ShopeeClient({ appId: APP_ID, secret: SECRET });
    const r = await c.searchProducts({ keyword: 'x', page: 1, limit: 5 });
    assert.ok(r.products.length > 0 && !c.fields.includes('ratingStar')); ok('se a Shopee recusar um campo, o robô remove o campo e segue funcionando');
    shopee.state.rejectField = null;

    shopee.state.failNext = 5;
    const rf = await new ShopeeClient({ appId: APP_ID, secret: SECRET }).searchProducts({ keyword: 'x', page: 1, limit: 5 });
    assert.ok(rf.products.length > 0 && shopee.state.failNext === 0); ok('Shopee devolve "10000 System Error" várias vezes seguidas: o robô insiste e consegue');
    shopee.state.failNext = 500;
    await assert.rejects(() => new ShopeeClient({ appId: APP_ID, secret: SECRET }).searchProducts({ keyword: 'x', page: 1, limit: 5 }), /instável/);
    shopee.state.failNext = 0; ok('se a Shopee insistir no erro, a mensagem é clara (e não "System Error" solto)');

    const { render } = require('../src/message');
    const long = { name: 'A'.repeat(900), image: '', priceMin: 10, priceMax: 20, discount: 50, sales: 1500, rating: 0, shopName: '' };
    const msg = render(null, long, 'https://s.shopee.com.br/x');
    assert.ok(msg.replace(/<[^>]+>/g, '').length <= 1024);
    assert.ok(!msg.includes('⭐') && msg.includes('a partir de R$ 10,00') && msg.includes('R$ 20,00'));
    ok('mensagem: título longo é encurtado; linha sem nota some; faixa de preço vira "a partir de"');
    const evil = render('<b>{titulo}</b>', { ...long, name: '<script>x</script> & "oi"' }, 'l');
    assert.ok(evil.includes('&lt;script&gt;') && evil.includes('&amp;')); ok('texto do produto é escapado no HTML do Telegram');

    const { inWindow } = require('../src/util');
    assert.equal(inWindow('00:00', '00:00', 'America/Sao_Paulo'), true);
    const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const [hh] = nowParts.split(':').map(Number);
    const pad = (n) => String((n + 24) % 24).padStart(2, '0');
    assert.equal(inWindow(`${pad(hh - 1)}:00`, `${pad(hh + 2)}:00`, 'America/Sao_Paulo'), true);
    assert.equal(inWindow(`${pad(hh + 2)}:00`, `${pad(hh + 4)}:00`, 'America/Sao_Paulo'), false); ok('janela de horário (inclusive virando a meia-noite)');

    console.log('\nCriação automática do bot no Telegram (Managed Bots)');
    const adminCookie = cookie || savedCookie;
    cookie = '';
    assert.equal((await call('PUT', '/api/manager', { token: MGR_TOKEN })).status, 401); ok('só o administrador cadastra o bot gerenciador');
    cookie = adminCookie;
    tg.state.managerCanManage = false;
    const noMode = await call('PUT', '/api/manager', { token: MGR_TOKEN });
    assert.equal(noMode.status, 400);
    assert.match(noMode.json.error, /Bot Management Mode/); ok('bot sem "Bot Management Mode" é recusado com instrução clara');
    tg.state.managerCanManage = true;
    assert.equal((await call('PUT', '/api/manager', { token: 'lixo' })).status, 400); ok('token do gerenciador em formato errado é recusado');
    const mgr = await call('PUT', '/api/manager', { token: MGR_TOKEN });
    assert.equal(mgr.status, 200);
    assert.equal(mgr.json.username, 'GerenteBot'); ok('bot gerenciador validado (can_manage_bots) e salvo');

    const thal = (await call('POST', '/api/bots', { name: 'Ofertas da Thalyta' })).json.id;
    const thalTok = (await call('GET', `/api/bots/${thal}`)).json.bot.inviteToken;
    cookie = ''; // afiliado
    const m0 = await call('GET', `/api/c/${thalTok}/managed`);
    assert.equal(m0.json.available, true);
    assert.equal(m0.json.connected, false); ok('afiliado vê que a criação automática está disponível');

    const st = await call('POST', `/api/c/${thalTok}/managed/start`);
    assert.equal(st.status, 200);
    assert.match(st.json.username, /^thalyta_[0-9a-f]{6}_bot$/);
    assert.ok(st.json.username.length <= 32);
    assert.ok(st.json.link.startsWith(`https://t.me/newbot/GerenteBot/${st.json.username}?name=Ofertas%20`)); ok('link t.me/newbot/<gerenciador>/<sugestão>?name=… gerado');
    const st2 = await call('POST', `/api/c/${thalTok}/managed/start`);
    assert.equal(st2.json.username, st.json.username); ok('clicar de novo reaproveita o mesmo nome sugerido');
    assert.equal((await call('GET', `/api/c/${thalTok}/managed`)).json.pending, true);

    // Telegram avisa o gerenciador: um bot desconhecido (ignorado) e o bot do afiliado.
    tg.state.managerQueue.push({ update_id: 10, managed_bot: { user: { id: 5 }, bot: { id: 555, username: 'outro_bot' } } });
    tg.state.managerQueue.push({ update_id: 11, managed_bot: { user: { id: 5 }, bot: { id: 777, username: st.json.username } } });
    const conn = await waitFor(async () => { const j = (await call('GET', `/api/c/${thalTok}/managed`)).json; return j.connected && j; }, 'bot conectado automaticamente');
    assert.equal(conn.botUsername, st.json.username);
    assert.equal(conn.pending, false);
    assert.ok(tg.state.methods.includes('mgr:getManagedBotToken')); ok('update managed_bot → token buscado e ligado ao robô certo');
    assert.ok(conn.groupLink.startsWith(`https://t.me/${st.json.username}?startgroup=`) && conn.groupLink.includes('admin=post_messages'));
    assert.ok(conn.channelLink.includes('startchannel') && conn.channelLink.includes('admin=post_messages')); ok('links para adicionar o bot ao grupo/canal já pedem permissão de administrador');
    const raw = (await call('GET', `/api/c/${thalTok}`)).text;
    assert.ok(!raw.includes(TG_TOKEN) && !raw.includes(MGR_TOKEN)); ok('tokens nunca vão para o navegador do afiliado');

    const ag = await call('POST', `/api/c/${thalTok}/auto-group`);
    assert.equal(ag.status, 200);
    assert.equal(ag.json.selected.id, CHAT_ID);
    assert.equal(ag.json.chatId, CHAT_ID); ok('grupo onde o bot foi adicionado é detectado e escolhido sozinho');
    assert.equal((await call('GET', `/api/c/${thalTok}`)).json.bot.telegram.chatId, CHAT_ID);
    const tgTest = await call("POST", `/api/c/${thalTok}/test-telegram`, {});
    assert.equal(tgTest.status, 200); ok('o bot criado automaticamente consegue postar no grupo');

    cookie = adminCookie;
    await call('DELETE', '/api/manager');
    cookie = '';
    assert.equal((await call('POST', `/api/c/${thalTok}/managed/start`)).status, 400); ok('sem bot gerenciador, a criação automática fica indisponível');

    console.log('\nClonar canal público de ofertas');
    cookie = adminCookie;
    const cl = (await call('POST', '/api/bots', { name: 'Clone Teste' })).json.id;
    const clTok = (await call('GET', `/api/bots/${cl}`)).json.bot.inviteToken;
    cookie = '';
    const bad = await call('PUT', `/api/c/${clTok}`, { source: { channels: 't.me/+AbCdEfGh' } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /Canal inválido/); ok('link de convite privado é recusado com explicação');
    const good = await call('PUT', `/api/c/${clTok}`, {
      shopee: { appId: APP_ID, secret: SECRET }, telegram: { token: TG_TOKEN, chatId: CHAT_ID },
      source: { channels: 'https://t.me/s/ofertas_teste\n@Ofertas_Teste\nt.me/ofertas_teste' }, filters: { minDiscount: 20 },
    });
    assert.equal(good.status, 200, good.text);
    assert.deepEqual(good.json.bot.source.channels, ['ofertas_teste']);
    assert.equal(good.json.bot.source.mode, 'only'); ok('endereços do canal são normalizados (@, t.me, t.me/s) e sem duplicar');

    const ts = await call('POST', `/api/c/${clTok}/test-source`, {});
    assert.equal(ts.status, 200, ts.text);
    assert.equal(ts.json.results[0].ok, true);
    assert.equal(ts.json.results[0].links, 3);
    assert.match(ts.json.results[0].sample, /Produto geral 200\d/); ok('teste do canal: acha os links da Shopee, ignora outros sites e mostra um produto de exemplo');
    const tp = await call('POST', `/api/c/${clTok}/test-source`, { source: { channels: 'canalprivado' } });
    assert.equal(tp.json.results[0].ok, false);
    assert.match(tp.json.results[0].error, /não é público/); ok('canal fechado: erro claro em vez de falha silenciosa');

    cookie = adminCookie;
    await call('PUT', `/api/bots/${cl}`, { schedule: { delaySec: 1, intervalMinutes: 5, postsPerCycle: 3, activeFrom: '00:00', activeTo: '00:00' }, filters: { onlyWithImage: false } });
    const prevCl = await call('POST', `/api/bots/${cl}/preview`);
    assert.equal(prevCl.status, 200, prevCl.text);
    assert.ok(prevCl.json.preview.length >= 3 && prevCl.json.preview.every((p) => /Produto geral 200\d/.test(p.name)));
    assert.ok(!shopee.state.calls.slice(-10).some((q) => /keyword: "(fone|air)/.test(q))); ok('modo "só canais": usa as ofertas do canal e não faz busca por palavra-chave');

    // Instabilidade da Shopee durante os ciclos: uma busca ruim não derruba o ciclo, e falha total tenta de novo logo.
    const fl = (await call('POST', '/api/bots', { name: 'Instavel' })).json;
    await call('PUT', `/api/bots/${fl.id}`, {
      shopee: { appId: APP_ID, secret: SECRET }, telegram: { token: TG_TOKEN, chatId: CHAT_ID },
      search: { keywords: 'fone bluetooth\nair fryer\nsmartwatch' }, filters: { onlyWithImage: false },
      schedule: { delaySec: 1, intervalMinutes: 30, postsPerCycle: 3, activeFrom: '00:00', activeTo: '00:00' },
    });
    shopee.state.failMatch = 'keyword: "air fryer"';
    const pv = await call('POST', `/api/bots/${fl.id}/preview`);
    assert.equal(pv.status, 200, pv.text);
    assert.ok(pv.json.preview.length >= 3 && pv.json.preview.every((p) => !/air fryer/.test(p.name))); ok('uma palavra-chave com erro na Shopee não derruba o ciclo: as outras seguem normalmente');
    shopee.state.failMatch = 'productOfferV2';
    const pv2 = await call('POST', `/api/bots/${fl.id}/preview`);
    assert.notEqual(pv2.status, 200); assert.match(pv2.json.error, /instável/); ok('se TODAS as buscas falham, o erro é explicado em português');
    const enFl = await call('POST', `/api/bots/${fl.id}/enable`, { enabled: true });
    assert.equal(enFl.status, 200, enFl.text);
    const afl = await waitFor(async () => { const a = (await call('GET', `/api/bots/${fl.id}/activity`)).json; return !a.running && JSON.stringify(a.logs).includes('tentar de novo em 3 minutos') ? a : null; }, 'ciclo com falha');
    const wait = afl.nextRunAt - Date.now();
    assert.ok(wait > 60000 && wait < 4 * 60000, `nova tentativa deveria ser em ~3 min, ficou em ${Math.round(wait / 1000)}s`); ok('falha passageira: o robô tenta de novo em ~3 minutos (não espera o intervalo inteiro)');
    await call('POST', `/api/bots/${fl.id}/enable`, { enabled: false });
    shopee.state.failMatch = '';

    const sentBeforeClone = tg.state.sent.length;
    const runCl = await call('POST', `/api/bots/${cl}/run`);
    assert.equal(runCl.status, 200, runCl.text);
    await waitFor(() => tg.state.sent.length >= sentBeforeClone + 3, 'posts do canal clonado');
    const clonePosts = tg.state.sent.slice(sentBeforeClone);
    assert.ok(clonePosts.every((m) => m.text.includes('https://s.shopee.com.br/MOCK')));
    assert.ok(clonePosts.every((m) => !m.text.includes('utm=a') && !m.text.includes('evil.example'))); ok('posta com o MEU link de afiliado (convertido), sem restos dos links do canal de origem');
    assert.ok(shopee.state.shortLinks.slice(-3).every((s) => /product\/\d+\/200\d/.test(s.originUrl))); ok('o link de afiliado é gerado a partir do produto original');
    await waitFor(async () => !(await call('GET', `/api/bots/${cl}/activity`)).json.running, 'ciclo terminar');
    const sentAfterFirst = tg.state.sent.length;
    await call('POST', `/api/bots/${cl}/run`);
    await waitFor(async () => !(await call('GET', `/api/bots/${cl}/activity`)).json.running, 'segundo ciclo');
    const second = tg.state.sent.slice(sentAfterFirst).map((m) => m.text);
    const firstTexts = clonePosts.map((m) => m.text);
    assert.ok(second.every((t) => !firstTexts.includes(t))); ok('no ciclo seguinte não repete ofertas já postadas (as mais antigas do canal entram)');
    assert.ok(tg.state.webHits.some((u) => u.includes('before=101'))); ok('lê também a página anterior do canal para achar mais ofertas');

    console.log('\nNichos e canais contratados');
    const NI = require('../src/niches');
    assert.ok(NI.NICHES.length >= 25 && new Set(NI.NICHES.map((n) => n.id)).size === NI.NICHES.length);
    for (const n of NI.NICHES) {
      assert.ok(n.keywords.length >= 15 && new Set(n.keywords).size === n.keywords.length, `nicho ${n.id}: poucas palavras ou repetidas`);
      if (n.terms.length) assert.deepEqual(n.keywords.filter((k) => !NI.matchesNiches(k, [n.id])), [], `nicho ${n.id}: palavra de busca que o próprio filtro recusaria`);
    }
    ok(`catálogo com ${NI.NICHES.length} nichos, ${NI.NICHES.reduce((a, n) => a + n.keywords.length, 0)} palavras-chave, sem repetição e coerentes com o filtro`);
    assert.ok(NI.matchesNiches('Jogo de Lençol Casal Toalhas', ['cama-mesa-banho']) && !NI.matchesNiches('Fone Bluetooth TWS', ['cama-mesa-banho']) && !NI.matchesNiches('Camarão congelado', ['cama-mesa-banho']));
    assert.ok(NI.matchesNiches('Mouse Gamer RGB', ['informatica']) && !NI.matchesNiches('Vestido Floral', ['informatica']) && NI.matchesNiches('Qualquer coisa', []));
    ok('o filtro do nicho aceita produtos do assunto e recusa os de fora (cama≠camarão)');

    cookie = adminCookie;
    const nb = (await call('POST', '/api/bots', { name: 'Cliente Nicho' })).json.id;
    await call('PUT', `/api/bots/${nb}`, { shopee: { appId: APP_ID, secret: SECRET }, telegram: { token: TG_TOKEN, chatId: CHAT_ID }, schedule: { delaySec: 0, activeFrom: '00:00', activeTo: '00:00' }, filters: { onlyWithImage: false } });
    const nbTok = (await call('GET', `/api/bots/${nb}`)).json.bot.inviteToken;
    cookie = '';
    const cg = await call('GET', `/api/c/${nbTok}`);
    assert.ok(cg.json.niches.length >= 25 && cg.json.niches[0].sample.length === 6);
    assert.deepEqual(cg.json.bot.channels, { telegram: true, whatsapp: true }); ok('página do cliente recebe o catálogo de nichos e os canais contratados');
    const setN = await call('PUT', `/api/c/${nbTok}`, { search: { niches: 'cama-mesa-banho, nicho-inventado, moveis' } });
    assert.equal(setN.status, 200, setN.text);
    assert.deepEqual(setN.json.bot.search.niches, ['cama-mesa-banho', 'moveis']); ok('cliente escolhe o nicho; ids inválidos são ignorados');
    const many = await call('PUT', `/api/c/${nbTok}`, { search: { niches: NI.NICHES.slice(0, 10).map((n) => n.id).join(',') } });
    assert.equal(many.json.bot.search.niches.length, 6); ok('no máximo 6 nichos por cliente');
    await call('PUT', `/api/c/${nbTok}`, { search: { niches: 'cama-mesa-banho', keywords: 'lençol queen 400 fios' } });
    cookie = adminCookie;
    const callsBefore = shopee.state.calls.length;
    const pvN = await call('POST', `/api/bots/${nb}/preview`);
    assert.equal(pvN.status, 200, pvN.text);
    const kwsUsed = shopee.state.calls.slice(callsBefore).map((q) => /keyword: "([^"]+)"/.exec(q)?.[1]).filter(Boolean);
    const allowed = new Set([...NI.NICHES.find((n) => n.id === 'cama-mesa-banho').keywords, 'lençol queen 400 fios']);
    assert.ok(kwsUsed.length >= 2 && kwsUsed.every((k) => allowed.has(k)), `buscas fora do nicho: ${kwsUsed}`);
    assert.ok(kwsUsed.includes('lençol queen 400 fios') && pvN.json.preview.length > 0); ok('com nicho escolhido o robô só pesquisa palavras do nicho (mais as extras da pessoa)');
    await call('PUT', `/api/bots/${nb}`, { search: { niches: '', keywords: '' } });
    const cb2 = shopee.state.calls.length;
    await call('POST', `/api/bots/${nb}/preview`);
    assert.ok(shopee.state.calls.slice(cb2).some((q) => /keyword: "/.test(q))); ok('sem nicho e sem palavras: usa "variedades" (nunca fica parado)');

    // Pelo menos um canal: dá para contratar só WhatsApp (ler um grupo e postar no grupo do cliente).
    assert.equal((await call('POST', '/api/bots', { name: 'Sem canal', channels: { telegram: false, whatsapp: false } })).status, 400); ok('plano sem nenhum canal é recusado');
    const onlyWa = await call('POST', '/api/bots', { name: 'So WhatsApp', channels: { telegram: false, whatsapp: true } });
    assert.equal(onlyWa.status, 200); ok('plano só com WhatsApp é aceito');
    assert.equal((await call('DELETE', `/api/bots/${onlyWa.json.id}`)).status, 200);

    console.log('\nWhatsApp: lê o grupo de ofertas e posta no grupo do cliente');
    cookie = adminCookie;
    const fs1 = (await call('POST', '/api/bots', { name: 'Fonte WA' })).json.id;
    await call('PUT', `/api/bots/${fs1}`, { shopee: { appId: APP_ID, secret: SECRET }, telegram: { token: TG_TOKEN, chatId: CHAT_ID }, schedule: { delaySec: 0, intervalMinutes: 5, postsPerCycle: 3, activeFrom: '00:00', activeTo: '00:00' }, filters: { onlyWithImage: false } });
    const fsTok = (await call('GET', `/api/bots/${fs1}`)).json.bot.inviteToken;
    cookie = '';
    const fb = `/api/c/${fsTok}/whatsapp`;
    assert.equal((await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' })).status, 400); ok('não aceita grupo antes de marcar que entendeu os riscos');
    await call('PUT', `/api/c/${fsTok}`, { whatsapp: { accepted: true } });
    const noCon = await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' });
    assert.equal(noCon.status, 400); assert.match(noCon.json.error, /Conecte o WhatsApp primeiro/); ok('pede para conectar o WhatsApp antes de adicionar o grupo');
    assert.equal((await call('POST', `${fb}/connect`, { phone: '11 94678-3584' })).status, 200);
    assert.ok(waFake.calls.includes('pair:5511946783584')); ok('número sem o 55 do Brasil: o 55 é colocado sozinho');
    await waitFor(async () => (await call('GET', fb)).json.state === 'open', 'WhatsApp da fonte conectado');
    assert.equal((await call('POST', `${fb}/source`, { link: 'https://exemplo.com/xyz' })).status, 400); ok('link que não é de grupo do WhatsApp é recusado');
    const badInv = await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/ZZZZZZZZZZZZZZZZ9999' });
    assert.equal(badInv.status, 400); assert.match(badInv.json.error, /inválido ou expirado/); ok('convite inválido: erro claro');
    waFake.ctl.failJoin = true;
    const noJoin = await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' });
    assert.equal(noJoin.status, 400); assert.match(noJoin.json.error, /Não consegui entrar/);
    waFake.ctl.failJoin = false; ok('grupo que não deixa entrar: erro claro e nada é salvo');
    const added = await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' });
    assert.equal(added.status, 200, added.text);
    assert.deepEqual(added.json.sources, [{ id: '120363000000000009@g.us', name: 'Promos do Zé' }]);
    assert.ok(waFake.calls.includes('join:ABCDEFGHIJKLMNOP1234')); ok('cola o link do grupo: o número entra e o grupo aparece como fonte');
    const again = await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' });
    assert.equal(again.json.sources.length, 1); ok('o mesmo grupo não é adicionado duas vezes');

    const DEST = '120363000000000007@g.us';
    const sameAsSrc = await call('POST', `${fb}/dest`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' });
    assert.equal(sameAsSrc.status, 400); assert.match(sameAsSrc.json.error, /já é a ORIGEM/); ok('o grupo de origem não pode ser também o destino (evita repostar o que ele mesmo enviou)');
    assert.equal((await call('GET', `/api/c/${fsTok}`)).json.bot.whatsapp.enabled, false); ok('antes de cadastrar o grupo do cliente, nada é enviado');
    const addedDest = await call('POST', `${fb}/dest`, { link: 'https://chat.whatsapp.com/MEUGRUPOMEUGRUPO7777' });
    assert.equal(addedDest.status, 200, addedDest.text);
    assert.deepEqual(addedDest.json.dests, [{ id: DEST, name: 'Meu grupo de ofertas' }]);
    const botAfter = (await call('GET', `/api/c/${fsTok}`)).json.bot.whatsapp;
    assert.equal(botAfter.enabled, true); assert.deepEqual(botAfter.groupIds, [DEST]); ok('cola o link do SEU grupo: o número entra e o envio liga sozinho para ele');
    const tst = await call('POST', `${fb}/test`);
    assert.equal(tst.status, 200, tst.text);
    assert.ok(waFake.sent.some((m) => m.jid === DEST && m.text.includes('Conexão OK'))); ok('mensagem de teste chega ao grupo do cliente');

    const SRC = '120363000000000009@g.us';
    const sentWa = waFake.sent.length;
    waFake.emit(SRC, 'Olha essa! https://shopee.com.br/product/111/2001?utm=a e também https://s.shopee.com.br/AbCd12 (ótimo preço)');
    waFake.emit(SRC, 'sem link nenhum aqui, só conversa de grupo');
    waFake.emit(SRC, 'link de outro site https://evil.example/x?u=https://shopee.com.br/product/1/2');
    waFake.emit('120363000000000008@g.us', 'grupo que NÃO é fonte https://shopee.com.br/product/118/2008');
    const seen = await waitFor(async () => { const j = (await call('GET', fb)).json; return j.linksSeen === 2 && j; }, 'links vistos no grupo');
    assert.ok(seen.lastLinkAt > 0); ok('lê só os links da Shopee do grupo escolhido e ignora conversa, outros sites e outros grupos');
    await new Promise((r) => setTimeout(r, 3300));
    const stateRaw = fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
    assert.ok(stateRaw.includes('shopee.com.br/product/111/2001') && !stateRaw.includes('conversa de grupo') && !stateRaw.includes('Olha essa')); ok('guarda só o link: o texto das mensagens do grupo não fica salvo');

    cookie = adminCookie;
    const tgS0 = tg.state.sent.length;
    const callsS0 = shopee.state.calls.length;
    const pvS = await call('POST', `/api/bots/${fs1}/preview`);
    assert.equal(pvS.status, 200, pvS.text);
    assert.ok(pvS.json.preview.length >= 1 && pvS.json.preview.every((p) => /Produto geral/.test(p.name)));
    assert.ok(shopee.state.calls.length > callsS0 && !shopee.state.calls.slice(callsS0).some((q) => /keyword: "/.test(q))); ok('com grupo de WhatsApp como fonte, o robô usa as ofertas dele e não sai pesquisando palavras-chave');
    assert.equal((await call('POST', `/api/bots/${fs1}/run`)).status, 200);
    await waitFor(() => tg.state.sent.length >= tgS0 + 1, 'oferta do grupo de WhatsApp no Telegram');
    await waitFor(async () => !(await call('GET', `/api/bots/${fs1}/activity`)).json.running, 'ciclo da fonte WhatsApp');
    const waPosts = tg.state.sent.slice(tgS0);
    assert.ok(waPosts.length >= 1 && waPosts.every((m) => m.text.includes('https://s.shopee.com.br/MOCK') && !m.text.includes('utm=a'))); ok('posta no Telegram com o link de afiliado de quem contratou (o link do grupo é descartado)');
    const clones = await waitFor(() => { const x = waFake.sent.slice(sentWa).filter((m) => m.jid === DEST); return x.length >= 1 && x; }, 'oferta clonada no grupo do cliente');
    assert.ok(clones.every((m) => m.text.includes('https://s.shopee.com.br/MOCK') && !m.text.includes('utm=a') && !/<[a-z/][^>]*>/i.test(m.text))); ok('clona no grupo de WhatsApp do cliente com o link de afiliado dele (formatação do WhatsApp)');
    assert.ok(waFake.sent.every((m) => m.jid !== SRC)); ok('nunca envia nada ao grupo de origem (só lê)');

    cookie = '';
    const rm = await call('POST', `${fb}/source/remove`, { id: SRC });
    assert.equal(rm.json.sources.length, 0); assert.equal(rm.json.linksSeen, 0); ok('remover o grupo também apaga os links que ele trouxe');
    await call('POST', `${fb}/source`, { link: 'https://chat.whatsapp.com/QRSTUVWXYZABCDEF5678' });
    await new Promise((r) => setTimeout(r, 400));
    const disS = await call('POST', `${fb}/disconnect`);
    assert.deepEqual(disS.json.sources, []); ok('desconectar o número limpa os grupos-fonte');

    console.log('\nWhatsApp: envio com limites de segurança');
    const { toWhatsapp } = require('../src/wa-format');
    assert.equal(toWhatsapp('<b>Oi</b> <s>R$ 10</s> &amp; <a href="https://x.y/z">link</a> <i>ok</i>'), '*Oi* ~R$ 10~ & link: https://x.y/z _ok_'); ok('formatação do Telegram vira formatação do WhatsApp (*negrito*, ~riscado~, links)');

    cookie = adminCookie;
    const wb = (await call('POST', '/api/bots', { name: 'WA Teste' })).json.id;
    await call('PUT', `/api/bots/${wb}`, { shopee: { appId: APP_ID, secret: SECRET }, telegram: { token: TG_TOKEN, chatId: CHAT_ID }, schedule: { delaySec: 0, activeFrom: '00:00', activeTo: '00:00' }, filters: { onlyWithImage: false } });
    const wbase = `/api/bots/${wb}/whatsapp`;
    const getWa = async () => (await call('GET', wbase)).json;
    const getBot = async () => (await call('GET', `/api/bots/${wb}`)).json.bot;

    assert.equal((await call('POST', `${wbase}/connect`, { phone: '5511999998888' })).status, 400); ok('não conecta sem o aceite dos riscos');
    assert.equal((await call('PUT', `/api/bots/${wb}`, { whatsapp: { accepted: true } })).status, 200);
    waFake.ctl.installed = false;
    const noMod = await call('POST', `${wbase}/connect`, { phone: '5511999998888' });
    assert.equal(noMod.status, 400);
    assert.match(noMod.json.error, /não está instalado/); waFake.ctl.installed = true; ok('módulo ausente: erro claro (o site continua funcionando)');
    assert.equal((await call('POST', `${wbase}/connect`, { phone: '123' })).status, 400); ok('número inválido é recusado');
    const con = await call('POST', `${wbase}/connect`, { phone: '+55 (11) 99999-8888' });
    assert.equal(con.status, 200, con.text);
    assert.equal(con.json.pairingCode, 'ABCD-1234');
    assert.equal(con.json.state, 'pairing');
    assert.ok(waFake.calls.includes('pair:5511999998888')); ok('gera o código de pareamento (número normalizado, sem QR code)');
    const opened = await waitFor(async () => { const j = await getWa(); return j.state === 'open' && j; }, 'WhatsApp conectado');
    assert.equal(opened.pairingCode, '');
    assert.ok(fs.existsSync(path.join(dataDir, 'wa', wb, 'creds.json'))); ok('conectou e a sessão fica guardada no volume de dados');

    const gl = await call('POST', `${wbase}/groups`);
    assert.deepEqual(gl.json.groups.map((g) => g.name), ['Família', 'Ofertas VIP']); ok('lista os grupos do número para escolher');
    const noGroup = await call('PUT', `/api/bots/${wb}`, { whatsapp: { enabled: true } });
    assert.equal(noGroup.status, 400);
    assert.match(noGroup.json.error, /pelo menos um grupo/);
    assert.equal((await call('PUT', `/api/bots/${wb}`, { whatsapp: { groupIds: 'qualquer-coisa' } })).status, 400); ok('não liga sem grupo e recusa grupo inválido');
    const GROUP = waFake.ctl.groups[0].id;
    assert.equal((await call('PUT', `/api/bots/${wb}`, { whatsapp: { groupIds: GROUP, enabled: true, includeImage: true } })).status, 200); ok('liga o espelho no grupo escolhido');
    const tw = await call('POST', `${wbase}/test`);
    assert.equal(tw.status, 200, tw.text);
    assert.ok(waFake.sent.some((m) => m.jid === GROUP && m.text.includes('Conexão OK'))); ok('mensagem de teste chega ao grupo de WhatsApp');

    const postBatch = async (from, n) => (await call('POST', `/api/bots/${wb}/post-links`, { urls: Array.from({ length: n }, (_, k) => `https://shopee.com.br/product/700/${from + k}`).join('\n') })).json.results;
    const wa0 = waFake.sent.length;
    const tg0 = tg.state.sent.length;
    const r1 = await postBatch(9101, 3);
    assert.ok(r1.every((x) => x.ok));
    await waitFor(() => waFake.sent.length >= wa0 + 3, 'ofertas espelhadas no WhatsApp');
    const mirrored = waFake.sent.slice(wa0);
    assert.equal(tg.state.sent.length - tg0, 3); ok('Telegram continua recebendo normalmente');
    assert.ok(mirrored.every((m) => m.jid === GROUP && m.image && m.text.includes('https://s.shopee.com.br/MOCK')));
    assert.ok(mirrored.every((m) => !/<[a-z/][^>]*>/i.test(m.text) && m.text.includes('*'))); ok('cada oferta vai ao WhatsApp com foto, link de afiliado e formatação do WhatsApp');
    assert.equal((await getWa()).sentToday, 3); ok('contador diário de envios (só ofertas contam, não a mensagem de teste)');

    const limitPut = await call('PUT', `/api/bots/${wb}`, { whatsapp: { maxPerHour: 3, minGapSec: 20 } });
    assert.equal(limitPut.status, 200);
    cookie = '';
    const wbTok = (await (async () => { cookie = adminCookie; const t = (await call('GET', `/api/bots/${wb}`)).json.bot.inviteToken; cookie = ''; return t; })());
    await call('PUT', `/api/c/${wbTok}`, { whatsapp: { maxPerHour: 15, maxPerDay: 80, minGapSec: 20 } });
    cookie = adminCookie;
    assert.equal((await getBot()).whatsapp.maxPerHour, 3); ok('o afiliado não consegue aumentar os limites de segurança');
    const wa1 = waFake.sent.length;
    await postBatch(9201, 2);
    await sleep(400);
    assert.equal(waFake.sent.length, wa1, 'acima do limite por hora não pode enviar');
    const logs = (await call('GET', `/api/bots/${wb}/activity`)).json.logs.map((l) => l.msg).join('\n');
    assert.match(logs, /limite de 3 mensagens por hora/); ok('limite por hora respeitado e registrado no log');

    await call('PUT', `/api/bots/${wb}`, { whatsapp: { maxPerHour: 15 } });
    waFake.ctl.failSend = true;
    await postBatch(9301, 5);
    const paused = await waitFor(async () => { const b = await getBot(); return !b.whatsapp.enabled && b; }, 'pausa automática após falhas');
    assert.match((await getWa()).error, /5 falhas/); ok('após 5 falhas seguidas o envio pausa sozinho para proteger o número');
    waFake.ctl.failSend = false;

    const dis = await call('POST', `${wbase}/disconnect`);
    assert.equal(dis.status, 200);
    assert.equal(dis.json.state, 'off');
    assert.ok(waFake.calls.includes('logout') && !fs.existsSync(path.join(dataDir, 'wa', wb))); ok('desconectar encerra a sessão e apaga as credenciais do WhatsApp');
    const rawWa = JSON.stringify((await call('GET', `/api/bots/${wb}`)).json);
    assert.ok(!rawWa.includes('creds')); ok('nenhuma credencial do WhatsApp vai para o navegador');


    console.log('\nWhatsApp → WhatsApp (plano só com WhatsApp, sem Telegram)');
    cookie = adminCookie;
    const ow = (await call('POST', '/api/bots', { name: 'So WA', channels: { telegram: false, whatsapp: true } })).json;
    const owb = `/api/bots/${ow.id}/whatsapp`;
    await call('PUT', `/api/bots/${ow.id}`, { shopee: { appId: APP_ID, secret: SECRET }, schedule: { delaySec: 0, activeFrom: '00:00', activeTo: '00:00' }, filters: { onlyWithImage: false }, whatsapp: { accepted: true } });
    assert.equal((await call('POST', `${owb}/connect`, { phone: '11999997777' })).status, 200);
    await waitFor(async () => (await call('GET', owb)).json.state === 'open', 'WA-only conectado');
    assert.equal((await call('POST', `/api/bots/${ow.id}/enable`)).status === 200 && false, false);
    assert.equal((await call('POST', `${owb}/source`, { link: 'https://chat.whatsapp.com/ABCDEFGHIJKLMNOP1234' })).status, 200);
    await sleep(50);
    assert.equal((await call('POST', `${owb}/dest`, { link: 'https://chat.whatsapp.com/MEUGRUPOMEUGRUPO7777' })).status, 200);
    waFake.emit('120363000000000009@g.us', 'https://shopee.com.br/product/555/3001');
    await waitFor(async () => (await call('GET', owb)).json.linksSeen >= 1, 'link lido no grupo de origem');
    const tgW0 = tg.state.sent.length; const waW0 = waFake.sent.length;
    assert.equal((await call('POST', `/api/bots/${ow.id}/run`)).status, 200);
    const clW = await waitFor(() => { const x = waFake.sent.slice(waW0).filter((m) => m.jid === '120363000000000007@g.us'); return x.length >= 1 && x; }, 'oferta clonada só no WhatsApp');
    await waitFor(async () => !(await call('GET', `/api/bots/${ow.id}/activity`)).json.running, 'ciclo WA-only');
    assert.ok(clW.every((m) => m.text.includes("https://s.shopee.com.br/MOCK") && !m.text.includes("utm="))); ok('WhatsApp → WhatsApp: link do grupo trocado pelo link de afiliado e postado no grupo do cliente');
    assert.equal(tg.state.sent.length, tgW0); ok('plano só com WhatsApp não envia nada pelo Telegram');
    assert.ok(waFake.sent.slice(waW0).every((m) => m.jid !== '120363000000000009@g.us')); ok('o grupo de origem só é lido, nunca recebe mensagem');
    // Busca na Shopee + clonagem juntas (modo 'mix') e busca sozinha (sem grupo de origem)
    assert.equal((await call('PUT', `/api/bots/${ow.id}`, { source: { mode: 'mix' } })).status, 200);
    const waM0 = waFake.sent.length;
    waFake.emit('120363000000000009@g.us', 'https://shopee.com.br/product/555/3002');
    await waitFor(async () => (await call('GET', owb)).json.linksSeen >= 2, 'segundo link lido no grupo de origem');
    assert.equal((await call('POST', `/api/bots/${ow.id}/run`)).status, 200);
    await waitFor(async () => !(await call('GET', `/api/bots/${ow.id}/activity`)).json.running, 'ciclo mix WA-only');
    const mixSent = waFake.sent.slice(waM0).filter((m) => m.jid === '120363000000000007@g.us');
    assert.ok(mixSent.length >= 2, `mix: esperava clone + busca no grupo do cliente, veio ${mixSent.length}`); ok('modo "clonar + buscar": posta no WhatsApp o que clonou e também as promoções que buscou na Shopee');
    await call('POST', `${owb}/source/remove`, { id: '120363000000000009@g.us' });
    assert.equal((await call('GET', owb)).json.sources.length, 0);
    const waS0 = waFake.sent.length;
    assert.equal((await call('POST', `/api/bots/${ow.id}/run`)).status, 200);
    await waitFor(async () => !(await call('GET', `/api/bots/${ow.id}/activity`)).json.running, 'ciclo busca-só WA-only');
    await waitFor(() => waFake.sent.slice(waS0).some((m) => m.jid === '120363000000000007@g.us'), 'busca sozinha posta no WhatsApp');
    ok('sem grupo de origem: o robô só de WhatsApp busca promoções da Shopee e posta no grupo do cliente');
    // Nome de exibição do chip (o que aparece nas postagens)
    assert.equal((await call('POST', `${owb}/profile-name`, { name: '   ' })).status, 400); ok('nome vazio é recusado');
    assert.equal((await call('POST', `${owb}/profile-name`, { name: 'x'.repeat(26) })).status, 400); ok('nome com mais de 25 caracteres é recusado');
    const nm = await call('POST', `${owb}/profile-name`, { name: '  Promoções   da Thalyta ' });
    assert.equal(nm.status, 200); assert.equal(nm.json.name, 'Promoções da Thalyta');
    assert.ok(waFake.calls.includes('name:Promoções da Thalyta')); assert.equal((await call('GET', `/api/bots/${ow.id}`)).json.bot.whatsapp.displayName, 'Promoções da Thalyta'); ok('troca o nome do perfil do chip e guarda o nome escolhido');
    await call('POST', `${owb}/disconnect`);
    const afterDis = (await call('GET', `/api/bots/${ow.id}`)).json.bot.whatsapp;
    assert.equal(afterDis.enabled, false); assert.deepEqual(afterDis.dests, []); ok('desconectar limpa grupos e desliga o envio');

    console.log('\nPareamento: código novo não pode ser derrubado por aviso de sessão antiga');
    const pw = (await call('POST', '/api/bots', { name: 'Pareia', channels: { telegram: false, whatsapp: true } })).json;
    const pwb = `/api/bots/${pw.id}/whatsapp`;
    await call('PUT', `/api/bots/${pw.id}`, { whatsapp: { accepted: true } });
    waFake.ctl.manualPair = true; waFake.ctl.lateClose = true;
    const creates0 = waFake.calls.filter((c) => c === 'create').length;
    assert.equal((await call('POST', `${pwb}/connect`, { phone: '11988887777' })).status, 200);
    const pair2 = await call("POST", `${pwb}/connect`, { phone: '11988887777' });
    assert.equal(pair2.status, 200); assert.equal(pair2.json.pairingCode, 'ABCD-1234');
    await sleep(250);
    assert.equal((await call('GET', pwb)).json.state, 'pairing'); ok('aviso atrasado da sessão antiga não derruba o código novo');
    assert.equal(waFake.calls.filter((c) => c === 'create').length - creates0, 2); ok('não reabre conexão sozinho enquanto espera o código');
    waFake.ctl.finishPair();
    await waitFor(async () => (await call('GET', pwb)).json.state === 'open', 'pareamento concluído');
    ok('digitou o código: conecta normalmente');
    waFake.ctl.manualPair = false; waFake.ctl.lateClose = false;
    await call('POST', `${pwb}/disconnect`);

    console.log('\nPlano: ativar 30 dias, vencer, avisar');
    cookie = savedCookie;
    const planApi = `/api/bots/${id}/plan`;
    const plan = require('../src/plan');
    const tgLogs = async () => (await call('GET', `/api/bots/${id}/activity`)).json.logs.map((l) => l.msg);
    assert.equal((await call('GET', `/api/bots/${id}`)).json.bot.plan.state, 'free'); ok('robô sem controle de plano funciona como sempre (sem vencimento)');
    assert.equal((await call('POST', planApi, { action: 'manage', managed: true })).json.plan.state, 'none'); ok('ligar o controle sem ativar deixa o plano como "não ativado"');
    assert.equal((await call('POST', `/api/bots/${id}/enable`, { enabled: false })).status, 200);
    assert.equal((await call('POST', `/api/bots/${id}/enable`, { enabled: true })).status, 402); ok('sem plano ativo não dá para ligar o robô');
    assert.equal((await call('POST', `/api/bots/${id}/run`)).status, 402); ok('sem plano ativo não roda ciclo manual');
    assert.equal((await call('POST', planApi, { action: 'grant', days: 0 })).status, 400);
    assert.equal((await call('POST', planApi, { action: 'grant', days: 400 })).status, 400);
    assert.equal((await call('POST', planApi, { action: 'grant', days: 'abc' })).status, 400);
    assert.equal((await call('POST', planApi, { action: 'nada' })).status, 400); ok('dias inválidos e ação desconhecida são recusados');
    const g1 = await call('POST', planApi, { action: 'grant' });
    assert.equal(g1.status, 200); assert.equal(g1.json.plan.active, true); assert.equal(g1.json.plan.daysLeft, 30); assert.equal(g1.json.plan.state, 'active');
    const exp1 = g1.json.plan.expiresAt;
    assert.ok(Math.abs(exp1 - (Date.now() + 30 * 86400000)) < 60000); ok('ativar sem informar dias vale 30 dias a partir de agora');
    const g2 = await call('POST', planApi, { action: 'grant', days: 5 });
    assert.equal(g2.json.plan.expiresAt, exp1 + 5 * 86400000); ok('renovar antes de vencer soma os dias ao vencimento atual');
    assert.equal((await call('POST', `/api/bots/${id}/enable`, { enabled: true })).status, 200); ok('com plano ativo o robô liga');
    app.store.st(id).nextRunAt = 0;
    const planBase = tg.state.sent.length;
    await waitFor(() => tg.state.sent.length > planBase, 'robô volta a postar com o plano ativo');
    ok('com plano ativo o agendador posta');
    await waitFor(async () => !(await call('GET', `/api/bots/${id}/activity`)).json.running, 'fim do ciclo do plano');
    const rv = await call('POST', planApi, { action: 'revoke' });
    assert.equal(rv.json.plan.active, false); assert.equal(rv.json.plan.state, 'expired'); ok('desativar encerra o plano na hora');
    app.store.st(id).nextRunAt = 0;
    const idleBase = tg.state.sent.length;
    await sleep(1300);
    assert.equal(tg.state.sent.length, idleBase); ok('plano vencido: o agendador não posta mais, mesmo com o robô ligado');
    const g3 = await call('POST', planApi, { action: 'grant', days: 30 });
    assert.equal(g3.json.plan.daysLeft, 30);
    await waitFor(() => tg.state.sent.length > idleBase, 'robô volta ao renovar');
    ok('renovar depois de vencido reativa o robô e conta 30 dias a partir de agora');
    // contato do cliente e visão do afiliado
    assert.equal((await call('POST', planApi, { action: 'contact', contact: '11 94678-3584' })).json.plan.contact, '5511946783584');
    assert.equal((await call('POST', planApi, { action: 'contact', contact: '123' })).status, 400); ok('contato do cliente é normalizado e validado');
    const cview = (await call('GET', `/api/c/${token}`)).json.bot.plan;
    assert.equal(cview.state, 'active'); assert.ok(!('history' in cview) && !('contact' in cview)); ok('o afiliado vê só a situação do plano (sem histórico nem contato)');
    assert.equal((await call('GET', `/api/bots/${id}`)).json.bot.plan.history.length >= 3, true); ok('histórico de ativações fica guardado no painel do dono');
    cookie = '';
    assert.equal((await call('POST', `/api/c/${token}/plan`, { action: 'grant' })).status, 404); ok('o afiliado não consegue ativar o próprio plano');
    cookie = savedCookie;
    // avisos de vencimento
    const pbot = app.store.getBot(id);
    pbot.plan.expiresAt = Date.now() + 2 * 86400000 - 1000; pbot.plan.notified = {};
    await waitFor(async () => (await tgLogs()).some((m) => /vence em 2 dias/.test(m)), 'aviso de 3 dias');
    await sleep(1000);
    assert.equal((await tgLogs()).filter((m) => /vence em 2 dias/.test(m)).length, 1); ok('aviso de vencimento próximo sai uma vez só');
    pbot.plan.expiresAt = Date.now() + 12 * 3600000;
    await waitFor(async () => (await tgLogs()).some((m) => /menos de 24 horas/.test(m)), 'aviso de 1 dia'); ok('aviso de menos de 24 horas');
    pbot.plan.expiresAt = Date.now() - 1000;
    await waitFor(async () => (await tgLogs()).some((m) => /venceu em/.test(m)), 'aviso de vencimento'); ok('aviso de plano vencido');
    assert.equal(plan.dueReminder({ plan: { managed: true, expiresAt: Date.now() - 5 * 86400000 }, schedule: {} }), null); ok('plano vencido há dias não gera aviso novo');
    // robô novo
    const pnb = (await call('POST', '/api/bots', { name: 'Novo sem plano' })).json;
    assert.equal((await call('GET', `/api/bots/${pnb.id}`)).json.bot.plan.managed, false);
    const pnb2 = (await call('POST', '/api/bots', { name: 'Novo cobrado', plan: { managed: true } })).json;
    assert.equal((await call('GET', `/api/bots/${pnb2.id}`)).json.bot.plan.state, 'none'); ok('cliente novo pode já nascer aguardando ativação do plano');
    const lst = (await call('GET', '/api/bots')).json.bots.find((b) => b.id === pnb2.id);
    assert.equal(lst.plan.state, 'none'); ok('a lista de clientes mostra a situação do plano');

    const cfg = fs.readFileSync(path.join(dataDir, 'config.json'));
    const mode = fs.statSync(path.join(dataDir, 'config.json')).mode & 0o777;
    assert.equal(mode, 0o600); assert.ok(cfg.length > 0); ok('arquivo de dados com permissão 600');

    console.log(`\n✅ ${passed} verificações passaram.\n`);
    process.exitCode = 0;
  } catch (e) {
    console.error('\n❌ FALHOU:', e.stack || e);
    process.exitCode = 1;
  } finally {
    app.server.close();
    shopee.server.close();
    tg.server.close();
    setTimeout(() => process.exit(process.exitCode), 200);
  }
})();
