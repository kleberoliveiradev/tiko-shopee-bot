'use strict';
// Cliente da Shopee Affiliate Open API (GraphQL).
// Autenticação: Authorization: SHA256 Credential=<AppId>, Timestamp=<unix s>, Signature=<sha256(AppId+Timestamp+corpo+Secret)>
const crypto = require('crypto');
const { sleep } = require('./util');

// Esperas (ms) entre tentativas quando a Shopee devolve erro passageiro.
const RETRY_WAITS = [1500, 3000, 5000, 8000, 12000, 15000];
const DEFAULT_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

class ShopeeError extends Error {
  constructor(message, code = 0, status = 0, raw = '') {
    super(message);
    this.name = 'ShopeeError';
    this.code = code;
    this.status = status;
    this.raw = raw || message;
  }
}

const FRIENDLY = {
  10000: 'A Shopee está instável neste momento (erro interno dela, passageiro).',
  10020: 'AppID/Secret inválidos, app desativado ou relógio do servidor fora de hora.',
  10030: 'Limite de requisições da Shopee atingido (o robô tenta de novo mais tarde).',
  10031: 'Acesso negado pela Shopee.',
  10032: 'ID de afiliado inválido.',
  10033: 'A conta de afiliado está congelada na Shopee.',
  10034: 'O ID de afiliado está em lista de bloqueio da Shopee.',
  10035: 'Esta conta ainda não tem acesso à Open API da Shopee. Solicite/ative o acesso no painel de afiliados (menu "Open API").',
  11001: 'Parâmetro inválido enviado à Shopee.',
};

// Campos pedidos por padrão. Se a Shopee rejeitar algum ("Cannot query field"), ele é removido automaticamente.
const NODE_FIELDS = [
  'itemId', 'shopId', 'productName', 'productLink', 'offerLink', 'imageUrl',
  'priceMin', 'priceMax', 'priceDiscountRate', 'sales', 'ratingStar', 'commissionRate', 'shopName',
];
const REQUIRED_FIELDS = new Set(['itemId', 'productName']);

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function normalize(n) {
  const rate = num(n.commissionRate);
  let image = String(n.imageUrl || '');
  if (image.startsWith('//')) image = `https:${image}`;
  return {
    itemId: String(n.itemId ?? ''),
    shopId: String(n.shopId ?? ''),
    name: String(n.productName || '').replace(/\s+/g, ' ').trim(),
    image,
    priceMin: num(n.priceMin),
    priceMax: num(n.priceMax),
    discount: Math.round(num(n.priceDiscountRate)),
    sales: Math.round(num(n.sales)),
    rating: num(n.ratingStar),
    commissionRate: rate <= 1 ? rate * 100 : rate, // "0.25" => 25%
    shopName: String(n.shopName || ''),
    productLink: String(n.productLink || ''),
    offerLink: String(n.offerLink || ''),
  };
}

class ShopeeClient {
  constructor({ appId, secret, apiUrl }) {
    this.appId = String(appId);
    this.secret = String(secret);
    this.url = apiUrl || process.env.SHOPEE_API_URL || DEFAULT_URL;
    this.fields = [...NODE_FIELDS];
    this.pageInfo = true;
    this.lastCall = 0;
    this.chain = Promise.resolve();
  }

  // Fila serial com intervalo mínimo entre chamadas (evita estourar o rate limit).
  throttle() {
    const gap = Number(process.env.SHOPEE_MIN_GAP_MS ?? 800);
    const run = this.chain.then(async () => {
      const wait = this.lastCall + gap - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async request(query) {
    let attempt = 0;
    for (;;) {
      await this.throttle();
      const body = JSON.stringify({ query });
      const ts = Math.floor(Date.now() / 1000);
      const signature = crypto.createHash('sha256').update(`${this.appId}${ts}${body}${this.secret}`).digest('hex');
      let res;
      let text;
      try {
        res = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(25000),
        });
        text = await res.text();
      } catch (e) {
        if (++attempt <= 3) {
          await sleep(1000 * attempt * attempt);
          continue;
        }
        throw new ShopeeError(`Falha de rede ao falar com a Shopee: ${e.cause?.code || e.message}`);
      }
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* resposta não-JSON */
      }
      const err = json?.errors?.[0];
      if (err) {
        const code = Number(err.extensions?.code) || 0;
        // 10000 (erro interno) e 10030 (limite) são passageiros: a Shopee costuma responder na tentativa seguinte.
        if ((code === 10000 || code === 10030) && attempt < RETRY_WAITS.length) {
          await sleep(RETRY_WAITS[attempt++] * (process.env.SHOPEE_RETRY_SCALE === undefined ? 1 : Number(process.env.SHOPEE_RETRY_SCALE)));
          continue;
        }
        const friendly = FRIENDLY[code];
        throw new ShopeeError(friendly ? `${friendly} [código ${code}]` : String(err.message || 'Erro da Shopee'), code, res.status, String(err.message || ''));
      }
      if (!res.ok || !json) {
        if (res.status >= 500 && ++attempt <= 3) {
          await sleep(1500 * attempt);
          continue;
        }
        throw new ShopeeError(`Resposta inesperada da Shopee (HTTP ${res.status}).`, 0, res.status);
      }
      return json.data;
    }
  }

  dropField(name) {
    if (name === 'pageInfo') {
      this.pageInfo = false;
      return true;
    }
    if (this.fields.includes(name) && !REQUIRED_FIELDS.has(name)) {
      this.fields = this.fields.filter((f) => f !== name);
      return true;
    }
    return false;
  }

  async searchProducts({ keyword = '', sortType = 2, listType = 0, page = 1, limit = 50, itemId, shopId } = {}) {
    for (let tries = 0; tries < 8; tries++) {
      const args = [];
      if (keyword) args.push(`keyword: ${JSON.stringify(String(keyword))}`);
      if (itemId && /^\d+$/.test(String(itemId))) args.push(`itemId: ${itemId}`);
      if (shopId && /^\d+$/.test(String(shopId))) args.push(`shopId: ${shopId}`);
      args.push(`sortType: ${Number(sortType) | 0}`, `listType: ${Number(listType) | 0}`, `page: ${Number(page) | 0}`, `limit: ${Number(limit) | 0}`);
      const q = `{ productOfferV2(${args.join(', ')}) { nodes { ${this.fields.join(' ')} } ${this.pageInfo ? 'pageInfo { page limit hasNextPage }' : ''} } }`;
      try {
        const data = await this.request(q);
        const r = data?.productOfferV2;
        const nodes = r?.nodes || [];
        return {
          products: nodes.map(normalize).filter((p) => p.itemId && p.name),
          hasNext: r?.pageInfo?.hasNextPage ?? nodes.length >= limit,
        };
      } catch (e) {
        const m = e instanceof ShopeeError ? /Cannot query field\s+"?(\w+)"?/i.exec(e.raw) : null;
        if (m && this.dropField(m[1])) continue;
        throw e;
      }
    }
    throw new ShopeeError('Não foi possível montar uma consulta aceita pela Shopee.');
  }

  async generateShortLink(originUrl, subIds = []) {
    const ids = subIds.filter(Boolean).slice(0, 5);
    const input = `originUrl: ${JSON.stringify(String(originUrl))}${ids.length ? `, subIds: ${JSON.stringify(ids)}` : ''}`;
    const data = await this.request(`mutation { generateShortLink(input: { ${input} }) { shortLink } }`);
    const link = data?.generateShortLink?.shortLink;
    if (!link || !/^https?:\/\//.test(link)) throw new ShopeeError('A Shopee não devolveu o link de afiliado.');
    return link;
  }

  // Teste de conexão: uma consulta mínima que exige credenciais válidas.
  async ping() {
    const { products } = await this.searchProducts({ keyword: '', sortType: 2, page: 1, limit: 1 });
    return { ok: true, sample: products[0]?.name || '' };
  }
}

module.exports = { ShopeeClient, ShopeeError, normalize };
