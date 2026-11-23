'use strict';
// Cartão de WhatsApp (painel e página do cliente): o robô POSTA no grupo de WhatsApp do cliente (destino) com o link de
// afiliado dele. As ofertas vêm da busca na Shopee e, se o cliente quiser, também de um grupo de WhatsApp que ele indica
// para clonar (origem, opcional). Monta tudo com DOM (sem innerHTML).
(function () {
  const STATE_TXT = {
    off: 'desconectado',
    connecting: 'conectando…',
    pairing: 'aguardando você digitar o código no celular',
    open: 'conectado',
    closed: 'conexão caiu (tentando reconectar)',
    logged_out: 'aparelho removido no celular',
    error: 'erro',
  };

  function initWhatsApp(mount, { base, onChange }) {
    let st = null;
    let timer = null;

    const msg = h('div', { class: 'msg', hidden: true });
    const stateEl = h('span', { class: 'pill' }, '…');
    const phone = h('input', { placeholder: '11 94678-3584', inputmode: 'numeric', autocomplete: 'off' });
    const codeBox = h('div', { class: 'note info', hidden: true });
    const accepted = h('input', { type: 'checkbox', 'data-path': 'whatsapp.accepted' });
    const stats = h('p', { class: 'hint' }, '');
    const btnConnect = h('button', { class: 'btn primary', type: 'button' }, 'Gerar código de conexão');
    const btnOff = h('button', { class: 'btn danger', type: 'button' }, 'Desconectar o WhatsApp');
    const connectBox = h('div', { class: 'grid g2', style: 'margin-top:10px' },
      h('label', {}, 'Número do WhatsApp do robô (com DDD)', phone,
        h('span', { class: 'hint' }, 'DDD + número do chip do robô. O 55 do Brasil é colocado sozinho.')),
      h('div', { style: 'display:flex;align-items:flex-end' }, btnConnect));
    const linkSrc = h('input', { placeholder: 'https://chat.whatsapp.com/…', autocomplete: 'off' });
    const linkDest = h('input', { placeholder: 'https://chat.whatsapp.com/…', autocomplete: 'off' });
    const listSrc = h('div', { class: 'list', style: 'margin-top:10px' });
    const listDest = h('div', { class: 'list', style: 'margin-top:10px' });
    const btnAddSrc = h('button', { class: 'btn primary', type: 'button' }, 'Adicionar grupo de origem');
    const btnAddDest = h('button', { class: 'btn primary', type: 'button' }, 'Adicionar meu grupo');
    const btnTest = h('button', { class: 'btn', type: 'button' }, 'Enviar mensagem de teste');
    const nameInput = h('input', { placeholder: 'Ex.: Promoções da Thalyta', maxlength: '25', autocomplete: 'off' });
    const btnName = h('button', { class: 'btn', type: 'button' }, 'Trocar nome');
    const nameBox = h('div', { style: 'margin-bottom:16px' },
      h('p', { style: 'margin:0 0 6px' }, h('b', {}, 'Nome que aparece nas postagens')),
      h('p', { class: 'sub', style: 'margin:0 0 8px' }, 'É o nome do perfil do chip do robô (até 25 letras). Quem não tem o número salvo vê esse nome em cada oferta. O número continua aparecendo: o WhatsApp não permite esconder.'),
      h('div', { class: 'grid g2' }, h('label', {}, 'Nome de exibição', nameInput), h('div', { style: 'display:flex;align-items:flex-end' }, btnName)));
    const modeSel = h('select', {},
      h('option', { value: 'mix' }, 'Clonar esse grupo e também buscar promoções da Shopee (recomendado)'),
      h('option', { value: 'only' }, 'Só clonar esse grupo'));
    const modeBox = h('label', { style: 'margin-top:10px', hidden: true }, 'O que o robô posta no seu grupo', modeSel);
    const groupBox = h('div', { style: 'margin-top:14px' },
      nameBox,
      h('p', { style: 'margin:0 0 6px' }, h('b', {}, '1) O seu grupo (onde o robô posta com o seu link de afiliado)')),
      h('p', { class: 'sub', style: 'margin:0 0 8px' }, 'Crie o seu grupo no WhatsApp, gere o link de convite e cole aqui. Se o grupo só deixa administradores enviarem mensagens, torne o número do robô administrador. O robô já passa a buscar promoções da Shopee sozinho e postar nele.'),
      h('div', { class: 'grid g2' }, h('label', {}, 'Link do seu grupo', linkDest), h('div', { style: 'display:flex;align-items:flex-end' }, btnAddDest)),
      listDest,
      h('div', { class: 'row', style: 'margin-top:10px' }, btnTest),
      h('p', { style: 'margin:18px 0 6px' }, h('b', {}, '2) Opcional: clonar as ofertas de outro grupo de WhatsApp')),
      h('p', { class: 'sub', style: 'margin:0 0 8px' }, 'Cole o link de convite de um grupo de promoções. O número do robô entra e só lê as ofertas de lá, nunca envia nada para ele. Sem esse grupo o robô continua postando as promoções que encontra na Shopee.'),
      h('div', { class: 'grid g2' }, h('label', {}, 'Link do grupo de origem', linkSrc), h('div', { style: 'display:flex;align-items:flex-end' }, btnAddSrc)),
      listSrc,
      modeBox);

    mount.append(
      h('div', { class: 'note' },
        h('b', {}, 'Como funciona: '),
        'o robô busca promoções da Shopee (pelo nicho que você escolher) e posta no ',
        h('b', {}, 'seu'),
        ' grupo de WhatsApp com o ',
        h('b', {}, 'seu'),
        ' link de afiliado. Se você quiser, ele também lê as ofertas de outro grupo de WhatsApp, troca o link da Shopee pelo seu e posta junto. ',
        h('b', {}, 'Atenção: '),
        'o WhatsApp não oferece isso de forma oficial e enviar mensagens é a parte que mais arrisca bloqueio. Por isso o robô usa um chip dedicado (nunca o seu número principal), pausas entre mensagens, “digitando…”, limite por hora e por dia, horário ativo e para sozinho se algo falhar.'),
      h('label', { class: 'check', style: 'margin:12px 0' }, accepted, 'Entendi os riscos e quero usar mesmo assim'),
      h('div', { class: 'row', style: 'align-items:center;gap:10px' }, h('span', {}, 'Situação:'), stateEl),
      connectBox,
      codeBox,
      groupBox,
      stats,
      h('div', { class: 'row', style: 'margin-top:10px' }, btnOff),
      msg);

    const say = (t, ok) => showMsg(msg, t, ok);

    function renderGroups(box, groups, kind) {
      box.textContent = '';
      groups.forEach((g) => {
        const rm = h('button', { class: 'btn danger', type: 'button' }, 'Remover');
        rm.onclick = () => withBusy(rm, async () => {
          try { render(await api('POST', `${base}/whatsapp/${kind}/remove`, { id: g.id })); say('Grupo removido.', true); } catch (e) { say(e.message, false); }
        });
        box.append(h('div', { class: 'item' }, h('span', { class: 'n' }, `👥 ${g.name}`), rm));
      });
    }

    function render(s) {
      st = s;
      const open = s.state === 'open';
      stateEl.textContent = !s.installed ? 'módulo não instalado neste servidor' : (STATE_TXT[s.state] || s.state);
      stateEl.className = `pill ${open ? 'ok' : s.state === 'error' ? 'err' : s.state === 'off' ? '' : 'warn'}`;
      codeBox.hidden = !s.pairingCode;
      codeBox.textContent = '';
      if (s.pairingCode) {
        codeBox.append(h('div', { style: 'font-size:26px;font-weight:800;letter-spacing:3px;margin:4px 0' }, s.pairingCode),
          'No celular do chip do robô: WhatsApp → Aparelhos conectados → Conectar um aparelho → “Conectar com número de telefone” e digite esse código. Você tem 1 a 2 minutos.');
      }
      if (s.phone && !phone.value) phone.value = s.phone;
      btnConnect.textContent = open ? 'Reconectar com outro código' : 'Gerar código de conexão';
      connectBox.hidden = open;
      groupBox.hidden = !open;
      btnOff.hidden = s.state === 'off';
      renderGroups(listSrc, s.sources || [], 'source');
      renderGroups(listDest, s.dests || [], 'dest');
      btnTest.hidden = !(s.dests || []).length;
      stats.hidden = !open || !(s.sources || []).length;
      modeBox.hidden = !open || !(s.sources || []).length;
      stats.textContent = s.linksSeen
        ? `Ofertas vistas no grupo de origem nas últimas 24 h: ${s.linksSeen}.${s.sentToday ? ` Postadas hoje no seu grupo: ${s.sentToday}.` : ''}`
        : 'Ainda não vi nenhuma oferta no grupo de origem. Assim que alguém postar um link da Shopee lá, ele aparece aqui.';
      schedule();
      if (onChange) onChange(s);
    }

    async function refresh() {
      try { render(await api('GET', `${base}/whatsapp`)); } catch { /* ignora */ }
    }
    function schedule() {
      clearTimeout(timer);
      const fast = st && (st.state === 'pairing' || st.state === 'connecting');
      timer = setTimeout(() => { if (!document.hidden) refresh(); else schedule(); }, fast ? 3000 : 20000);
    }

    btnConnect.onclick = () => withBusy(btnConnect, async () => {
      try {
        if (!accepted.checked) { say('Marque que entendeu os riscos para continuar.', false); return; }
        await api('PUT', base, { whatsapp: { accepted: true } });
        render(await api('POST', `${base}/whatsapp/connect`, { phone: phone.value }));
        say('Código gerado. Digite no celular em até 1–2 minutos.', true);
      } catch (e) { say(e.message, false); }
    });
    const addHandler = (btn, input, kind, okMsg) => {
      btn.onclick = () => withBusy(btn, async () => {
        try {
          if (!accepted.checked) { say('Marque que entendeu os riscos para continuar.', false); return; }
          await api('PUT', base, { whatsapp: { accepted: true } });
          const firstSource = kind === 'source' && !((st && st.sources) || []).length;
          render(await api('POST', `${base}/whatsapp/${kind}`, { link: input.value }));
          if (firstSource) { await api('PUT', base, { source: { mode: 'mix' } }); syncMode('mix'); }
          input.value = '';
          say(okMsg, true);
        } catch (e) { say(e.message, false); }
      });
    };
    addHandler(btnAddSrc, linkSrc, 'source', 'Pronto! O robô entrou no grupo, vai clonar as ofertas de lá e também buscar promoções da Shopee.');
    addHandler(btnAddDest, linkDest, 'dest', 'Pronto! O robô entrou no seu grupo e vai postar as ofertas lá. Envie a mensagem de teste para conferir.');
    const syncMode = (v) => { modeSel.value = v; document.querySelectorAll('[data-path="source.mode"]').forEach((el) => { if (el !== modeSel) el.value = v; }); };
    document.addEventListener('change', (e) => { const t = e.target; if (t && t !== modeSel && t.matches && t.matches('[data-path="source.mode"]')) modeSel.value = t.value; });
    modeSel.onchange = async () => {
      try { await api('PUT', base, { source: { mode: modeSel.value } }); syncMode(modeSel.value); say(modeSel.value === 'mix' ? 'Certo: o robô clona o grupo e também busca promoções.' : 'Certo: o robô só posta o que o grupo de origem publicar.', true); } catch (e) { say(e.message, false); }
    };
    btnName.onclick = () => withBusy(btnName, async () => {
      try { const r = await api('POST', `${base}/whatsapp/profile-name`, { name: nameInput.value }); nameInput.value = r.name; say(r.message, true); } catch (e) { say(e.message, false); }
    });
    btnTest.onclick = () => withBusy(btnTest, async () => {
      try { await api('POST', `${base}/whatsapp/test`); say('Mensagem de teste enviada ao seu grupo. Confira no WhatsApp.', true); } catch (e) { say(e.message, false); }
    });
    btnOff.onclick = () => withBusy(btnOff, async () => {
      if (!await ask({ title: 'Desconectar o WhatsApp?', text: 'O número do robô sai desta conta e os grupos escolhidos são removidos. O robô para de postar no WhatsApp.', okLabel: 'Desconectar', danger: true })) return;
      try { render(await api('POST', `${base}/whatsapp/disconnect`)); say('WhatsApp desconectado.', true); } catch (e) { say(e.message, false); }
    });

    return {
      // preenche o aceite salvo e atualiza o status
      sync(bot) { if (bot) { fill(mount, bot); if (bot.source && bot.source.mode) modeSel.value = bot.source.mode; if (bot.whatsapp && bot.whatsapp.displayName) nameInput.value = bot.whatsapp.displayName; } return refresh(); },
      stop() { clearTimeout(timer); },
    };
  }

  window.initWhatsApp = initWhatsApp;
})();
