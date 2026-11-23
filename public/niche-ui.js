'use strict';
// Seletor de nichos: botões de escolha (até 6) que alimentam o campo escondido search.niches.
(function () {
  const MAX = 6;
  // Assuntos com foto; os demais aparecem com o emoji.
  const PHOTO = { 'cama-mesa-banho': 'cama', cozinha: 'cozinha', beleza: 'beleza', celulares: 'tech' };
  window.initNiches = function initNiches(mount, niches) {
    mount.textContent = '';
    const input = h('input', { type: 'hidden', 'data-path': 'search.niches', 'data-type': 'lines' });
    const grid = h('div', { class: 'nichos' });
    const note = h('div', { class: 'sub nichonote' });
    const buttons = new Map();

    const chosen = () => input.value.split(',').map((x) => x.trim()).filter(Boolean);
    function paint() {
      const sel = new Set(chosen());
      buttons.forEach((b, id) => {
        b.classList.toggle('on', sel.has(id));
        b.setAttribute('aria-pressed', sel.has(id) ? 'true' : 'false');
      });
      if (!sel.size) note.textContent = 'Nenhum nicho escolhido: o robô vai postar de tudo um pouco (variedades).';
      else {
        const names = niches.filter((n) => sel.has(n.id)).map((n) => n.name);
        note.textContent = `O robô vai postar só sobre: ${names.join(' + ')}.`;
      }
    }

    niches.forEach((n) => {
      const photo = PHOTO[n.id];
      const b = h('button', { type: 'button', class: photo ? 'nicho photo' : 'nicho', title: `Ex.: ${n.sample.join(', ')}`, 'aria-pressed': 'false' }, h('span', { class: 'e' }, n.emoji), h('span', {}, n.name));
      if (photo) b.style.backgroundImage = `url(/static/img/${photo}.png)`;
      b.addEventListener('click', () => {
        const sel = chosen();
        const i = sel.indexOf(n.id);
        if (i >= 0) sel.splice(i, 1);
        else if (sel.length >= MAX) { toast(`Escolha no máximo ${MAX} nichos.`, 'err'); return; }
        else sel.push(n.id);
        input.value = sel.join(', ');
        paint();
      });
      buttons.set(n.id, b);
      grid.append(b);
    });

    mount.append(input, grid, note);
    paint();
    // Sempre que a página preenche os campos (abrir, salvar), os botões acompanham.
    const root = mount.closest('[id]') || document;
    document.addEventListener('filled', paint);
    return { paint, root };
  };
})();
