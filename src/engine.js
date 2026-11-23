'use strict';
const { ShopeeClient, ShopeeError } = require('./shopee');
const telegram = require('./telegram');
const { render } = require('./message');
const { sleep } = require('./util');
const { missingSetup, ensureSource, ensureSearch, ensureChannels } = require('./bots');
const { effectiveKeywords, matchesNiches, nicheNames } = require('./niches');
const { SHOPEE_HOST, fetchChannelLinks } = require('./source');
const plan = require('./plan');

const MAX_PAGE = 8;

// Erro passageiro (instabilidade da Shopee ou da rede): vale tentar de novo logo, sem esperar o intervalo inteiro.
const isTransient = (e) => e instanceof ShopeeError && ([10000, 10030].includes(e.code) || (e.code === 0 && e.status === 0) || e.status >= 500);
const QUICK_RETRY_MS = 3 * 60000;
const MAX_QUICK_RETRIES = 5;

const productUrl = (p) => p.productLink || `https://shopee.com.br/product/${p.shopId}/${p.itemId}`;
const shortName = (s) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);

function parseShopeeUrl(u) {
  let m = /shopee\.com(?:\.br)?\/(?:[\w-]+\/)*product\/(\d+)\/(\d+)/.exec(u);
  if (m) return { shopId: m[1], itemId: m[2] };
  m = /-i\.(\d+)\.(\d+)/.exec(u);
  if (m) return { shopId: m[1], itemId: m[2] };
  return null;
}

// Segue redirecionamentos de links curtos, mas só por hosts da Shopee (evita SSRF).
async function resolveShopeeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Link inválido: ${raw}`);
  }
  if (url.protocol !== 'https:' || !SHOPEE_HOST.test(url.hostname)) throw new Error(`Só aceito links da Shopee: ${raw}`);
  for (let hop = 0; hop < 5 && !parseShopeeUrl(url.href); hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(() => null);
    const loc = res?.headers.get('location');
    if (!loc) break;
    const next = new URL(loc, url);
    if (next.protocol !== 'https:' || !SHOPEE_HOST.test(next.hostname)) break;
    url = next;
  }
  return url.href;
}

function passes(p, f) {
  if (f.onlyWithImage && !p.image) return false;
  if (p.discount < f.minDiscount) return false;
  if (f.minRating && p.rating < f.minRating) return false;
  if (p.sales < f.minSales) return false;
  const price = p.priceMin || p.priceMax;
  if (f.minPrice && price < f.minPrice) return false;
  if (f.maxPrice && price > f.maxPrice) return false;
  if (f.minCommission && p.commissionRate < f.minCommission) return false;
  const lower = p.name.toLowerCase();
  if (f.blockWords?.some((w) => lower.includes(w))) return false;
  return true;
}

const RANKERS = {
  desconto: (a, b) => b.discount - a.discount || b.sales - a.sales,
  vendas: (a, b) => b.sales - a.sales || b.discount - a.discount,
  comissao: (a, b) => b.commissionRate - a.commissionRate || b.discount - a.discount,
  misto: (a, b) => score(b) - score(a),
};
const score = (p) => p.discount + Math.log10(p.sales + 1) * 10 + p.commissionRate * 2;

// No máximo 1 produto por loja por ciclo (variedade); completa se faltar.
function pickVaried(sorted, n) {
  const out = [];
  const shops = new Set();
  for (const p of sorted) {
    if (out.length >= n) break;
    if (p.shopId && shops.has(p.shopId)) continue;
    shops.add(p.shopId);
    out.push(p);
  }
  for (const p of sorted) {
    if (out.length >= n) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

class Engine {
  constructor(store) {
    this.store = store;
    this.running = new Set();
    this.clients = new Map();
    this.linkCache = new Map(); // link do canal → { shopId, itemId } | null
  }

  isRunning(id) { return this.running.has(id); }

  client(creds) {
    const key = `${creds.appId}:${creds.secret}`;
    let c = this.clients.get(key);
    if (!c) {
      c = new ShopeeClient(creds);
      this.clients.set(key, c);
      if (this.clients.size > 50) this.clients.delete(this.clients.keys().next().value);
    }
    return c;
  }

  async affiliateLink(bot, client, p, L) {
    const subIds = bot.shopee.subId ? [bot.shopee.subId] : [];
    try {
      return await client.generateShortLink(productUrl(p), subIds);
    } catch (e) {
      if (p.offerLink) {
        L('warn', `Conversão falhou (${e.message}); usando o link de oferta da própria API.`);
        return p.offerLink;
      }
      throw e;
    }
  }

  // Grupos de WhatsApp usados como fonte (o robô só lê). Conta só se o plano inclui WhatsApp.
  waSourceCount(bot) {
    return ensureChannels(bot).whatsapp ? (bot.whatsapp?.sources || []).length : 0;
  }

  // Links da Shopee que o robô viu nos grupos de WhatsApp nas últimas 24 h (mais novos primeiro).
  waLinks(bot) {
    if (!this.waSourceCount(bot)) return [];
    const ids = new Set(bot.whatsapp.sources.map((x) => x.id));
    const cutoff = Date.now() - 86400000;
    return (this.store.st(bot.id).waLinks || []).filter((l) => ids.has(l.g) && l.t > cutoff).map((l) => ({ post: 0, url: l.url }));
  }

  // Lê os canais-fonte e devolve produtos novos (já buscados na Shopee e aprovados nos filtros).
  async collectFromSources(bot, client, hist, L) {
    const src = ensureSource(bot);
    const out = { products: [], links: 0, lookups: 0, rejected: 0 };
    const waLinks = this.waLinks(bot);
    if (!src.channels.length && !waLinks.length) return out;
    const budget = Math.max(8, bot.schedule.postsPerCycle * 3);
    const cutoff = Date.now() - 86400000;
    hist.rejected ||= {};
    for (const [k, t] of Object.entries(hist.rejected)) if (t < cutoff) delete hist.rejected[k];

    const queue = [];
    for (const ch of src.channels) {
      try {
        const links = await fetchChannelLinks(ch, { pages: 2 });
        out.links += links.length;
        queue.push(links);
      } catch (e) {
        L('warn', `Canal @${ch}: ${e.message}`);
      }
    }
    if (waLinks.length) {
      out.links += waLinks.length;
      queue.push(waLinks);
    }
    // Intercala os canais (um link de cada por vez) para nenhum dominar o ciclo.
    const ordered = [];
    for (let i = 0; queue.some((q) => i < q.length); i++) for (const q of queue) if (i < q.length) ordered.push(q[i]);

    const found = new Set();
    let resolves = 0;
    let apiErrors = 0;
    for (const l of ordered) {
      if (out.lookups >= budget || resolves >= 40 || apiErrors >= 3) break;
      let ids = this.linkCache.get(l.url);
      if (ids === undefined) {
        resolves++;
        try {
          ids = parseShopeeUrl(await resolveShopeeUrl(l.url)) || null;
        } catch {
          ids = null;
        }
        this.linkCache.set(l.url, ids);
        if (this.linkCache.size > 2000) this.linkCache.delete(this.linkCache.keys().next().value);
      }
      if (!ids || hist.seen[ids.itemId] || hist.rejected[ids.itemId] || found.has(ids.itemId)) continue;
      found.add(ids.itemId);
      out.lookups++;
      try {
        const { products } = await client.searchProducts({ itemId: ids.itemId, shopId: ids.shopId, limit: 1 });
        const p = products.find((x) => x.itemId === ids.itemId);
        if (!p) {
          hist.rejected[ids.itemId] = Date.now();
          continue;
        }
        if (src.applyFilters && !passes(p, bot.filters)) {
          hist.rejected[ids.itemId] = Date.now();
          out.rejected++;
          continue;
        }
        out.products.push(p);
      } catch (e) {
        apiErrors++;
        L('warn', `Shopee não devolveu o produto ${ids.itemId}: ${e.message}`);
      }
    }
    return out;
  }

  // Teste da fonte: mostra quantos links a Shopee aparece no canal e um exemplo de produto.
  async testSource(bot, channels) {
    const client = this.client(bot.shopee);
    const result = [];
    for (const ch of channels) {
      try {
        const links = await fetchChannelLinks(ch, { pages: 1 });
        let sample = '';
        for (const l of links.slice(0, 3)) {
          try {
            const ids = parseShopeeUrl(await resolveShopeeUrl(l.url));
            if (!ids || !bot.shopee.appId || !bot.shopee.secret) continue;
            const { products } = await client.searchProducts({ itemId: ids.itemId, shopId: ids.shopId, limit: 1 });
            if (products[0]) { sample = products[0].name; break; }
          } catch { /* tenta o próximo link */ }
        }
        result.push({ channel: ch, ok: true, links: links.length, sample });
      } catch (e) {
        result.push({ channel: ch, ok: false, error: e.message });
      }
    }
    return result;
  }

  async publish(bot, p, link) {
    const html = render(bot.message.template, p, link);
    if (!ensureChannels(bot).telegram) { // robô só de WhatsApp
      this.wa?.enqueue(bot, { html, image: p.image });
      return 1;
    }
    const chats = bot.telegram.chatId.split(',').filter(Boolean);
    let ok = 0;
    let lastErr;
    for (const chat of chats) {
      try {
        await telegram.sendProduct(bot.telegram.token, chat, { image: p.image, html });
        ok++;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!ok) throw lastErr;
    this.wa?.enqueue(bot, { html, image: p.image }); // também posta no grupo de WhatsApp do cliente (não bloqueia o Telegram)
    return ok;
  }

  async runCycle(bot, { dryRun = false, manual = false } = {}) {
    if (this.running.has(bot.id)) throw new Error('O robô já está executando um ciclo agora.');
    this.running.add(bot.id);
    const { store } = this;
    const st = store.st(bot.id);
    const L = (lvl, msg) => store.log(bot.id, lvl, msg);
    const summary = { fetched: 0, eligible: 0, posted: 0, errors: 0, preview: [] };
    try {
      if (!dryRun && !plan.isActive(bot)) throw new Error('O plano está vencido ou ainda não foi ativado.');
      const miss = missingSetup(bot, { needTelegram: !dryRun });
      if (miss.length) throw new Error(`Falta configurar: ${miss.join(' e ')}.`);
      const interval = bot.schedule.intervalMinutes * 60000;
      if (!manual && !dryRun) st.nextRunAt = Date.now() + interval * (0.9 + Math.random() * 0.2);

      const client = this.client(bot.shopee);
      const src = ensureSource(bot);
      const hasSource = src.channels.length > 0 || this.waSourceCount(bot) > 0;
      const onlySource = hasSource && src.mode === 'only';
      ensureSearch(bot);
      const eff = effectiveKeywords(bot.search);
      const kws = eff.list.length ? eff.list : [''];
      const perCycle = onlySource ? 0 : Math.min(3, kws.length);
      const chosen = Array.from({ length: perCycle }, (_, i) => kws[(st.kwCursor + i) % kws.length]);
      const pool = new Map();
      const cursors = { ...st.pageCursor };

      const hist = store.hist(bot.id);
      const fromSource = await this.collectFromSources(bot, client, hist, L);
      summary.fetched += fromSource.lookups;

      let searchOk = 0;
      let lastSearchErr = null;
      for (const kw of chosen) {
        const key = kw || '*';
        let page = cursors[key] || 1;
        let gotAny = false;
        try {
          for (let n = 0; n < bot.search.pagesPerKeyword; n++) {
            const { products, hasNext } = await client.searchProducts({
              keyword: kw, sortType: bot.search.sortType, listType: bot.search.listType, page, limit: 50,
            });
            gotAny = true;
            summary.fetched += products.length;
            for (const p of products) if (!pool.has(p.itemId)) pool.set(p.itemId, { ...p, fromKw: kw });
            page++;
            if (!hasNext || !products.length) {
              page = 1;
              break;
            }
          }
          cursors[key] = page > MAX_PAGE ? 1 : page;
        } catch (e) {
          lastSearchErr = e;
          L('warn', `A busca "${kw || '(geral)'}" falhou: ${e.message}`);
        }
        if (gotAny) searchOk++;
      }
      // Uma busca que falha não derruba o ciclo; só é erro se NADA deu certo.
      if (chosen.length && !searchOk && !fromSource.products.length && lastSearchErr) throw lastSearchErr;
      if (!dryRun && perCycle && searchOk) {
        st.kwCursor = (st.kwCursor + perCycle) % kws.length;
        st.pageCursor = cursors;
      }

      const cutoff = Date.now() - bot.schedule.dedupeDays * 86400000;
      for (const [k, t] of Object.entries(hist.seen)) if (t < cutoff) delete hist.seen[k];

      const eligible = [...pool.values()].filter((p) => !hist.seen[p.itemId] && !fromSource.products.some((x) => x.itemId === p.itemId) && passes(p, bot.filters) && (eff.custom.has(String(p.fromKw).toLowerCase()) || matchesNiches(p.name, eff.niches)));
      eligible.sort(RANKERS[bot.search.ranking] || RANKERS.desconto);
      // Ofertas dos canais-fonte vêm primeiro (na ordem em que apareceram, as mais novas antes).
      const ranked = [...fromSource.products, ...eligible];
      summary.eligible = ranked.length;
      const picks = pickVaried(ranked, dryRun ? 10 : bot.schedule.postsPerCycle);

      const origem = [];
      if (this.waSourceCount(bot)) origem.push(`WhatsApp: ${this.waSourceCount(bot)} grupo(s) (${this.waLinks(bot).length} links vistos nas últimas 24 h)`);
      if (src.channels.length) origem.push(`canais: ${src.channels.map((c) => `@${c}`).join(', ')} (${fromSource.links} links, ${fromSource.products.length} aprovados, ${fromSource.rejected} barrados pelos filtros)`);
      if (eff.niches.length) origem.push(`nicho: ${nicheNames(eff.niches).join(' + ')}`);
      if (chosen.length) origem.push(`buscas: ${chosen.map((k) => k || '(geral)').join(', ')}`);
      L('info', `${dryRun ? 'Simulação' : 'Ciclo'} · ${origem.join(' · ')} · ${ranked.length} ofertas novas dentro dos filtros.`);
      if (!picks.length) L('warn', hasSource ? 'Nenhuma oferta nova nas fontes (canais ou grupos de WhatsApp). Veja se postam links da Shopee e se os filtros não estão rígidos demais.' : 'Nenhuma promoção nova passou nos filtros e no nicho escolhido. Afrouxe o desconto mínimo ou escolha mais um nicho.');

      for (let i = 0; i < picks.length; i++) {
        const p = picks[i];
        try {
          if (dryRun) {
            const link = p.offerLink || productUrl(p);
            summary.preview.push({ name: p.name, image: p.image, price: p.priceMin || p.priceMax, discount: p.discount, sales: p.sales, rating: p.rating, commissionRate: Math.round(p.commissionRate * 10) / 10, message: render(bot.message.template, p, link) });
            continue;
          }
          const link = await this.affiliateLink(bot, client, p, L);
          await this.publish(bot, p, link);
          hist.seen[p.itemId] = Date.now();
          hist.recent.unshift({ t: Date.now(), name: p.name, link, price: p.priceMin || p.priceMax, discount: p.discount, image: /^https:\/\//.test(p.image || '') ? p.image : '' });
          hist.recent.length = Math.min(hist.recent.length, 50);
          store.saveHistory();
          st.stats.posted++;
          st.stats.lastPostAt = Date.now();
          summary.posted++;
          L('ok', `Publicado: ${shortName(p.name)} (${p.discount}% off)`);
        } catch (e) {
          summary.errors++;
          st.stats.errors++;
          st.stats.lastError = e.message;
          L('error', `Falha ao publicar "${shortName(p.name)}": ${e.message}`);
        }
        if (!dryRun && i < picks.length - 1) await sleep(bot.schedule.delaySec * 1000);
      }
      if (!dryRun) {
        st.stats.cycles++;
        st.failStreak = 0;
      }
      return summary;
    } catch (e) {
      st.stats.errors++;
      st.stats.lastError = e.message;
      if (!manual && !dryRun && isTransient(e) && (st.failStreak || 0) < MAX_QUICK_RETRIES) {
        st.failStreak = (st.failStreak || 0) + 1;
        st.nextRunAt = Date.now() + QUICK_RETRY_MS;
        L('error', `${e.message} Vou tentar de novo em ${QUICK_RETRY_MS / 60000} minutos (tentativa ${st.failStreak} de ${MAX_QUICK_RETRIES}).`);
      } else {
        L('error', e.message);
      }
      throw e;
    } finally {
      this.running.delete(bot.id);
      if (!dryRun) st.stats.lastRunAt = Date.now();
      store.saveState();
    }
  }

  // Posta links específicos que o afiliado colar no painel.
  async postLinks(bot, urls) {
    if (this.running.has(bot.id)) throw new Error('O robô está executando um ciclo agora. Tente em instantes.');
    this.running.add(bot.id);
    const { store } = this;
    const L = (lvl, msg) => store.log(bot.id, lvl, msg);
    const results = [];
    try {
      const miss = missingSetup(bot);
      if (miss.length) throw new Error(`Falta configurar: ${miss.join(' e ')}.`);
      const client = this.client(bot.shopee);
      const subIds = bot.shopee.subId ? [bot.shopee.subId] : [];
      const hist = store.hist(bot.id);
      for (const raw of urls.slice(0, 5)) {
        try {
          const resolved = await resolveShopeeUrl(raw.trim());
          const ids = parseShopeeUrl(resolved);
          let product = null;
          if (ids) {
            const { products } = await client.searchProducts({ itemId: ids.itemId, shopId: ids.shopId, limit: 1 });
            product = products.find((p) => p.itemId === ids.itemId) || null;
          }
          const origin = ids ? `https://shopee.com.br/product/${ids.shopId}/${ids.itemId}` : resolved;
          const link = await client.generateShortLink(product ? productUrl(product) : origin, subIds);
          if (product) {
            await this.publish(bot, product, link);
            hist.seen[product.itemId] = Date.now();
            hist.recent.unshift({ t: Date.now(), name: product.name, link, price: product.priceMin || product.priceMax, discount: product.discount, image: /^https:\/\//.test(product.image || '') ? product.image : '' });
          } else {
            if (!ensureChannels(bot).telegram) throw new Error('Não achei esse produto na Shopee, e este robô não usa Telegram para avisos avulsos.');
            const chats = bot.telegram.chatId.split(',').filter(Boolean);
            for (const c of chats) await telegram.sendText(bot.telegram.token, c, `🛒 Confira essa oferta:\n${link}`);
            hist.recent.unshift({ t: Date.now(), name: '(link avulso)', link, price: 0, discount: 0 });
          }
          hist.recent.length = Math.min(hist.recent.length, 50);
          store.saveHistory();
          L('ok', `Link publicado: ${product ? shortName(product.name) : link}`);
          results.push({ url: raw, ok: true, link, name: product?.name || '' });
        } catch (e) {
          L('error', `Link "${raw}": ${e.message}`);
          results.push({ url: raw, ok: false, error: e.message });
        }
        await sleep(2000);
      }
      return results;
    } finally {
      this.running.delete(bot.id);
    }
  }

  async testShopee(creds) {
    const client = new ShopeeClient(creds); // cliente novo: testa exatamente o que foi digitado
    return client.ping();
  }

  async testTelegram(token, chatId, botName) {
    const me = await telegram.getMe(token);
    if (chatId) {
      for (const c of chatId.split(',').filter(Boolean)) await telegram.sendText(token, c, `✅ Conexão OK! O robô de ofertas "${botName}" está ligado a este grupo.`);
    }
    return { ok: true, username: me.username };
  }
}

module.exports = { Engine, passes, parseShopeeUrl };
