'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erro ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(msg, kind) {
    const box = $('#toast');
    const el = h('div', { class: kind === 'err' ? 'err' : '' }, msg);
    box.append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
  }

  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function setPath(o, p, v) {
    const keys = p.split('.');
    let cur = o;
    keys.slice(0, -1).forEach((k) => { cur = cur[k] ??= {}; });
    cur[keys.at(-1)] = v;
  }

  // Preenche inputs marcados com data-path a partir do objeto do robô.
  function fill(root, data) {
    $$('[data-path]', root).forEach((el) => {
      const v = getPath(data, el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.dataset.type === 'lines') el.value = (v || []).join(el.tagName === 'TEXTAREA' ? '\n' : ', ');
      else if (el.dataset.secret !== undefined) {
        el.value = '';
        const base = el.dataset.path.replace(/\.[^.]+$/, '');
        const set = getPath(data, `${base}.${el.dataset.set}`);
        const hint = getPath(data, `${base}.${el.dataset.hint}`);
        el.placeholder = set ? `${hint} · já salvo (deixe vazio para manter)` : el.dataset.empty || '';
      } else el.value = v ?? '';
    });
    root.dispatchEvent(new Event('filled', { bubbles: true }));
  }

  // Lê os inputs e monta o objeto aninhado para enviar ao servidor.
  function collect(root) {
    const out = {};
    $$('[data-path]', root).forEach((el) => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.dataset.type === 'lines') v = el.value;
      else if (el.dataset.type === 'number') {
        if (el.value === '') return;
        v = Number(el.value);
      } else v = el.value;
      setPath(out, el.dataset.path, v);
    });
    return out;
  }

  const fmtTime = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDateTime = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const brl = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function until(t) {
    const s = Math.round((t - Date.now()) / 1000);
    if (s <= 5) return 'agora';
    if (s < 90) return `em ${s}s`;
    const m = Math.round(s / 60);
    return m < 120 ? `em ${m} min` : `em ${Math.round(m / 60)} h`;
  }

  // Renderiza o HTML do Telegram (só <b> <i> <u> <s> <code>) sem usar innerHTML.
  function renderTg(el, html) {
    el.textContent = '';
    const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const re = /<(\/?)(b|i|u|s|code)>/gi;
    const stack = [];
    let cur = el;
    let last = 0;
    for (const m of html.matchAll(re)) {
      if (m.index > last) cur.append(document.createTextNode(dec(html.slice(last, m.index))));
      const tag = m[2].toLowerCase();
      if (m[1]) {
        if (stack.length && stack.at(-1).tag === tag) { stack.pop(); cur = stack.length ? stack.at(-1).el : el; }
      } else {
        const n = document.createElement(tag);
        cur.append(n); stack.push({ tag, el: n }); cur = n;
      }
      last = m.index + m[0].length;
    }
    if (last < html.length) cur.append(document.createTextNode(dec(html.slice(last))));
  }

  async function withBusy(btn, fn) {
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; }
  }

  function showMsg(box, text, ok) {
    box.hidden = false;
    box.className = `msg ${ok ? 'ok' : 'err'}`;
    box.textContent = text;
  }

  // Janela própria (prompt/confirm do navegador são bloqueados em navegadores embutidos).
  function ask({ title, text, input, value = '', okLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const field = input ? h('input', { type: 'text', value, maxlength: '60', placeholder: input }) : null;
      const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => close(field ? field.value.trim() || null : true) }, okLabel);
      const cancel = h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancelar');
      const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(null); } },
        h('div', { class: 'dlg card', role: 'dialog', 'aria-modal': 'true' }, h('h3', {}, title), text ? h('p', { class: 'sub' }, text) : null, field, h('div', { class: 'row end', style: 'margin-top:16px' }, cancel, ok)));
      const onKey = (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && field) ok.click(); };
      document.addEventListener('keydown', onKey);
      document.body.append(ov);
      (field || ok).focus();
      if (field) field.select();
    });
  }

  // Só aceita imagem https (a Shopee entrega as fotos por https); qualquer outra coisa vira o ícone padrão.
  const safeImg = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
  function offerRow(r) {
    const thumb = safeImg(r.image)
      ? h('img', { class: 'thumb', src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : h('span', { class: 'thumb' }, '🛍️');
    const price = r.price ? brl(r.price) + (r.discount ? ` · -${Math.round(r.discount)}%` : '') : '';
    return h('div', { class: 'item offer-row' }, thumb,
      h('span', { class: 'meta' }, h('b', {}, r.name), h('small', {}, [price, fmtDateTime(r.t)].filter(Boolean).join(' · '))),
      h('a', { href: r.link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Abrir link da oferta' }, '↗'));
  }

  Object.assign(window, { safeImg, offerRow, ask, $, $$, h, api, toast, fill, collect, fmtTime, fmtDateTime, brl, until, renderTg, withBusy, showMsg });
})();

/* Marca TIKO: troca o antigo ícone 🛒 + texto pelo logotipo vetorial e define o favicon. */
(function brandTiko() {
  function apply() {
    document.querySelectorAll('.brand').forEach((b) => {
      if (b.dataset.tiko) return;
      b.dataset.tiko = '1';
      [...b.childNodes].forEach((n) => { if (n.nodeType === 3 || (n.classList && n.classList.contains('logo'))) n.remove(); });
      const img = document.createElement('img');
      img.src = '/static/img/tiko-logo-dark.svg';
      img.alt = 'TIKO';
      img.className = 'brand-logo';
      img.style.cssText = 'height:34px;width:auto;display:block;flex:none';
      b.prepend(img);
    });
    if (!document.querySelector('link[rel~="icon"]')) {
      const l = document.createElement('link');
      l.rel = 'icon';
      l.type = 'image/svg+xml';
      document.head.appendChild(l);
      // Favicon = só o mascote (recorta o logotipo horizontal).
      fetch('/static/img/tiko-logo-dark.svg').then((r) => r.text()).then((t) => {
        const m = t.replace(/viewBox="[^"]*"/, 'viewBox="140 142.5 786.5 502.5"').replace(/<path id="p[KWO]"[^>]*\/>/g, '');
        l.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m);
      }).catch(() => {});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
