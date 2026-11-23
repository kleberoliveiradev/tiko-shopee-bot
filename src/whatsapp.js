'use strict';
// WhatsApp (módulo não oficial): o número do robô LÊ os links da Shopee nos grupos de ofertas indicados pelo cliente
// e, depois de trocar pelo link de afiliado dele, posta no grupo de WhatsApp do próprio cliente.
// Proteções contra banimento: número dedicado, pausas aleatórias, "digitando…", limite por hora e por dia,
// só envia dentro do horário do robô, só nos grupos do cliente e para sozinho após falhas seguidas.
const fs = require('fs');
const path = require('path');
const { sleep, inWindow } = require('./util');
const { toWhatsapp } = require('./wa-format');
const { shopeeLinksFromText } = require('./source');
const { ensureChannels } = require('./bots');
const plan = require('./plan');

const INVITE_RE = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{16,32})/i;
const MAX_SOURCES = 3;
const MAX_DESTS = 3;

const scale = () => Number(process.env.WA_TIME_SCALE ?? 1);
const wait = (ms) => sleep(Math.round(ms * scale()));
const rnd = (a, b) => a + Math.random() * (b - a);
const dayKey = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

class WhatsApp {
  constructor(store, dataDir) {
    this.store = store;
    this.root = path.join(dataDir, 'wa');
    this.driver = process.env.WA_DRIVER ? require(process.env.WA_DRIVER) : require('./wa-baileys');
    this.sessions = new Map();
  }

  dir(id) { return path.join(this.root, String(id).replace(/[^\w-]/g, '')); }
  hasCreds(id) { return fs.existsSync(path.join(this.dir(id), 'creds.json')); }
  installed() { return this.driver.available ? this.driver.available() : true; }
  log(id, level, msg) { this.store.log(id, level, `WhatsApp: ${msg}`); }

  status(bot) {
    const s = this.sessions.get(bot.id);
    const st = this.store.st(bot.id).wa;
    const ramp = this.rampFactor(st?.firstSentAt);
    const w = bot.whatsapp || {};
    return {
      installed: this.installed(),
      state: s ? s.state : this.hasCreds(bot.id) ? 'connecting' : 'off',
      pairingCode: s && s.state === 'pairing' ? s.code : '',
      phone: s?.phone || '',
      error: s?.error || '',
      queued: s?.queue.length || 0,
      sources: bot.whatsapp?.sources || [],
      dests: bot.whatsapp?.dests || [],
      linksSeen: this.recentLinks(bot).length,
      lastLinkAt: this.recentLinks(bot)[0]?.t || 0,
      sentToday: st && st.day === dayKey(bot.schedule.timezone) ? st.sent : 0,
      warmingUp: ramp < 1,
      maxPerHourNow: Math.max(1, Math.round((w.maxPerHour || 8) * ramp)),
      maxPerDayNow: Math.max(1, Math.round((w.maxPerDay || 40) * ramp)),
    };
  }

  recentLinks(bot) {
    const ids = new Set((bot.whatsapp?.sources || []).map((x) => x.id));
    const cutoff = Date.now() - 86400000;
    return (this.store.st(bot.id).waLinks || []).filter((l) => ids.has(l.g) && l.t > cutoff);
  }

  // Mensagem de um grupo: guarda SÓ os links da Shopee (nada de texto, nome ou número de quem postou).
  handleMessage(id, { jid, text, ts }) {
    const bot = this.store.getBot(id);
    if (!bot || !(bot.whatsapp?.sources || []).some((x) => x.id === jid)) return;
    const links = shopeeLinksFromText(text);
    if (!links.length) return;
    const st = this.store.st(id);
    const list = (st.waLinks ||= []);
    const cutoff = Date.now() - 2 * 86400000;
    let changed = false;
    for (const url of links.reverse()) {
      if (list.some((l) => l.url === url && l.g === jid)) continue;
      list.unshift({ url, g: jid, t: ts || Date.now() });
      changed = true;
    }
    if (!changed) return;
    st.waLinks = list.filter((l) => l.t > cutoff).slice(0, 150);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.store.saveState(), 3000);
    this.saveTimer.unref?.();
  }

  // O cliente cola o link de convite de um grupo e o número do robô entra nele.
  // kind 'source' = grupo de ofertas que o robô LÊ; kind 'dest' = grupo do cliente onde o robô POSTA.
  async addGroup(bot, link, kind) {
    const m = INVITE_RE.exec(String(link || ''));
    if (!m) throw new Error('Cole o link de convite do grupo (começa com chat.whatsapp.com/).');
    const isDest = kind === 'dest';
    const w = (bot.whatsapp ||= {});
    const sources = (w.sources ||= []);
    const dests = (w.dests ||= []);
    const mine = isDest ? dests : sources;
    const other = isDest ? sources : dests;
    const max = isDest ? MAX_DESTS : MAX_SOURCES;
    if (mine.length >= max) throw new Error(`Máximo de ${max} grupos nesta lista.`);
    const s = this.sessions.get(bot.id);
    if (!s || s.state !== 'open' || !s.handle) throw new Error('Conecte o WhatsApp primeiro (gere o código e digite no celular).');
    if (Date.now() - (s.lastJoinAt || 0) < 20000 * scale()) throw new Error('Aguarde alguns segundos antes de adicionar outro grupo.');
    let info;
    try {
      info = await s.handle.inviteInfo(m[1]);
    } catch {
      throw new Error('Link inválido ou expirado. Peça um link novo ao administrador do grupo.');
    }
    if (other.some((x) => x.id === info.id)) {
      throw new Error(isDest ? 'Esse grupo já é a ORIGEM das ofertas. O grupo onde o robô posta precisa ser o SEU grupo, outro diferente.' : 'Esse grupo já é o SEU grupo de destino. A origem precisa ser o grupo de ofertas que você quer clonar.');
    }
    if (mine.some((x) => x.id === info.id)) return this.status(bot);
    s.lastJoinAt = Date.now();
    try {
      await s.handle.joinGroup(m[1]);
    } catch {
      throw new Error('Não consegui entrar no grupo. O link pode ter expirado ou o grupo exige aprovação de um administrador.');
    }
    mine.push({ id: info.id, name: String(info.name || info.id).slice(0, 80) });
    if (isDest) {
      w.groupIds = dests.map((x) => x.id);
      w.enabled = true; // o grupo de destino ligado = o robô passa a postar nele
    }
    this.store.saveConfig();
    this.log(bot.id, 'ok', isDest ? `passou a postar no grupo "${info.name}".` : `passou a ler as ofertas do grupo "${info.name}".`);
    return this.status(bot);
  }

  removeSource(bot, id) {
    const w = bot.whatsapp;
    if (!w?.sources) return this.status(bot);
    w.sources = w.sources.filter((x) => x.id !== id);
    const st = this.store.st(bot.id);
    st.waLinks = (st.waLinks || []).filter((l) => l.g !== id);
    this.store.saveConfig();
    this.store.saveState();
    return this.status(bot);
  }

  removeDest(bot, id) {
    const w = bot.whatsapp;
    if (!w?.dests) return this.status(bot);
    w.dests = w.dests.filter((x) => x.id !== id);
    w.groupIds = w.dests.map((x) => x.id);
    if (!w.groupIds.length) w.enabled = false;
    this.store.saveConfig();
    return this.status(bot);
  }

  async start(bot) {
    let s = this.sessions.get(bot.id);
    if (s?.handle) return s;
    if (!s) {
      s = { handle: null, state: 'connecting', phone: '', code: '', error: '', queue: [], working: false, sentTimes: [], fails: 0, attempts: 0, retry: null, closing: false };
      this.sessions.set(bot.id, s);
    }
    s.error = '';
    if (s.state !== 'pairing') s.state = 'connecting';
    try {
      s.handle = await this.driver.createSession({
        dir: this.dir(bot.id),
        log: (m) => this.log(bot.id, 'info', m),
        onMessage: (m) => this.handleMessage(bot.id, m),
        // Avisos de uma sessão antiga (já descartada) não podem mexer na sessão nova.
        onState: (st, info = {}) => { if (this.sessions.get(bot.id) === s) this.onState(bot.id, st, info); },
      });
    } catch (e) {
      s.state = 'error';
      s.error = e.message;
      s.handle = null;
      throw e;
    }
    return s;
  }

  onState(id, st, info) {
    const s = this.sessions.get(id);
    if (!s || s.closing) return;
    if (st === 'open') {
      s.state = 'open';
      s.phone = info.phone || s.phone;
      s.code = '';
      s.attempts = 0;
      s.error = '';
      this.log(id, 'ok', `conectado${s.phone ? ` (número ${s.phone})` : ''}.`);
    } else if (st === 'connecting') {
      if (s.state !== 'pairing' && s.state !== 'open') s.state = 'connecting';
    } else if (st === 'logged_out') {
      const wasPairing = s.state === 'pairing' || info.registered === false;
      s.state = 'logged_out';
      s.handle = null;
      s.code = '';
      s.queue.length = 0;
      fs.rmSync(this.dir(id), { recursive: true, force: true });
      this.log(id, 'warn', wasPairing
        ? 'o WhatsApp recusou a conexão antes de terminar. Gere um código novo e digite em até 1 minuto.'
        : 'o aparelho foi removido no celular. Conecte de novo na página do afiliado.');
    } else if (st === 'closed') {
      s.handle = null;
      // Caiu enquanto esperava o código (antes de parear): o código antigo morreu junto. Não adianta reconectar sozinho.
      // Exceção: código 515 = o WhatsApp pede para reiniciar logo depois de o pareamento dar certo.
      if (s.state === 'pairing' && info.registered === false && info.code !== 515) {
        s.state = 'error';
        s.code = '';
        s.error = 'A conexão caiu antes de você digitar o código. Gere um código novo.';
        return;
      }
      if (s.state === 'open') s.state = 'connecting';
      if (s.attempts >= 8) {
        s.state = 'error';
        s.error = 'Não consegui reconectar ao WhatsApp. Conecte de novo.';
        return;
      }
      const delay = Math.min(60000, 3000 * 2 ** s.attempts++);
      clearTimeout(s.retry);
      s.retry = setTimeout(() => {
        const bot = this.store.getBot(id);
        if (bot && !s.closing) this.start(bot).catch(() => {});
      }, Math.round(delay * scale()));
      s.retry.unref?.();
    }
  }

  // Pede o código de 8 dígitos que a pessoa digita em WhatsApp > Aparelhos conectados > Conectar com número.
  async connect(bot, phone) {
    let digits = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
    // Número brasileiro sem o país (DDD + número, 10 ou 11 dígitos): completa com o 55.
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (digits.length < 12 || digits.length > 15) throw new Error('Número incompleto. Digite DDD + número (ex.: 11 94678-3584); o 55 do Brasil é colocado sozinho.');
    if (!this.installed()) throw new Error('O módulo do WhatsApp não está instalado neste servidor.');
    let s = this.sessions.get(bot.id);
    if (s?.state === 'open') return this.status(bot);
    // Tentativa anterior sem conclusão (código antigo ou número errado): recomeça do zero para o código novo valer.
    if (s && ['pairing', 'error', 'logged_out'].includes(s.state)) await this.disconnect(bot.id);
    // Credenciais de uma tentativa que nunca chegou a conectar (ex.: número digitado errado) são descartadas.
    try {
      const c = JSON.parse(fs.readFileSync(path.join(this.dir(bot.id), 'creds.json'), 'utf8'));
      if (!c.registered && !(s && s.state === 'connecting' && s.handle)) fs.rmSync(this.dir(bot.id), { recursive: true, force: true });
    } catch { /* sem credenciais: nada a descartar */ }
    s = await this.start(bot);
    const code = await s.handle.requestPairingCode(digits);
    s.code = code;
    s.state = 'pairing';
    s.phone = digits;
    this.log(bot.id, 'info', 'código de conexão gerado; aguardando a confirmação no celular.');
    return this.status(bot);
  }

  async listGroups(bot) {
    const s = this.sessions.get(bot.id);
    if (!s || s.state !== 'open' || !s.handle) throw new Error('O WhatsApp ainda não está conectado.');
    const groups = await s.handle.listGroups();
    return groups.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  // "Esquenta" do número/grupo: nos primeiros dias depois do 1º envio, usa limites bem mais baixos
  // que o configurado, subindo aos poucos. Número/grupo novo postando no volume máximo de cara é
  // um dos sinais que mais derruba grupo e número no WhatsApp.
  rampFactor(firstSentAt) {
    if (!firstSentAt) return 0.5; // ainda nem mandou a 1ª mensagem: trata como dia 0
    const days = (Date.now() - firstSentAt) / 86400000;
    if (days < 3) return 0.5;
    if (days < 7) return 0.75;
    return 1;
  }

  canSend(bot, s) {
    const w = bot.whatsapp;
    if (!inWindow(bot.schedule.activeFrom, bot.schedule.activeTo, bot.schedule.timezone)) return 'fora do horário de funcionamento';
    const st = this.store.st(bot.id);
    const day = dayKey(bot.schedule.timezone);
    if (!st.wa || st.wa.day !== day) st.wa = { day, sent: 0, firstSentAt: st.wa?.firstSentAt };
    const ramp = this.rampFactor(st.wa.firstSentAt);
    const maxPerHour = Math.max(1, Math.round(w.maxPerHour * ramp));
    const maxPerDay = Math.max(1, Math.round(w.maxPerDay * ramp));
    const now = Date.now();
    s.sentTimes = s.sentTimes.filter((t) => now - t < 3600000);
    // O aviso mostra sempre o limite que a pessoa configurou (w.maxPerHour/maxPerDay); quem bloqueia de
    // fato, nos primeiros dias, é o limite mais baixo do aquecimento (maxPerHour/maxPerDay ramped acima).
    if (s.sentTimes.length >= maxPerHour) return `limite de ${w.maxPerHour} mensagens por hora${ramp < 1 ? ' (número em fase de aquecimento, sobe aos poucos)' : ''}`;
    if (st.wa.sent >= maxPerDay) return `limite de ${w.maxPerDay} mensagens por dia${ramp < 1 ? ' (número em fase de aquecimento, sobe aos poucos)' : ''}`;
    return '';
  }

  count(bot, s) {
    s.sentTimes.push(Date.now());
    const st = this.store.st(bot.id);
    if (!st.wa.firstSentAt) st.wa.firstSentAt = Date.now();
    st.wa.sent++;
    // A cada ~6 mensagens, uma pausa mais longa e aleatória — quebra o ritmo "metrônomo" de robô.
    s.sinceLongPause = (s.sinceLongPause || 0) + 1;
    if (s.sinceLongPause >= 5 + Math.floor(Math.random() * 3)) {
      s.sinceLongPause = 0;
      s.extraPauseMs = Math.round(rnd(180000, 480000) * scale()); // 3 a 8 minutos
    }
    this.store.saveState();
  }

  // Chamado pelo motor depois que a oferta foi publicada no Telegram.
  enqueue(bot, { html, image }) {
    const w = bot.whatsapp;
    if (!w || !w.enabled || !w.accepted || !w.groupIds.length || !ensureChannels(bot).whatsapp) return;
    const s = this.sessions.get(bot.id);
    if (!s || s.state !== 'open') {
      this.log(bot.id, 'warn', 'desconectado: a oferta não foi enviada ao WhatsApp. Reconecte na página do afiliado.');
      return;
    }
    if (s.queue.length >= 20) return;
    s.queue.push({ text: toWhatsapp(html), image: w.includeImage ? image : '', at: Date.now() });
    this.work(bot.id).catch(() => {});
  }

  async sendOne(bot, s, jid, item) {
    try {
      await s.handle.typing(jid, Math.round(rnd(1500, 4000) * scale()));
      if (item.image) {
        try {
          await s.handle.sendImage(jid, item.image, item.text);
        } catch {
          await s.handle.sendText(jid, item.text); // imagem indisponível: manda só o texto
        }
      } else {
        await s.handle.sendText(jid, item.text);
      }
      this.count(bot, s);
      s.fails = 0;
      return true;
    } catch (e) {
      s.fails++;
      this.log(bot.id, 'error', `falha ao enviar (${e.message}).`);
      return false;
    }
  }

  async work(id) {
    const s = this.sessions.get(id);
    if (!s || s.working) return;
    s.working = true;
    try {
      while (s.queue.length) {
        const bot = this.store.getBot(id);
        const w = bot?.whatsapp;
        if (!bot || !w?.enabled || s.state !== 'open' || !s.handle || !plan.isActive(bot)) {
          s.queue.length = 0;
          break;
        }
        const item = s.queue.shift();
        if (Date.now() - item.at > 3 * 3600000) continue; // oferta velha demais
        for (const jid of w.groupIds) {
          const why = this.canSend(bot, s);
          if (why) {
            this.log(id, 'warn', `oferta não enviada ao WhatsApp (${why}).`);
            break;
          }
          if (await this.sendOne(bot, s, jid, item)) this.log(id, 'ok', 'oferta enviada ao grupo de WhatsApp.');
          if (s.fails >= 5) break;
          const gapMs = rnd(w.minGapSec, w.minGapSec * 1.6) * 1000 + (s.extraPauseMs || 0);
          s.extraPauseMs = 0;
          await wait(gapMs);
        }
        if (s.fails >= 5) {
          s.queue.length = 0;
          w.enabled = false;
          this.store.saveConfig();
          s.error = 'Pausado após 5 falhas seguidas, para proteger o número.';
          this.log(id, 'error', 'envio pausado após 5 falhas seguidas, para proteger o número. Reative depois de conferir a conexão.');
          break;
        }
      }
    } finally {
      s.working = false;
    }
  }

  // Nome do perfil do chip do robô: é o que aparece nas postagens do grupo (o WhatsApp limita a 25 caracteres).
  async setProfileName(bot, raw) {
    const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Digite o nome que deve aparecer nas postagens.');
    if ([...name].length > 25) throw new Error('O WhatsApp aceita no máximo 25 caracteres no nome.');
    const s = this.sessions.get(bot.id);
    if (!s || s.state !== 'open' || !s.handle) throw new Error('O WhatsApp ainda não está conectado.');
    if (typeof s.handle.updateProfileName !== 'function') throw new Error('Esta versão do módulo do WhatsApp não consegue trocar o nome.');
    await s.handle.updateProfileName(name);
    bot.whatsapp.displayName = name;
    this.store.saveConfig();
    return { ok: true, name, message: `Pronto! As próximas postagens vão aparecer como "${name}".` };
  }

  async sendTest(bot) {
    const s = this.sessions.get(bot.id);
    if (!s || s.state !== 'open' || !s.handle) throw new Error('O WhatsApp ainda não está conectado.');
    const ids = bot.whatsapp.groupIds;
    if (!ids.length) throw new Error('Adicione primeiro o seu grupo de WhatsApp (onde o robô vai postar).');
    if (Date.now() - (s.lastTestAt || 0) < 30000 * scale()) throw new Error('Aguarde alguns segundos antes de testar de novo.');
    s.lastTestAt = Date.now();
    for (const jid of ids) await s.handle.sendText(jid, `✅ Conexão OK! O robô de ofertas "${bot.name}" está ligado a este grupo.`);
    return { ok: true, message: `Mensagem de teste enviada a ${ids.length} grupo(s) de WhatsApp.` };
  }

  async disconnect(id, { removeFiles = true } = {}) {
    const s = this.sessions.get(id);
    if (s) {
      s.closing = true;
      clearTimeout(s.retry);
      s.queue.length = 0;
      if (s.handle) {
        await s.handle.logout().catch(() => {});
        s.handle.close();
      }
      this.sessions.delete(id);
    }
    if (removeFiles) fs.rmSync(this.dir(id), { recursive: true, force: true });
  }

  // Ao iniciar o servidor, religa as sessões que já estavam conectadas.
  async resumeAll() {
    for (const bot of this.store.bots) {
      if ((bot.whatsapp?.enabled || bot.whatsapp?.sources?.length) && this.hasCreds(bot.id) && this.installed()) {
        await this.start(bot).catch((e) => this.log(bot.id, 'error', e.message));
        await sleep(1500);
      }
    }
  }
}

module.exports = { WhatsApp };
