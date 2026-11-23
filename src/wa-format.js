'use strict';
// Converte o HTML do Telegram (<b>, <i>, <s>, <a>) para a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~).
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

function toWhatsapp(html) {
  let t = String(html || '');
  t = t.replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url, text) => {
    const clean = text.replace(/<[^>]+>/g, '').trim();
    return !clean || decode(clean) === decode(url) ? url : `${clean}: ${url}`;
  });
  t = t
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '_$2_')
    .replace(/<(s|strike|del)>([\s\S]*?)<\/\1>/gi, '~$2~')
    .replace(/<(code|pre)>([\s\S]*?)<\/\1>/gi, '```$2```')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(t).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { toWhatsapp };
