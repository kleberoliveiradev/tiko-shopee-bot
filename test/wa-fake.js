'use strict';
// Driver falso do WhatsApp, só para os testes (mesmo contrato do src/wa-baileys.js).
const fs = require('fs');
const path = require('path');

const sent = [];
const calls = [];
const ctl = {
  installed: true,
  failSend: false,
  failJoin: false,
  manualPair: false, // não conclui o pareamento sozinho (o teste conclui com finishPair)
  lateClose: false, // sessão antiga avisa 'closed' atrasado, como a biblioteca real faz
  finishPair: null,
  invites: { ABCDEFGHIJKLMNOP1234: { id: '120363000000000009@g.us', name: 'Promos do Zé', size: 300 }, QRSTUVWXYZABCDEF5678: { id: '120363000000000008@g.us', name: 'Outro grupo', size: 40 }, MEUGRUPOMEUGRUPO7777: { id: '120363000000000007@g.us', name: 'Meu grupo de ofertas', size: 12 } },
  groups: [{ id: '120363000000000001@g.us', name: 'Ofertas VIP', size: 50 }, { id: '120363000000000002@g.us', name: 'Família', size: 8 }],
};

const available = () => ctl.installed;

let listener = null;
const emit = (jid, text) => listener && listener({ jid, text, ts: Date.now() });

async function createSession({ dir, onState, onMessage }) {
  calls.push('create');
  listener = onMessage;
  fs.mkdirSync(dir, { recursive: true });
  setTimeout(() => onState('connecting'), 5);
  const stale = () => { if (ctl.lateClose) setTimeout(() => onState('closed', { code: 428, registered: false }), 10); };
  return {
    async requestPairingCode(phone) {
      calls.push(`pair:${phone}`);
      const finish = () => { fs.writeFileSync(path.join(dir, 'creds.json'), '{}'); onState('open', { phone }); };
      if (ctl.manualPair) ctl.finishPair = finish; else setTimeout(finish, 40);
      return 'ABCD-1234';
    },
    async listGroups() { return ctl.groups; },
    async inviteInfo(code) { const g = ctl.invites[code]; if (!g) throw new Error('item-not-found'); return g; },
    async joinGroup(code) { if (ctl.failJoin) throw new Error('forbidden'); calls.push(`join:${code}`); return ctl.invites[code].id; },
    async typing() {},
    async updateProfileName(name) { if (ctl.failSend) throw new Error('falha simulada'); calls.push(`name:${name}`); },
    async sendText(jid, text) { if (ctl.failSend) throw new Error('falha simulada'); sent.push({ jid, text, image: null }); },
    async sendImage(jid, url, caption) { if (ctl.failSend) throw new Error('falha simulada'); sent.push({ jid, text: caption, image: url }); },
    async logout() { calls.push('logout'); stale(); },
    close() { calls.push('close'); },
  };
}

module.exports = { createSession, available, sent, calls, ctl, emit };
