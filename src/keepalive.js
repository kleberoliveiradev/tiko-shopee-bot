'use strict';
// Mantém o servidor acordado na hospedagem: sem nenhum acesso por cerca de 1 minuto ela "congela" o servidor,
// e com ele o agendador e a conexão do WhatsApp. O robô chama o próprio endereço público de tempos em tempos.
// Só liga quando KEEPALIVE_URL está definida (ex.: https://meu-robo.ample.run).
const url = (process.env.KEEPALIVE_URL || '').replace(/\/+$/, '');
if (/^https:\/\//.test(url)) {
  const EVERY_MS = Number(process.env.KEEPALIVE_EVERY_MS) || 40000;
  let last = Date.now();
  const t = setInterval(async () => {
    const now = Date.now();
    const gap = now - last;
    last = now;
    if (gap > EVERY_MS * 3) console.log(`[keepalive] o servidor ficou parado por ~${Math.round(gap / 1000)}s`);
    try {
      await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'robo-keepalive' } });
    } catch { /* tenta de novo no próximo ciclo */ }
  }, EVERY_MS);
  t.unref();
  console.log(`[keepalive] ligado: ${url}/healthz a cada ${Math.round(EVERY_MS / 1000)}s`);
}
