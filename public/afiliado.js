'use strict';
// Página do cliente em passo a passo: uma etapa por vez, a tela avança sozinha quando a etapa é concluída.
(async function () {
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const base = `/api/c/${encodeURIComponent(token)}`;
  const root = $('#page');

  // Quem contratou Telegram faz: Shopee → Robô → Destino → Nicho → Ligar (WhatsApp é opcional, no painel).
  // Quem contratou só WhatsApp faz: Shopee → WhatsApp → Nicho → Ligar.
  const ORDER_TG = ['shopee', 'bot', 'dest', 'niche', 'go'];
  const ORDER_WA = ['shopee', 'wa', 'niche', 'go'];
  const LABEL = { shopee: 'Shopee', bot: 'Robô', dest: 'Destino', wa: 'WhatsApp', niche: 'Nicho', go: 'Ligar' };
  let ORDER = ORDER_TG;
  let wa = null; // controle do cartão de WhatsApp
  let waStatus = null;
  const waOnly = () => B && B.channels && B.channels.telegram === false;

  let B = null; // dados públicos do robô (o que está salvo)
  let M = null; // estado do robô do Telegram
  let enabled = false;
  let neverRan = true;
  let view = null; // 'live' ou o id de um passo
  let nicheOk = false;
  let destMode = ''; // '', 'group' ou 'private'
  let linkReady = false;
  let detecting = false;
  let goRunning = false;

  const chatInput = () => $('[data-path="telegram.chatId"]', root);
  const tgLink = (u) => (typeof u === 'string' && u.startsWith('https://t.me/') ? u : '#');

  // Cada passo está "pronto" quando o dado dele já existe.
  const done = {
    shopee: () => !!(B.shopee.appId && B.shopee.secretSet),
    bot: () => !!(M && M.connected),
    dest: () => !!((M && M.chatId) || chatInput().value.trim()),
    niche: () => nicheOk || enabled || B.search.niches.length > 0 || B.search.keywords.length > 0,
    wa: () => !!(waStatus && waStatus.state === 'open' && (waStatus.dests || []).length),
    go: () => enabled || !neverRan,
  };

  /* ───────────── navegação ───────────── */
  function setView(v) {
    view = v;
    if (v === 'dest') destMode = '';
    placeWa();
    paint();
    if (v === 'bot') refreshManaged().then(checkBot).catch(() => {});
    if (v === 'go') runGo();
  }

  // O cartão de WhatsApp é um só: fica no passo "WhatsApp" (clientes só de WhatsApp) ou dentro do painel.
  function placeWa() {
    const m = $('#waMount');
    const host = view === 'wa' ? $('#waStepHost') : $('#waDetails');
    if (m.parentNode !== host) host.append(m);
  }

  function advance(from) {
    const next = ORDER.slice(ORDER.indexOf(from) + 1).find((id) => !done[id]()) || 'go';
    setView(next);
  }
  // Depois de concluir um passo: se o robô já rodou, volta ao painel; senão segue para o próximo.
  function finishStep(id) {
    if (done.go()) { setView('live'); return; }
    advance(id);
  }

  function paint() {
    const live = view === 'live';
    $('#wizard').hidden = live;
    $('#live').hidden = !live;
    if (live) { paintLive(); return; }
    $$('.wiz', root).forEach((s) => { s.hidden = s.dataset.step !== view; });
    const i = ORDER.indexOf(view);
    $$('.wiz[data-step="' + view + '"] .kicker', root).forEach((k) => { k.textContent = `Passo ${i + 1} de ${ORDER.length}`; });
    const bar = $('#stepper');
    bar.textContent = '';
    ORDER.forEach((id, n) => {
      const isDone = id !== view && done[id]();
      const li = h('li', { class: `${id === view ? 'cur' : ''} ${isDone ? 'ok' : ''}` });
      const dot = h('span', { class: 'dot2' }, isDone ? '✓' : String(n + 1));
      if (isDone) {
        li.append(h('button', { type: 'button', class: 'stepbtn', title: `Voltar para: ${LABEL[id]}`, onclick: () => setView(id) }, dot, h('span', {}, LABEL[id])));
      } else {
        li.append(dot, h('span', {}, LABEL[id]));
      }
      bar.append(li);
    });
    paintDest();
  }

  function paintDest() {
    $('#destChoose').hidden = destMode !== '';
    $('#destGroup').hidden = destMode !== 'group';
    $('#destPrivate').hidden = destMode !== 'private';
  }

  /* ───────────── dados ───────────── */
  async function save() {
    const r = await api('PUT', base, collect(root));
    B = r.bot;
    fill(root, r.bot);
    return r.bot;
  }

  async function refreshManaged() {
    const m = await api('GET', `${base}/managed`);
    M = m;
    if (m.chatId && !chatInput().value) chatInput().value = m.chatId;
    $('#autoCreate').hidden = !(m.available && !m.connected);
    $('#manualBot').hidden = !(!m.available && !m.connected);
    if (m.connected) $('[data-path="telegram.token"]', root).placeholder = 'já salvo (deixe vazio para manter)';
    if (m.available && !m.connected && !linkReady) {
      const s = await api('POST', `${base}/managed/start`);
      $('#createBot').href = tgLink(s.link);
      linkReady = true;
    }
    if (m.connected && m.botUsername) {
      $('#addGroup').href = tgLink(m.groupLink);
      $('#addChannel').href = tgLink(m.channelLink);
      $('#openBot').href = `https://t.me/${encodeURIComponent(m.botUsername)}`;
    }
    return m;
  }

  function checkBot() {
    if (view === 'bot' && M && M.connected) {
      toast('Robô criado! ✅');
      finishStep('bot');
    }
  }

  /* ───────────── passo: Shopee ───────────── */
  $('#shopeeNext').onclick = () => withBusy($('#shopeeNext'), async () => {
    const box = $('#shopeeMsg');
    const appId = $('[data-path="shopee.appId"]', root).value.trim();
    const sec = $('[data-path="shopee.secret"]', root).value.trim();
    if (!appId) return showMsg(box, 'Cole o AppID.', false);
    if (!sec && !B.shopee.secretSet) return showMsg(box, 'Cole o Secret.', false);
    try {
      showMsg(box, 'Conferindo a sua conta na Shopee…', true);
      await api('POST', `${base}/test-shopee`, collect(root));
      await save();
      box.hidden = true;
      toast('Conta da Shopee conectada! ✅');
      finishStep('shopee');
    } catch (e) { showMsg(box, e.message, false); }
  });

  /* ───────────── passo: robô (modo manual, sem criação automática) ───────────── */
  $('#tokenNext').onclick = () => withBusy($('#tokenNext'), async () => {
    const box = $('#tokenMsg');
    const tk = $('[data-path="telegram.token"]', root).value.trim();
    if (!tk) return showMsg(box, 'Cole o token que o @BotFather enviou.', false);
    try {
      await api('POST', `${base}/telegram-chats`, collect(root)); // confere o token no Telegram
      await save();
      await refreshManaged();
      box.hidden = true;
      if (!M.connected) throw new Error('Não consegui salvar o token. Tente de novo.');
      toast('Robô conectado! ✅');
      finishStep('bot');
    } catch (e) { showMsg(box, e.message, false); }
  });

  /* ───────────── passo: destino (grupo ou privado) ───────────── */
  async function setChat(id, label) {
    chatInput().value = id;
    if (M) M.chatId = id;
    await save();
    toast(label || 'Destino conectado! ✅');
    finishStep('dest');
  }

  async function detect(silent) {
    if (detecting || !destMode) return;
    detecting = true;
    try {
      const r = await api('POST', `${base}/auto-group`);
      const mode = destMode;
      if (mode === 'group' && r.selected) { await setChat(r.selected.id, `Grupo "${r.selected.title}" conectado! ✅`); return; }
      if (mode === 'private') {
        if (r.privateChat) { await setChat(r.privateChat.id, 'Pronto! As ofertas vão chegar na sua conversa com o robô. ✅'); return; }
        if (!silent) $('#privNote').textContent = 'Ainda não vi o seu "Iniciar". Abra o robô no Telegram, toque em Iniciar e clique de novo.';
        return;
      }
      const chips = $('#groupChips');
      chips.textContent = '';
      if (r.chats.length > 1) {
        $('#groupNote').textContent = 'Achei mais de um grupo. Toque no que você quer usar:';
        r.chats.forEach((c) => chips.append(h('button', { class: 'chip', type: 'button', onclick: () => setChat(c.id, `Grupo "${c.title}" conectado! ✅`) }, c.title)));
      } else if (!silent) {
        $('#groupNote').textContent = 'Ainda não vi o robô em nenhum grupo. Confira se criou o grupo (passo 1) e se confirmou "Adicionar como administrador" (passo 2). Depois clique de novo.';
      }
    } catch (e) {
      if (!silent) (destMode === 'private' ? $('#privNote') : $('#groupNote')).textContent = e.message;
    } finally { detecting = false; }
  }

  $('#chooseGroup').onclick = () => { destMode = 'group'; paintDest(); refreshManaged().catch(() => {}); detect(true); };
  $('#choosePrivate').onclick = () => { destMode = 'private'; paintDest(); refreshManaged().catch(() => {}); detect(true); };
  $('#backFromGroup').onclick = () => { destMode = ''; paintDest(); };
  $('#backFromPrivate').onclick = () => { destMode = ''; paintDest(); };
  $('#checkGroup').onclick = () => withBusy($('#checkGroup'), () => detect(false));
  $('#checkPrivate').onclick = () => withBusy($('#checkPrivate'), () => detect(false));

  /* ───────────── passo: WhatsApp (só para quem contratou apenas WhatsApp) ───────────── */
  $('#waNext').onclick = () => {
    const box = $('#waStepMsg');
    if (!waStatus || waStatus.state !== 'open') return showMsg(box, 'Primeiro conecte o número: gere o código e digite no celular.', false);
    if (!(waStatus.dests || []).length) return showMsg(box, 'Falta o seu grupo, onde o robô vai postar. Cole o link de convite dele acima.', false);
    box.hidden = true;
    finishStep('wa');
  };

  /* ───────────── passo: nicho ───────────── */
  $('#nicheNext').onclick = () => withBusy($('#nicheNext'), async () => {
    try {
      await save();
      nicheOk = true;
      finishStep('niche');
    } catch (e) { toast(e.message, 'err'); }
  });

  /* ───────────── passo: ligar ───────────── */
  const goSteps = () => ['Salvando as suas escolhas', 'Conferindo a sua conta da Shopee', waOnly() ? 'Conferindo o WhatsApp' : 'Conferindo o Telegram', 'Ligando o robô'];

  async function runGo() {
    if (goRunning) return;
    goRunning = true;
    const list = $('#goList');
    const retry = $('#goRetry');
    const box = $('#goMsg');
    retry.hidden = true;
    box.hidden = true;
    $('#goTitle').textContent = 'Tudo pronto! Estou ligando o seu robô…';
    list.textContent = '';
    const GO_STEPS = goSteps();
    const items = GO_STEPS.map((t) => { const li = h('li', { class: 'wait' }, t); list.append(li); return li; });
    let i = 0;
    try {
      for (; i < items.length; i++) {
        items[i].className = 'run';
        if (i === 0) await save();
        else if (i === 1) await api('POST', `${base}/test-shopee`, {});
        else if (i === 2) {
          if (waOnly()) {
            const s = await api('GET', `${base}/whatsapp`);
            if (s.state !== 'open') throw new Error('o WhatsApp não está conectado. Volte ao passo WhatsApp e gere o código.');
            if (!(s.dests || []).length) throw new Error('falta o seu grupo, onde o robô vai postar.');
          } else await api('POST', `${base}/test-telegram`, {});
        }
        else await api('POST', `${base}/enable`, { enabled: true });
        items[i].className = 'ok';
      }
      enabled = true;
      await poll();
      toast('Robô ligado! 🎉');
      setView('live');
    } catch (e) {
      if (items[i]) items[i].className = 'bad';
      if (e.status === 402) {
        $('#goTitle').textContent = 'Cadastro pronto! Falta ativar o plano';
        showMsg(box, 'Está tudo certo com o seu cadastro. Assim que o seu plano for ativado, o robô liga sozinho. Se não ligar, toque em "Tentar de novo".', false);
        retry.hidden = false;
        return;
      }
      $('#goTitle').textContent = 'Quase lá, mas algo precisa de ajuste';
      showMsg(box, `${GO_STEPS[i] || 'Erro'}: ${e.message} Toque em um passo acima (por exemplo Shopee, Robô, Destino ou WhatsApp) para corrigir, depois tente de novo.`, false);
      retry.hidden = false;
    } finally { goRunning = false; }
  }
  $('#goRetry').onclick = () => runGo();

  /* ───────────── painel (robô ligado) ───────────── */
  let planInactive = false;
  function paintPlan(p) {
    const bar = $('#planBar');
    planInactive = !!(p && p.managed && !p.active);
    if (!p || !p.managed) { bar.hidden = true; return; }
    const d = new Date(p.expiresAt).toLocaleDateString('pt-BR');
    bar.className = `note${p.state === 'active' ? ' info' : ''}`;
    bar.textContent = p.state === 'none' ? 'Seu plano ainda não foi ativado. Assim que o pagamento for confirmado, o robô começa a postar.'
      : p.state === 'expired' ? `⛔ Seu plano venceu em ${d}. O robô está parado. Para renovar, fale com quem te enviou o robô.`
        : p.state === 'expiring' ? `⏰ Seu plano vence em ${p.daysLeft} ${p.daysLeft === 1 ? 'dia' : 'dias'} (${d}). Para renovar, fale com quem te enviou o robô.`
          : `✅ Plano ativo até ${d}.`;
    bar.hidden = false;
  }

  function paintLive() {
    $('#liveTitle').textContent = planInactive ? '⛔ Seu robô está parado (plano)' : enabled ? '🟢 Seu robô está ligado' : '⏸ Seu robô está pausado';
    $('#pauseBtn').hidden = !enabled;
    $('#resumeBtn').hidden = enabled;
  }

  // Última oferta publicada em destaque, com foto (só aparece quando a Shopee mandou a imagem).
  function paintLastOffer(r) {
    const box = $('#lastOffer');
    box.textContent = '';
    box.hidden = !(r && safeImg(r.image));
    if (box.hidden) return;
    const ph = h('div', { class: 'ph', role: 'img', 'aria-label': r.name });
    ph.style.backgroundImage = `url("${encodeURI(r.image).replace(/"/g, '%22')}")`;
    if (r.discount) ph.append(h('span', { class: 'off' }, `-${Math.round(r.discount)}%`));
    box.append(h('div', { class: 'offer' }, ph, h('div', { class: 'bd' },
      h('p', { class: 'kicker', style: 'margin:0' }, 'Última oferta publicada'),
      h('h3', {}, r.name),
      r.price ? h('div', { class: 'price' }, brl(r.price)) : null,
      h('a', { href: r.link, target: '_blank', rel: 'noopener noreferrer' }, `Publicada em ${fmtDateTime(r.t)} ↗`))));
  }

  function render(a) {
    enabled = a.enabled;
    paintPlan(a.plan);
    neverRan = !(a.stats.posted > 0 || a.stats.lastError);
    $('#liveSub').textContent = a.running ? 'Postando agora…' : a.enabled && a.nextRunAt ? `Próxima rodada ${until(a.nextRunAt)}.` : 'As ofertas só saem quando o robô está ligado.';
    $('#sNext').textContent = a.enabled && a.nextRunAt ? until(a.nextRunAt) : '—';
    $('#sPosted').textContent = a.stats.posted;
    $('#sErr').textContent = a.stats.lastError ? a.stats.lastError.slice(0, 100) : 'nenhum';
    const rec = $('#recent');
    rec.textContent = '';
    a.recent.slice(0, 8).forEach((r) => rec.append(offerRow(r)));
    paintLastOffer(a.recent[0]);
    if (view === 'live') paintLive();
  }

  async function poll() {
    if (document.hidden) return;
    try { render(await api('GET', `${base}/activity`)); } catch { /* ignora */ }
  }

  $('#pauseBtn').onclick = () => withBusy($('#pauseBtn'), async () => {
    try { await api('POST', `${base}/enable`, { enabled: false }); await poll(); toast('Robô pausado.'); } catch (e) { toast(e.message, 'err'); }
  });
  $('#resumeBtn').onclick = () => withBusy($('#resumeBtn'), async () => {
    try { await api('POST', `${base}/enable`, { enabled: true }); await poll(); toast('Robô ligado! 🎉'); } catch (e) { toast(e.message, 'err'); }
  });
  $('#editShopee').onclick = () => setView('shopee');
  $('#editDest').onclick = () => setView('dest');
  $('#editWa').onclick = () => setView('wa');
  $('#editNiche').onclick = () => setView('niche');

  $('#saveSettings').onclick = () => withBusy($('#saveSettings'), async () => {
    try { await save(); showMsg($('#settingsMsg'), 'Ajustes salvos.', true); } catch (e) { showMsg($('#settingsMsg'), e.message, false); }
  });

  $('#testSource').onclick = () => withBusy($('#testSource'), async () => {
    try {
      const r = await api('POST', `${base}/test-source`, collect(root));
      const all = r.results.every((x) => x.ok);
      showMsg($('#srcMsg'), r.results.map((x) => (x.ok ? `@${x.channel}: ${x.links} link(s) da Shopee nas últimas mensagens${x.sample ? `. Exemplo: ${x.sample.slice(0, 60)}` : ''}` : `@${x.channel}: ${x.error}`)).join(' | '), all);
    } catch (e) { showMsg($('#srcMsg'), e.message, false); }
  });

  /* ───────────── vai e volta automático ───────────── */
  async function tick() {
    if (document.hidden) return;
    try {
      if (view === 'bot') { await refreshManaged(); checkBot(); }
      else if (view === 'dest' && destMode) await detect(true);
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  /* ───────────── início ───────────── */
  async function load() {
    try {
      const r = await api('GET', base);
      $('#page').hidden = false;
      initNiches($('#nicheMount'), r.niches);
      fill(root, r.bot);
      B = r.bot;
      $('#who').textContent = r.bot.name;
      $('#liveWho').textContent = r.bot.name;
      enabled = r.bot.enabled;
      render(r.activity);
      try { await refreshManaged(); } catch { M = { connected: false, available: false }; }
      ORDER = waOnly() ? ORDER_WA : ORDER_TG;
      if (waOnly()) {
        $('#editDest').hidden = true;
        $('#editWa').hidden = false;
        $('#waOpt').hidden = true;
        $('#waSummary').textContent = 'WhatsApp: o seu grupo e (opcional) grupo para clonar';
        $('#waDetails').open = false;
      }
      if (r.bot.channels.whatsapp === false) $('#waDetails').hidden = true;
      else {
        wa = initWhatsApp($('#waMount'), { base, onChange: (s) => { waStatus = s; if (view === 'wa') paint(); } });
        await wa.sync(r.bot);
      }
      const first = ORDER.find((id) => !done[id]());
      setView(first || 'live');
      setInterval(poll, 5000);
      setInterval(tick, 3000);
    } catch (e) {
      $('#dead').hidden = false;
      $('#deadMsg').textContent = e.message;
    }
  }

  load();
})();
