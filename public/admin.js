'use strict';
(async function () {
  let bots = [];
  let cur = null; // id do robô aberto
  let data = null; // visão pública do robô
  let defaultTpl = '';
  let poll = null;
  let tab = 'conn';

  /* ───── Autenticação ───── */
  async function boot() {
    const st = await api('GET', '/api/auth/status');
    if (st.loggedIn) return enterApp();
    showAuth(st);
  }

  function showAuth(st) {
    $('#app').hidden = true;
    $('#auth').hidden = false;
    const setup = !st.configured;
    $('#authTitle').textContent = setup ? 'Criar senha do painel' : 'Entrar';
    $('#authSub').textContent = setup ? 'Primeiro acesso: use o código que apareceu no terminal/logs do servidor.' : 'Painel do administrador.';
    $('#codeWrap').hidden = !setup;
    $('#authPass').autocomplete = setup ? 'new-password' : 'current-password';
    $('#authBtn').textContent = setup ? 'Criar senha e entrar' : 'Entrar';
    $('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#authErr');
      err.hidden = true;
      try {
        await api('POST', setup ? '/api/auth/setup' : '/api/auth/login', { password: $('#authPass').value, code: $('#authCode').value.trim() });
        enterApp();
      } catch (ex) {
        showMsg(err, ex.message, false);
      }
    };
  }

  async function enterApp() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    await loadBots();
    loadManager();
    if (bots.length) openBot(bots[0].id);
  }

  /* ───── Bot gerenciador (criação automática dos bots dos afiliados) ───── */
  async function loadManager(open) {
    try {
      const m = await api('GET', '/api/manager');
      $('#mgrStatus').textContent = m.configured ? `🤖 Criação automática: ativa (@${m.username})` : '🤖 Criação automática: desativada';
      $('#mgrRemove').hidden = !m.configured;
      $('#mgrToken').placeholder = m.configured ? 'Colar outro token para trocar' : 'Token do bot gerenciador';
      if (open !== undefined) $('#mgrBox').open = open;
      else if (!m.configured) $('#mgrBox').open = true;
    } catch { /* ignora */ }
  }
  $('#mgrSave').onclick = () => withBusy($('#mgrSave'), async () => {
    try {
      const r = await api('PUT', '/api/manager', { token: $('#mgrToken').value });
      $('#mgrToken').value = '';
      showMsg($('#mgrMsg'), `Pronto! Os afiliados já podem criar o bot pela página deles (gerente: @${r.username}).`, true);
      loadManager(true);
    } catch (e) { showMsg($('#mgrMsg'), e.message, false); }
  });
  $('#mgrRemove').onclick = async () => {
    if (!(await ask({ title: 'Desativar a criação automática?', text: 'Os bots que já foram criados continuam funcionando. Novos afiliados voltam a colar o token manualmente.', okLabel: 'Desativar', danger: true }))) return;
    try { await api('DELETE', '/api/manager'); showMsg($('#mgrMsg'), 'Criação automática desativada.', true); loadManager(true); } catch (e) { showMsg($('#mgrMsg'), e.message, false); }
  };

  $('#logout').onclick = async () => {
    await api('POST', '/api/auth/logout');
    location.reload();
  };

  /* ───── Lista de robôs ───── */
  async function loadBots() {
    bots = (await api('GET', '/api/bots')).bots;
    const ul = $('#botList');
    ul.textContent = '';
    bots.forEach((b) => {
      ul.append(h('li', { class: 'botrow' },
        h('button', { class: b.id === cur ? 'on' : '', onclick: () => openBot(b.id) },
          h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, b.name),
          planTag(b.plan),
          h('i', { class: `dot ${b.running ? 'run' : b.enabled ? 'on' : ''}`, title: b.running ? 'executando' : b.enabled ? 'ligado' : 'pausado' })),
        h('button', { class: 'del', type: 'button', title: 'Excluir este cliente', 'aria-label': `Excluir ${b.name}`, onclick: () => removeBot(b.id, b.name) }, '🗑')));
    });
    $('#empty').hidden = bots.length > 0;
    if (!bots.length) $('#editor').hidden = true;
  }

  function planTag(p) {
    if (!p || !p.managed) return null;
    const txt = p.state === 'none' ? 'sem plano' : p.state === 'expired' ? 'vencido' : `${p.daysLeft}d`;
    const bad = p.state === 'none' || p.state === 'expired';
    return h('small', { style: `margin-left:auto;padding:0 8px;font-size:11px;font-weight:700;color:${bad ? 'var(--err)' : p.state === 'expiring' ? 'var(--warn)' : 'var(--mut)'}`, title: 'Situação do plano' }, txt);
  }

  $('#newBot').onclick = async () => {
    const name = await ask({ title: 'Novo robô', text: 'Dê um nome para identificar (ex.: Ofertas da Maria).', input: 'Nome do robô', value: 'Novo robô', okLabel: 'Criar robô' });
    if (!name) return;
    try {
      const r = await api('POST', '/api/bots', { name });
      await loadBots();
      openBot(r.id);
    } catch (e) { toast(e.message, 'err'); }
  };

  /* ───── Editor ───── */
  let waUi = null;
  async function openBot(id) {
    cur = id;
    const r = await api('GET', `/api/bots/${id}`);
    data = r.bot;
    defaultTpl = r.defaultTemplate;
    $('#editor').hidden = false;
    $('#empty').hidden = true;
    if (!$('#nicheMount').children.length) initNiches($('#nicheMount'), r.niches);
    fill($('#editor'), data);
    $('#enabledSwitch').checked = data.enabled;
    $('#inviteUrl').value = `${location.origin}/afiliado/${data.inviteToken}`;
    $('#chatChips').textContent = '';
    $('#previewOut').textContent = '';
    $('#linksOut').textContent = '';
    ['shopeeMsg', 'tgMsg'].forEach((i) => ($(`#${i}`).hidden = true));
    $('#waCard').hidden = !data.channels.whatsapp;
    waUi?.stop();
    $('#waMount').textContent = '';
    waUi = initWhatsApp($('#waMount'), { base: `/api/bots/${id}`, admin: true });
    waUi.sync(data);
    renderVars(r.variables);
    renderTplPreview();
    renderPlan(data.plan);
    renderActivity(r.activity);
    setTab(tab);
    loadBots();
    startPoll();
  }

  function renderVars(vars) {
    const box = $('#varChips');
    box.textContent = '';
    Object.entries(vars).forEach(([k, desc]) => {
      box.append(h('button', { class: 'chip', type: 'button', title: desc, onclick: () => insertVar(`{${k}}`) }, `{${k}}`));
    });
  }

  function insertVar(text) {
    const ta = $('#tplText');
    const s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + text.length;
    renderTplPreview();
  }

  let tplTimer;
  function renderTplPreview() {
    clearTimeout(tplTimer);
    tplTimer = setTimeout(async () => {
      try {
        const r = await api('POST', '/api/preview-message', { template: $('#tplText').value });
        renderTg($('#tplPreview'), r.html);
      } catch { /* ignora */ }
    }, 250);
  }
  $('#tplText').addEventListener('input', renderTplPreview);
  $('#tplReset').onclick = () => { $('#tplText').value = defaultTpl; renderTplPreview(); };

  function setTab(t) {
    tab = t;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab').forEach((p) => (p.hidden = p.dataset.panel !== t));
  }
  $$('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  async function save(quiet) {
    const body = collect($('#editor'));
    try {
      const r = await api('PUT', `/api/bots/${cur}`, body);
      data = r.bot;
      fill($('#editor'), data);
      if (!quiet) toast('Alterações salvas.');
      loadBots();
      return true;
    } catch (e) {
      toast(e.message, 'err');
      return false;
    }
  }
  $('#saveBtn').onclick = () => withBusy($('#saveBtn'), () => save());

  $('#enabledSwitch').onchange = async (e) => {
    const want = e.target.checked;
    if (!(await save(true))) { e.target.checked = !want; return; }
    try {
      await api('POST', `/api/bots/${cur}/enable`, { enabled: want });
      toast(want ? 'Robô ligado. O primeiro ciclo começa em segundos.' : 'Robô pausado.');
      refreshActivity();
      loadBots();
    } catch (ex) {
      e.target.checked = !want;
      toast(ex.message, 'err');
    }
  };

  // Pelo menos um canal precisa ficar ligado.
  $('#chanWa').onchange = (e) => { $('#waCard').hidden = !e.target.checked; if (!e.target.checked) $('#chanTg').checked = true; };
  $('#chanTg').onchange = (e) => { if (!e.target.checked) { $('#chanWa').checked = true; $('#waCard').hidden = false; } };

  /* ───── Testes de conexão ───── */
  $('#testShopee').onclick = () => withBusy($('#testShopee'), async () => {
    try {
      const r = await api('POST', `/api/bots/${cur}/test-shopee`, collect($('#editor')));
      showMsg($('#shopeeMsg'), r.message, true);
    } catch (e) { showMsg($('#shopeeMsg'), e.message, false); }
  });

  $('#testSource').onclick = () => withBusy($('#testSource'), async () => {
    try {
      const r = await api('POST', `/api/bots/${cur}/test-source`, collect($('#editor')));
      const all = r.results.every((x) => x.ok);
      showMsg($('#srcMsg'), r.results.map((x) => (x.ok ? `@${x.channel}: ${x.links} link(s) da Shopee nas últimas mensagens${x.sample ? `. Exemplo: ${x.sample.slice(0, 60)}` : ''}` : `@${x.channel}: ${x.error}`)).join(' | '), all);
    } catch (e) { showMsg($('#srcMsg'), e.message, false); }
  });

  $('#testTelegram').onclick = () => withBusy($('#testTelegram'), async () => {
    try {
      const r = await api('POST', `/api/bots/${cur}/test-telegram`, collect($('#editor')));
      showMsg($('#tgMsg'), r.message, true);
    } catch (e) { showMsg($('#tgMsg'), e.message, false); }
  });

  $('#detectChats').onclick = () => withBusy($('#detectChats'), async () => {
    const box = $('#chatChips');
    box.textContent = '';
    try {
      const r = await api('POST', `/api/bots/${cur}/telegram-chats`, collect($('#editor')));
      if (!r.chats.length) return showMsg($('#tgMsg'), `Nenhum grupo encontrado. Adicione @${r.username} ao grupo e envie qualquer mensagem lá; depois clique de novo.`, false);
      $('#tgMsg').hidden = true;
      r.chats.forEach((c) => box.append(h('button', { class: 'chip', type: 'button', onclick: () => { $('[data-path="telegram.chatId"]').value = c.id; toast(`Grupo "${c.title}" selecionado. Salve para confirmar.`); } }, `${c.title} (${c.id})`)));
    } catch (e) { showMsg($('#tgMsg'), e.message, false); }
  });

  /* ───── Simulação, ciclo manual, links avulsos ───── */
  $('#previewBtn').onclick = () => withBusy($('#previewBtn'), async () => {
    const out = $('#previewOut');
    out.textContent = '';
    if (!(await save(true))) return;
    try {
      const r = await api('POST', `/api/bots/${cur}/preview`);
      out.append(h('div', { class: 'mut' }, `${r.fetched} produtos encontrados · ${r.eligible} passaram nos filtros e ainda não foram postados.`));
      r.preview.forEach((p) => {
        const msg = h('div', { class: 'tg' });
        renderTg(msg, p.message);
        out.append(h('div', { class: 'item', style: 'align-items:flex-start' },
          h('div', { class: 'preview-card' }, p.image ? h('img', { src: p.image, alt: '', referrerpolicy: 'no-referrer' }) : h('div'),
            h('div', {}, h('b', {}, p.name), h('div', { class: 'mut' }, `${brl(p.price)} · ${p.discount}% off · ${p.sales} vendas · nota ${p.rating} · comissão ${p.commissionRate}%`), msg))));
      });
      if (!r.preview.length) out.append(h('div', { class: 'note' }, 'Nada passou nos filtros. Tente reduzir o desconto mínimo ou adicionar mais palavras-chave.'));
    } catch (e) { toast(e.message, 'err'); }
  });

  $('#runNow').onclick = () => withBusy($('#runNow'), async () => {
    if (!(await save(true))) return;
    try {
      await api('POST', `/api/bots/${cur}/run`);
      toast('Ciclo iniciado. Acompanhe no registro abaixo.');
      setTimeout(refreshActivity, 800);
    } catch (e) { toast(e.message, 'err'); }
  });

  $('#postLinks').onclick = () => withBusy($('#postLinks'), async () => {
    const out = $('#linksOut');
    out.textContent = '';
    if (!(await save(true))) return;
    try {
      const r = await api('POST', `/api/bots/${cur}/post-links`, { urls: $('#linksBox').value });
      r.results.forEach((x) => out.append(h('div', { class: 'item' }, h('span', { class: 'n' }, x.ok ? `✅ ${x.name || x.link}` : `❌ ${x.url} — ${x.error}`))));
      refreshActivity();
    } catch (e) { toast(e.message, 'err'); }
  });

  /* ───── Link do afiliado ───── */
  $('#copyInvite').onclick = async () => {
    try { await navigator.clipboard.writeText($('#inviteUrl').value); toast('Link copiado.'); } catch { $('#inviteUrl').select(); toast('Selecione e copie (Ctrl+C).'); }
  };
  $('#regen').onclick = async () => {
    if (!(await ask({ title: 'Gerar novo link?', text: 'O link atual vai parar de funcionar imediatamente.', okLabel: 'Gerar novo link' }))) return;
    const r = await api('POST', `/api/bots/${cur}/regen-token`);
    data.inviteToken = r.inviteToken;
    $('#inviteUrl').value = `${location.origin}/afiliado/${r.inviteToken}`;
    toast('Novo link gerado.');
  };
  // Exclui o cliente: robô, histórico, link de cadastro e a sessão do WhatsApp (se houver).
  async function removeBot(id, name) {
    if (!(await ask({ title: `Excluir "${name}"?`, text: 'O robô, o histórico, o link de cadastro e a conexão do WhatsApp deste cliente serão apagados. Não dá para desfazer.', okLabel: 'Excluir cliente', danger: true }))) return;
    try {
      await api('DELETE', `/api/bots/${id}`);
    } catch (e) { toast(e.message, 'err'); return; }
    toast(`"${name}" excluído.`);
    if (id === cur) {
      cur = null;
      data = null;
      clearInterval(poll);
      $('#editor').hidden = true;
    }
    await loadBots();
    if (!cur && bots.length) openBot(bots[0].id);
  }
  $('#deleteBot').onclick = () => removeBot(cur, data.name);

  /* ───── Atividade ───── */
  /* ───── Plano ───── */
  const fmtDay = (t) => new Date(t).toLocaleDateString('pt-BR');
  const PLAN_PILL = { free: ['sem controle', ''], none: ['não ativado', 'err'], active: ['ativo', 'ok'], expiring: ['vence logo', 'warn'], expired: ['vencido', 'err'] };
  function renderPlan(p) {
    if (!p) return;
    if (data) data.plan = p;
    const [label, cls] = PLAN_PILL[p.state] || ['—', ''];
    $('#planPill').textContent = label;
    $('#planPill').className = `pill ${cls}`;
    $('#planLine').textContent = !p.managed ? 'Este cliente está sem controle de plano: o robô funciona sem vencimento.'
      : p.state === 'none' ? 'O plano ainda não foi ativado. O robô não posta até você ativar.'
        : p.state === 'expired' ? `O plano venceu em ${fmtDay(p.expiresAt)}. O robô está parado.`
          : `Ativo até ${fmtDay(p.expiresAt)} (faltam ${p.daysLeft} ${p.daysLeft === 1 ? 'dia' : 'dias'}).`;
    $('#planManaged').checked = p.managed;
    ['planGrant', 'planAdd', 'planRevoke', 'planDays'].forEach((i) => ($(`#${i}`).disabled = !p.managed));
    if (document.activeElement !== $('#planContact')) $('#planContact').value = p.contact || '';
    const link = $('#planWaLink');
    link.hidden = !(p.managed && p.contact);
    if (!link.hidden) {
      const when = p.state === 'expired' ? `venceu em ${fmtDay(p.expiresAt)}` : p.state === 'none' ? 'ainda não foi ativado' : `vence em ${fmtDay(p.expiresAt)}`;
      link.href = `https://wa.me/${p.contact}?text=${encodeURIComponent(`Olá! Passando para avisar que o seu plano do robô de ofertas ${when}. Para renovar é só fazer o Pix e me avisar por aqui.`)}`;
    }
    const hist = $('#planHist');
    hist.textContent = '';
    (p.history || []).forEach((x) => hist.append(h('div', { class: 'item' }, h('span', { class: 'n' }, x.kind === 'grant' ? `✅ +${x.days} dias · vence em ${fmtDay(x.expiresAt)}` : '⛔ Plano desativado'), h('small', { class: 'mut' }, fmtDateTime(x.t)))));
    if (!(p.history || []).length) hist.append(h('div', { class: 'mut' }, 'Nenhuma ativação ainda.'));
  }
  async function planAct(body, okText) {
    try {
      const r = await api('POST', `/api/bots/${cur}/plan`, body);
      renderPlan(r.plan);
      $('#enabledSwitch').checked = r.enabled;
      showMsg($('#planMsg'), okText, true);
      loadBots();
      refreshActivity();
    } catch (e) { showMsg($('#planMsg'), e.message, false); }
  }
  $('#planGrant').onclick = () => withBusy($('#planGrant'), () => planAct({ action: 'grant', days: 30 }, 'Plano ativado por 30 dias.'));
  $('#planAdd').onclick = () => withBusy($('#planAdd'), () => planAct({ action: 'grant', days: Number($('#planDays').value) }, `${Number($('#planDays').value)} dias adicionados ao plano.`));
  $('#planRevoke').onclick = async () => {
    if (!(await ask({ title: 'Desativar o plano agora?', text: 'O robô para de postar na hora. Você pode ativar de novo quando o cliente pagar.', okLabel: 'Desativar', danger: true }))) return;
    withBusy($('#planRevoke'), () => planAct({ action: 'revoke' }, 'Plano desativado.'));
  };
  $('#planManaged').onchange = (e) => planAct({ action: 'manage', managed: e.target.checked }, e.target.checked ? 'Controle de plano ligado.' : 'Controle desligado: o robô funciona sem vencimento.');
  $('#planSaveContact').onclick = () => withBusy($('#planSaveContact'), () => planAct({ action: 'contact', contact: $('#planContact').value }, 'Número salvo.'));

  function renderActivity(a) {
    const pill = $('#statusPill');
    const planOff = a.plan && !a.plan.active;
    pill.className = `pill ${planOff ? 'err' : a.running ? 'warn' : a.enabled ? 'ok' : ''}`;
    pill.textContent = planOff ? 'plano vencido' : a.running ? 'executando' : a.enabled ? 'ligado' : 'pausado';
    $('#enabledSwitch').checked = a.enabled;
    $('#sStatus').textContent = planOff ? 'Plano vencido' : !a.configured ? 'Falta configurar' : a.running ? 'Executando…' : a.enabled ? (a.inWindow ? 'Ligado' : 'Fora do horário') : 'Pausado';
    $('#sNext').textContent = a.enabled && a.nextRunAt ? until(a.nextRunAt) : '—';
    $('#sPosted').textContent = a.stats.posted;
    $('#sErr').textContent = a.stats.lastError ? a.stats.lastError.slice(0, 90) : 'nenhum';
    const logs = $('#logs');
    const stick = logs.scrollTop + logs.clientHeight >= logs.scrollHeight - 30;
    logs.textContent = '';
    a.logs.forEach((l) => logs.append(h('div', { class: l.level }, h('span', { class: 't' }, `${fmtTime(l.t)}  `), l.msg)));
    if (!a.logs.length) logs.append(h('div', { class: 't' }, 'Sem eventos ainda.'));
    if (stick) logs.scrollTop = logs.scrollHeight;
    const rec = $('#recent');
    rec.textContent = '';
    a.recent.forEach((r) => rec.append(offerRow(r)));
    const today = new Date().toDateString();
    const nToday = a.recent.filter((r) => new Date(r.t).toDateString() === today).length;
    $('#heroTitle').textContent = nToday ? `O robô publicou ${nToday} ${nToday === 1 ? 'oferta' : 'ofertas'} hoje` : 'Nada publicado hoje ainda';
    $('#heroSub').textContent = a.enabled && a.nextRunAt ? `Próximo ciclo ${until(a.nextRunAt)}${a.stats.lastError ? ' · último erro: ' + a.stats.lastError.slice(0, 60) : ' · nenhum erro'}` : 'O robô está pausado: ligue no topo da página para ele voltar a postar.';
    if (!a.recent.length) rec.append(h('div', { class: 'mut' }, 'Nada publicado ainda.'));
  }

  async function refreshActivity() {
    if (!cur) return;
    try { renderActivity(await api('GET', `/api/bots/${cur}/activity`)); } catch (e) { if (e.status === 401) location.reload(); }
  }
  function startPoll() {
    clearInterval(poll);
    poll = setInterval(() => { if (!document.hidden) { refreshActivity(); } }, 4000);
  }

  boot();
})();
