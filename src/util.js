'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Escrita atômica (arquivo temporário + rename) para nunca corromper os dados.
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const rid = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function minutesNow(tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function hhmm(s, def) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return def;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return def;
  return h * 60 + mi;
}

// Janela de horário em que o robô pode postar. from == to => 24h.
function inWindow(from, to, tz) {
  const a = hhmm(from, 0);
  const b = hhmm(to, 0);
  if (a === b) return true;
  const now = minutesNow(validTz(tz) ? tz : 'America/Sao_Paulo');
  return a < b ? now >= a && now < b : now >= a || now < b;
}

module.exports = { sleep, readJson, atomicWrite, rid, clampNum, validTz, inWindow, hhmm };
