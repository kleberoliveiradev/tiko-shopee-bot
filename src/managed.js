'use strict';
// Criação automática do bot do Telegram (Managed Bots, Bot API 9.6).
// Fluxo: o dono da plataforma cadastra UM "bot gerenciador" (com Bot Management Mode ligado no @BotFather).
// Cada afiliado abre um link t.me/newbot/<gerenciador>/<sugestão>, confirma no Telegram e o gerenciador
// recebe o update `managed_bot`; então busca o token com getManagedBotToken e liga ao robô do afiliado.
const crypto = require('crypto');
const telegram = require('./telegram');
const { sleep } = require('./util');
const { TOKEN_RE } = require('./bots');

const PENDING_MS = 6 * 3600000;
const ADMIN_RIGHTS = 'post_messages+edit_messages+delete_messages';

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const GENERIC = new Set(['ofertas', 'oferta', 'promocoes', 'promocao', 'promo', 'promos', 'achadinhos', 'da', 'do', 'de', 'das', 'dos', 'e', 'bot', 'robo']);

function suggestUsername(bot) {
  const words = String(bot.name || '').split(/\s+/).filter((w) => w && !GENERIC.has(slug(w)));
  let base = slug(words.join('')).slice(0, 12) || slug(bot.name).slice(0, 12) || 'ofertas';
  if (!/^[a-z]/.test(base)) base = `o${base}`;
  return `${base}_${crypto.randomBytes(3).toString('hex')}_bot`; // ex.: thalyta_a1b2c3_bot (máx. 32 caracteres)
}

class Managed {
  constructor(store) {
    this.store = store;
    this.gen = 0;
    this.unmatched = 0;
  }

  get manager() { return this.store.config.manager || null; }
  available() { return !!(this.manager && this.manager.token); }

  // Valida e salva o bot gerenciador do dono da plataforma.
  async setManager(token) {
    const tk = String(token || '').trim();
    if (!TOKEN_RE.test(tk)) throw new Error('Token inválido. Ele tem o formato 123456789:AAxxxxxxxx (copie do @BotFather).');
    const me = await telegram.getMe(tk);
    if (!me.can_manage_bots) {
      throw new Error('Esse bot ainda não pode criar outros bots. No @BotFather, abra o app (t.me/BotFather?startapp), entre nas configurações do bot e ligue "Bot Management Mode".');
    }
    this.store.config.manager = { token: tk, username: me.username, id: me.id };
    this.store.saveConfig();
    this.restart();
    return me;
  }

  clearManager() {
    delete this.store.config.manager;
    this.store.saveConfig();
    this.gen++;
  }

  // Gera (ou reaproveita) o nome sugerido e devolve o link de criação.
  start(bot) {
    if (!this.available()) throw new Error('A criação automática ainda não foi ativada pelo administrador.');
    const t = bot.telegram;
    if (!t.pendingUsername || Date.now() - (t.pendingAt || 0) > PENDING_MS) {
      t.pendingUsername = suggestUsername(bot);
      t.pendingAt = Date.now();
      this.store.saveConfig();
    }
    const name = `Ofertas ${bot.name}`.slice(0, 64);
    return {
      username: t.pendingUsername,
      link: `https://t.me/newbot/${this.manager.username}/${t.pendingUsername}?name=${encodeURIComponent(name)}`,
    };
  }

  groupLinks(username) {
    if (!username) return { groupLink: '', channelLink: '' };
    return {
      groupLink: `https://t.me/${username}?startgroup=ofertas&admin=${ADMIN_RIGHTS}`,
      channelLink: `https://t.me/${username}?startchannel&admin=post_messages+edit_messages`,
    };
  }

  async handleUpdate(u) {
    const mb = u.managed_bot;
    if (!mb || !mb.bot || !mb.bot.username) return;
    const uname = String(mb.bot.username).toLowerCase();
    const bot = this.store.bots.find((b) => (b.telegram.pendingUsername || '').toLowerCase() === uname
      || (b.telegram.botUsername || '').toLowerCase() === uname);
    if (!bot) {
      this.unmatched++;
      console.log(`[managed] bot @${mb.bot.username} criado, mas não corresponde a nenhum robô pendente (nome alterado na criação?).`);
      return;
    }
    const token = await telegram.call(this.manager.token, 'getManagedBotToken', { user_id: mb.bot.id });
    if (!TOKEN_RE.test(String(token))) throw new Error('O Telegram devolveu um token em formato inesperado.');
    bot.telegram.token = token;
    bot.telegram.botUsername = mb.bot.username;
    bot.telegram.pendingUsername = '';
    this.store.saveConfig();
    this.store.log(bot.id, 'ok', `Bot @${mb.bot.username} criado e conectado automaticamente.`);
  }

  restart() {
    this.gen++;
    this.loop(this.gen).catch(() => {});
  }

  async loop(gen) {
    let backoff = 2000;
    const pollSec = Number(process.env.MANAGER_POLL_SEC ?? 20);
    const idleMs = Number(process.env.MANAGER_IDLE_MS ?? 0);
    while (gen === this.gen) {
      const m = this.manager;
      if (!m || !m.token) return;
      const st = (this.store.state._manager ||= { offset: 0 });
      try {
        const ups = await telegram.call(m.token, 'getUpdates', { offset: st.offset, timeout: pollSec, allowed_updates: ['managed_bot'] }, 0);
        backoff = 2000;
        for (const u of ups) {
          st.offset = u.update_id + 1;
          try {
            await this.handleUpdate(u);
          } catch (e) {
            console.error('[managed] falha ao tratar update:', e.message);
          }
        }
        if (ups.length) this.store.saveState();
        else if (idleMs) await sleep(idleMs);
      } catch (e) {
        if (gen !== this.gen) return;
        if (e.code === 401) {
          console.error('[managed] token do bot gerenciador recusado pelo Telegram; parando a escuta.');
          return;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }
}

module.exports = { Managed, suggestUsername };
