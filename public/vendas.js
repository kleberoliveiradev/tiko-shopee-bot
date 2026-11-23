(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ── QR de exemplo (ilustrativo)
  var qr = $('#qr');
  if (qr) {
    var n = 21, seed = 7, cells = '', fixed = {};
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    [[0, 0], [14, 0], [0, 14]].forEach(function (o) {
      for (var i = -1; i < 8; i++) for (var j = -1; j < 8; j++) {
        var x = o[0] + i, y = o[1] + j; if (x < 0 || y < 0 || x >= n || y >= n) continue;
        var on = i >= 0 && j >= 0 && i < 7 && j < 7 && (i === 0 || i === 6 || j === 0 || j === 6 || (i > 1 && i < 5 && j > 1 && j < 5));
        fixed[x + ',' + y] = on;
      }
    });
    for (var x = 0; x < n; x++) for (var y = 0; y < n; y++) {
      var k = x + ',' + y, v = k in fixed ? fixed[k] : rnd() < 0.5;
      if (v) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    qr.innerHTML = '<svg viewBox="0 0 21 21" shape-rendering="crispEdges" fill="currentColor">' + cells + '</svg>';
  }

  // ── Revelar ao rolar
  var rv = $$('.rv');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add('in'); });

  // ── Reiniciar animações SVG (nome + mascote) ao clicar
  function replay(img) {
    var base = img.getAttribute('src').split('?')[0];
    img.src = base + '?r=' + Date.now();
  }
  var mascot = $('#mascot'), navLogo = $('#navLogo');
  if (mascot) mascot.addEventListener('click', function () { replay($('#mascotImg')); });
  if (navLogo) navLogo.parentNode.addEventListener('click', function (e) {
    if (location.hash === '' || location.hash === '#topo') { e.preventDefault(); replay(navLogo); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  // ── Abas das ofertas
  var tabs = $$('.tab');
  function selectTab(t) {
    tabs.forEach(function (b) {
      var on = b === t;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      var p = document.getElementById(b.getAttribute('aria-controls'));
      if (p) p.hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(t); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var n = tabs[(i + d + tabs.length) % tabs.length];
      selectTab(n); n.focus(); e.preventDefault();
    });
  });

  // ── FAQ
  $$('.q button').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = b.parentNode, open = !q.classList.contains('open');
      q.classList.toggle('open', open);
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // ── Diálogo de aviso
  var dlg = $('#aviso');
  function aviso(t, msg) {
    $('#avisoT').textContent = t; $('#avisoP').textContent = msg;
    if (dlg && dlg.showModal) dlg.showModal(); else alert(msg);
  }
  var ok = $('#avisoOk');
  if (ok) ok.addEventListener('click', function () { dlg.close(); });
  if (dlg) dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  // ── Contato de vendas (WhatsApp)
  var wa = '';
  var ready = fetch('/api/site', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
    .then(function (j) { wa = (j && j.whatsapp) || ''; }).catch(function () {});

  function open(plano) {
    var txt = plano ? 'Olá! Quero testar o TIKO (plano ' + plano + ').' : 'Olá! Quero saber mais sobre o TIKO.';
    window.open('https://wa.me/' + wa + '?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  }
  $$('a[data-cta]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var plano = a.getAttribute('data-plan') || '';
      ready.then(function () {
        if (wa) open(plano);
        else aviso('Contato ainda não configurado', 'O número de WhatsApp de vendas ainda não foi definido neste site.');
      });
    });
  });

  var entrar = $('#btnEntrar');
  if (entrar) entrar.addEventListener('click', function () {
    aviso('Área do cliente', 'O acesso ao painel é feito pelo link exclusivo que você recebe ao contratar. Se perdeu o seu link, peça pelo WhatsApp de suporte.');
  });
})();
