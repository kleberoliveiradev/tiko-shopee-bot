'use strict';
// Driver NÃO OFICIAL do WhatsApp (biblioteca Baileys, que simula o WhatsApp Web).
// A biblioteca é opcional: só é carregada quando alguém liga o módulo, e o site funciona sem ela.
// Contrato (o mesmo do driver falso dos testes):
//   onState('connecting' | 'open' | 'closed' | 'logged_out', info)
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const noop = () => {};
const silent = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child() { return silent; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Onde a biblioteca pode estar: primeiro a pasta persistente (sobrevive às atualizações do site), depois node_modules normal.
function libRoots() {
  const data = process.env.DATA_DIR || '/data';
  return [
    process.env.WA_LIB_DIR,
    path.join(data, 'wa-lib', 'node_modules'),
    path.join(__dirname, '..', 'node_modules'),
    '/app/node_modules',
    '/node_modules',
  ].filter(Boolean);
}

function findLib() {
  for (const root of libRoots()) {
    const pkgFile = path.join(root, '@whiskeysockets', 'baileys', 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      return path.join(path.dirname(pkgFile), pkg.main || 'lib/index.js');
    } catch { /* tenta o próximo */ }
  }
  return null;
}

function available() {
  return !!findLib();
}

async function createSession({ dir, onState, onMessage = noop, log = noop }) {
  let B;
  try {
    const entry = findLib();
    if (!entry) throw new Error('ausente');
    B = await import(pathToFileURL(entry).href);
  } catch {
    throw new Error('O módulo do WhatsApp não está instalado neste servidor.');
  }
  const makeWASocket = B.makeWASocket || B.default;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await B.useMultiFileAuthState(dir);
  let version;
  try {
    ({ version } = await B.fetchLatestBaileysVersion());
  } catch { /* usa a versão embutida */ }

  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    browser: B.Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    logger: silent,
  });

  // Depois que esta conexão é encerrada (por nós ou pelo WhatsApp), nenhum aviso dela deve chegar ao gerenciador:
  // um aviso atrasado de uma conexão antiga derrubava a conexão nova que acabava de gerar o código.
  let dead = false;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (dead) return;
    const { connection, lastDisconnect, qr } = u;
    // O código só pode ser pedido depois que o WhatsApp mostra o QR (conexão pronta para autenticar).
    if (qr) readyResolve();
    if (connection === 'connecting') onState('connecting');
    if (connection === 'open') onState('open', { phone: String(sock.user?.id || '').split(':')[0].split('@')[0] });
    if (connection === 'close') {
      dead = true;
      const code = lastDisconnect?.error?.output?.statusCode;
      const registered = !!state.creds.registered;
      log(`conexão fechada (código ${code ?? '?'})`);
      onState(code === B.DisconnectReason.loggedOut ? 'logged_out' : 'closed', { code, registered });
    }
  });

  // Só escuta: entrega o texto das mensagens de grupo. Nada é enviado, nem confirmação de leitura.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages || []) {
      try {
        const jid = m.key?.remoteJid;
        if (!jid || !jid.endsWith('@g.us') || m.key.fromMe || !m.message) continue;
        const c = (B.normalizeMessageContent ? B.normalizeMessageContent(m.message) : m.message) || {};
        const text = c.conversation || c.extendedTextMessage?.text || c.imageMessage?.caption || c.videoMessage?.caption || '';
        if (text) onMessage({ jid, text, ts: Number(m.messageTimestamp) * 1000 || Date.now() });
      } catch { /* mensagem estranha: ignora */ }
    }
  });

  return {
    async requestPairingCode(phone) {
      await Promise.race([ready, sleep(20000)]);
      if (dead) throw new Error('A conexão com o WhatsApp caiu antes de gerar o código. Tente de novo.');
      if (state.creds.registered) throw new Error('Este número já está conectado.');
      const raw = await sock.requestPairingCode(phone);
      return String(raw).replace(/(.{4})(.{4})/, '$1-$2');
    },
    async listGroups() {
      const all = await sock.groupFetchAllParticipating();
      return Object.values(all).map((g) => ({ id: g.id, name: g.subject || g.id, size: g.participants?.length || 0 }));
    },
    async inviteInfo(code) {
      const g = await sock.groupGetInviteInfo(code);
      return { id: g.id, name: g.subject || g.id, size: g.size || g.participants?.length || 0 };
    },
    async joinGroup(code) {
      try {
        return await sock.groupAcceptInvite(code);
      } catch (e) {
        if (/already|conflict|409/i.test(String(e.message || e.output?.statusCode))) return null; // já era participante
        throw e;
      }
    },
    async typing(jid, ms) {
      try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate('composing', jid);
        await sleep(ms);
        await sock.sendPresenceUpdate('paused', jid);
      } catch { /* presença é só um detalhe de naturalidade */ }
    },
    async updateProfileName(name) { await sock.updateProfileName(name); },
    async sendText(jid, text) { await sock.sendMessage(jid, { text }); },
    async sendImage(jid, url, caption) { await sock.sendMessage(jid, { image: { url }, caption }); },
    async logout() {
      dead = true;
      try { await sock.logout(); } catch { /* já desconectado */ }
    },
    close() {
      dead = true;
      try { sock.end(undefined); } catch { /* ignora */ }
    },
  };
}

module.exports = { createSession, available };
