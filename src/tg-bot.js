'use strict';
// Bot interativo do Telegram: em vez de só receber as ofertas automáticas, o afiliado conversa com o
// próprio bot (o mesmo token/usuário cadastrado no robô) em um chat privado. Ele manda o link da
// promoção, o robô converte para o link de afiliado dele e mostra uma prévia; só quando a pessoa aperta
// "Publicar" é que a oferta vai para o WhatsApp — em um grupo específico ou em todos de uma vez.
// Publicação sob decisão humana (em vez de 100% automática) também reduz, na prática, o risco de
// banimento no WhatsApp: o padrão de envio fica menos "robótico".
const telegram = require('./telegram');
const { sleep, rid } = require('./util');
const { ensureWa } = require('./bots');

const DRAFT_TTL_MS = 30 * 60000; // depois disso a prévia expira (link pode não valer mais a pena publicar)

function money(p) {
  const v = p.priceMin || p.priceMax || 0;
  return v ? `R$ ${v.toFixed(2).replace('.', ',')}` : '';
}

function previewText(product, link) {
  if (!product) return `🛒 Link pronto para publicar:\n${link}`;
  const bits = [`🛒 <b>${product.name}</b>`];
  const price = money(product);
  if (price) bits.push(product.discount ? `${price} (${product.discount}% OFF)` : price);
  if (product.sales) bits.push(`${product.sales} vendidos`);
  bits.push('', 'Prévia de como vai chegar no grupo 👇', '— — —');
  return bits.join('\n');
}

class TgBot {
  constructor(store, engine, wa) {
    this.store = store;
    this.engine = engine;
    this.wa = wa;
    this.loops = new Map(); // botId -> { stop, token }
    this.drafts = new Map(); // `${botId}:${chatId}` -> { token, link, product, html, waHtml, image, at }
  }

  log(id, level, msg) { this.store.log(id, level, `Bot Telegram: ${msg}`); }

  // Chamar sempre que o token do robô mudar (inclusive ao criar/atualizar/remover o robô).
  // TG_BOT_DISABLED=1 desliga o bot interativo por completo (usado pelos testes automatizados: o
  // servidor de Telegram falso ali não faz long-polling de verdade, e um loop correndo sem parar por
  // cima disso só consumiria recursos à toa, sem testar nada que já não seja coberto).
  sync(bot) {
    if (process.env.TG_BOT_DISABLED === '1') return;
    if (!bot || !bot.telegram?.token) return this.stop(bot?.id);
    const running = this.loops.get(bot.id);
    if (running && running.token === bot.telegram.token) return; // já rodando com o token certo
    this.stop(bot.id);
    this.start(bot);
  }

  syncAll() { for (const bot of this.store.bots) this.sync(bot); }

  stop(id) {
    const r = this.loops.get(id);
    if (r) { r.stopped = true; this.loops.delete(id); }
  }

  start(bot) {
    const token = bot.telegram.token;
    const state = { stopped: false, token };
    this.loops.set(bot.id, state);
    let offset = 0;
    let failStreak = 0;
    const loop = async () => {
      while (!state.stopped) {
        let updates;
        try {
          updates = await telegram.getUpdates(token, offset);
          failStreak = 0;
        } catch (e) {
          failStreak++;
          await sleep(Math.min(30000, 2000 * failStreak));
          continue;
        }
        for (const u of updates) {
          offset = u.update_id + 1;
          const fresh = this.store.getBot(bot.id); // config pode ter mudado (nichos, grupos, etc.)
          if (!fresh || fresh.telegram.token !== token) { state.stopped = true; break; }
          await this.handleUpdate(fresh, u).catch((e) => this.log(bot.id, 'error', e.message));
        }
      }
    };
    loop();
  }

  draftKey(botId, chatId) { return `${botId}:${chatId}`; }

  async handleUpdate(bot, u) {
    if (u.callback_query) return this.handleCallback(bot, u.callback_query);
    const msg = u.message;
    if (!msg || typeof msg.text !== 'string') return;
    if (msg.chat.type !== 'private') return; // o bot só conversa em chat privado com o afiliado
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (/^\/start\b/.test(text)) {
      await telegram.sendText(bot.telegram.token,
        chatId,
        `Olá! Eu sou o robô de ofertas "${bot.name}".\n\n` +
        'Me manda o link de qualquer promoção da Shopee que eu converto para o seu link de afiliado, ' +
        'mostro a prévia e, quando você apertar "Publicar", eu posto no seu WhatsApp.\n\n' +
        'Comandos: /grupos (grupos conectados) · /status (conexão do WhatsApp) · /ajuda');
      return;
    }
    if (/^\/ajuda\b/.test(text)) {
      await telegram.sendText(bot.telegram.token, chatId,
        'Como usar:\n1) Cole aqui o link da promoção.\n2) Confira a prévia da mensagem.\n' +
        '3) Aperte "Publicar em todos" ou escolha um grupo específico.\n\n' +
        'Para espelhar um grupo de ofertas inteiro (o robô lê e já publica sozinho) ou conectar/trocar o ' +
        'WhatsApp, use o painel na web — o bot aqui é só para publicar links avulsos na hora.');
      return;
    }
    if (/^\/grupos\b/.test(text)) {
      const w = ensureWa(bot);
      const dests = w.dests || [];
      const srcs = w.sources || [];
      const lines = ['<b>Grupos de destino (onde publico):</b>'];
      lines.push(...(dests.length ? dests.map((g, i) => `${i + 1}. ${g.name}`) : ['(nenhum — conecte no painel)']));
      if (srcs.length) {
        lines.push('', '<b>Espelhando (lendo) destes grupos:</b>');
        lines.push(...srcs.map((g) => `• ${g.name}`));
      }
      await telegram.sendText(bot.telegram.token, chatId, lines.join('\n'));
      return;
    }
    if (/^\/status\b/.test(text)) {
      const st = this.wa.status(bot);
      const lines = [`WhatsApp: ${{ off: 'desligado', connecting: 'conectando…', pairing: 'aguardando código', open: '🟢 conectado', error: '🔴 erro', logged_out: 'desconectado no celular' }[st.state] || st.state}`];
      if (st.warmingUp) lines.push(`Em aquecimento: até ${st.maxPerHourNow}/hora e ${st.maxPerDayNow}/dia por enquanto (sobe aos poucos).`);
      await telegram.sendText(bot.telegram.token, chatId, lines.join('\n'));
      return;
    }
    if (text.startsWith('/')) return; // comando desconhecido: ignora em silêncio

    const m = /https?:\/\/\S+/i.exec(text);
    if (!m) {
      await telegram.sendText(bot.telegram.token, chatId, 'Me manda o link da promoção da Shopee que eu preparo a publicação. Use /ajuda para ver como funciona.');
      return;
    }

    let draft;
    try {
      const r = await this.engine.prepareLink(bot, m[0]);
      draft = { token: rid(5), link: r.link, product: r.product, html: r.html, waHtml: r.waHtml, image: r.product?.image || '', at: Date.now() };
    } catch (e) {
      await telegram.sendText(bot.telegram.token, chatId, `Não consegui preparar esse link: ${e.message}`);
      return;
    }

    const w = ensureWa(bot);
    const dests = w.dests || [];
    const keyboard = [];
    if (dests.length > 1) {
      keyboard.push([{ text: '📤 Publicar em todos os grupos', callback_data: `p:a:${draft.token}` }]);
      for (let i = 0; i < Math.min(dests.length, 8); i++) {
        keyboard.push([{ text: `Só em: ${dests[i].name}`.slice(0, 64), callback_data: `p:g:${i}:${draft.token}` }]);
      }
    } else if (dests.length === 1) {
      keyboard.push([{ text: `📤 Publicar em "${dests[0].name}"`.slice(0, 64), callback_data: `p:a:${draft.token}` }]);
    } else {
      keyboard.push([{ text: '⚠️ Nenhum grupo conectado ainda', callback_data: `p:x:${draft.token}` }]);
    }
    keyboard.push([{ text: '❌ Cancelar', callback_data: `p:x:${draft.token}` }]);

    const sent = await telegram.sendWithButtons(bot.telegram.token, chatId, { image: draft.image, html: previewText(draft.product, draft.link), keyboard });
    draft.messageId = sent.message_id;
    draft.isPhoto = sent.photo;
    this.drafts.set(this.draftKey(bot.id, chatId), draft);
  }

  async handleCallback(bot, cq) {
    const chatId = cq.message?.chat?.id;
    const [, kind, a, b] = cq.data.split(':'); // p:a:<token> | p:g:<idx>:<token> | p:x:<token>
    const token = kind === 'g' ? b : a;
    const key = this.draftKey(bot.id, chatId);
    const draft = this.drafts.get(key);
    if (!draft || draft.token !== token) {
      return telegram.answerCallback(bot.telegram.token, cq.id, 'Essa prévia expirou. Manda o link de novo.', true);
    }
    if (Date.now() - draft.at > DRAFT_TTL_MS) {
      this.drafts.delete(key);
      return telegram.answerCallback(bot.telegram.token, cq.id, 'Essa prévia expirou. Manda o link de novo.', true);
    }
    if (kind === 'x') {
      this.drafts.delete(key);
      await telegram.answerCallback(bot.telegram.token, cq.id, 'Cancelado.');
      return telegram.finishMessage(bot.telegram.token, chatId, draft.messageId, '❌ Cancelado.', draft.isPhoto);
    }

    const w = ensureWa(bot);
    let jid = null;
    let label = 'todos os grupos';
    if (kind === 'g') {
      const g = (w.dests || [])[Number(a)];
      if (!g) return telegram.answerCallback(bot.telegram.token, cq.id, 'Esse grupo não existe mais.', true);
      jid = g.id;
      label = g.name;
    }

    try {
      const r = this.wa.publishNow(bot, { html: draft.waHtml, image: draft.image, jid });
      if (draft.product) {
        const hist = this.store.hist(bot.id);
        hist.seen[draft.product.itemId] = Date.now();
        hist.recent.unshift({ t: Date.now(), name: draft.product.name, link: draft.link, price: draft.product.priceMin || draft.product.priceMax, discount: draft.product.discount, image: /^https:\/\//.test(draft.product.image || '') ? draft.product.image : '' });
        hist.recent.length = Math.min(hist.recent.length, 50);
        this.store.saveHistory();
      }
      this.drafts.delete(key);
      await telegram.answerCallback(bot.telegram.token, cq.id, '✅ Publicado!');
      await telegram.finishMessage(bot.telegram.token, chatId, draft.messageId, `✅ Publicado em ${r.groups > 1 ? `${r.groups} grupos` : label}.`, draft.isPhoto);
      this.log(bot.id, 'ok', `publicação manual enviada ao WhatsApp (${label}).`);
    } catch (e) {
      await telegram.answerCallback(bot.telegram.token, cq.id, e.message, true);
    }
  }
}

module.exports = { TgBot };
