'use strict';

// Modelo padrão (o formato aprovado pelo Kleber).
const DEFAULT_TEMPLATE = `{chamada}

🛍️ {titulo}

De <s>{preco_original}</s>
💸 Por <b>{preco}</b>

🔥<b>Compre aqui:</b> {link}

⚠️ <b>Promoção sujeita a alteração a qualquer momento.</b>`;

// Modelo antigo: robôs que ainda o usam são atualizados automaticamente para o novo.
const LEGACY_TEMPLATES = [`🔥 <b>{titulo}</b>

❌ De: <s>{preco_original}</s>
✅ Por: <b>{preco}</b>
🏷️ {desconto} OFF
⭐ {nota} · {vendas} vendidos

🛒 Compre aqui: {link}`];

const upgradeTemplate = (t) => (LEGACY_TEMPLATES.includes(String(t || '').replace(/\r/g, '').trim()) ? DEFAULT_TEMPLATE : t);

// Chamadas de abertura. A escolha é fixa por produto (mesmo produto, mesma chamada) e varia entre produtos.
const CHAMADAS = [
  'VAI ESGOTAR RÁPIDO 😲🔥',
  'APROVEITA ANTES QUE ACABE 🔥',
  'OLHA ESSE PREÇO 😍🔥',
  'ACHADO DO DIA 🛍️🔥',
  'PROMOÇÃO IMPERDÍVEL 😱',
  'CORRE QUE ESTÁ BARATO 💥',
];

const VARIABLES = {
  chamada: 'Frase de abertura em destaque (muda de produto para produto)',
  titulo: 'Nome do produto',
  preco: 'Preço atual (ou "a partir de")',
  preco_original: 'Preço antes do desconto (estimado)',
  desconto: 'Percentual de desconto, ex.: 42%',
  nota: 'Avaliação, ex.: 4.8',
  vendas: 'Quantidade vendida, ex.: 12,8 mil',
  loja: 'Nome da loja',
  link: 'Seu link de afiliado',
};

const SAMPLE_PRODUCT = {
  itemId: '1', shopId: '1', name: 'Fone de Ouvido Bluetooth Sem Fio com Cancelamento de Ruído', image: '',
  priceMin: 79.9, priceMax: 79.9, discount: 42, sales: 12850, rating: 4.8, commissionRate: 8,
  shopName: 'Loja Oficial', productLink: '', offerLink: '',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const brl = (n) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function compactCount(n) {
  if (!n) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')} mil`;
  return String(n);
}

function cut(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function buildVars(p, link, maxTitle) {
  const price = p.priceMin || p.priceMax || 0;
  const ranged = p.priceMax > p.priceMin && p.priceMin > 0;
  const original = p.discount > 0 && p.discount < 100 && p.priceMin > 0 ? p.priceMin / (1 - p.discount / 100) : 0;
  const seed = String(p.itemId || p.name || '');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return {
    chamada: CHAMADAS[h % CHAMADAS.length],
    titulo: esc(cut(p.name, maxTitle)),
    preco: price ? esc(`${ranged ? 'a partir de ' : ''}${brl(price)}`) : '',
    preco_original: original ? esc(brl(original)) : '',
    desconto: p.discount > 0 ? `${p.discount}%` : '',
    nota: p.rating > 0 ? esc(p.rating.toFixed(1)) : '',
    vendas: esc(compactCount(p.sales)),
    loja: esc(p.shopName || ''),
    link: esc(link || ''),
  };
}

// Linhas cujas variáveis estão vazias (ex.: sem nota) são removidas automaticamente.
function fill(template, vars) {
  const out = [];
  for (const line of String(template).replace(/\r/g, '').split('\n')) {
    let skip = false;
    const r = line.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      if (vars[k] === '') skip = true;
      return vars[k];
    });
    if (!skip) out.push(r);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const visibleLength = (html) => html.replace(/<[^>]+>/g, '').length;

// Legenda de foto no Telegram: máx. 1024 caracteres. Encurta o título até caber.
function render(template, product, link) {
  const tpl = String(upgradeTemplate(template) || DEFAULT_TEMPLATE).slice(0, 1500);
  let out = '';
  for (const maxTitle of [160, 110, 80, 50]) {
    out = fill(tpl, buildVars(product, link, maxTitle));
    if (visibleLength(out) <= 1000) break;
  }
  return out;
}

module.exports = { render, upgradeTemplate, DEFAULT_TEMPLATE, VARIABLES, SAMPLE_PRODUCT };
