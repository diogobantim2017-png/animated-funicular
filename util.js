/** Data de hoje (AAAA-MM-DD) no fuso informado. */
export function hojeNoFuso(fuso, data = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);
}

/** Verifica se um timestamp ISO cai no dia informado (AAAA-MM-DD) dentro do fuso. */
export function ehDoDia(isoTimestamp, dia, fuso) {
  if (!isoTimestamp) return false;
  return hojeNoFuso(fuso, new Date(isoTimestamp)) === dia;
}

/** Minúsculas e sem acentos, para comparar termos com segurança. */
export function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Procura um termo como palavra ou expressão inteira, ignorando acentos e caixa. */
export function contemTermo(texto, termo) {
  const alvo = normalizar(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${alvo}($|[^a-z0-9])`).test(normalizar(texto));
}

function luminancia(hex) {
  const limpo = hex.replace('#', '');
  const cheio = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16) / 255);
  const canal = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste WCAG entre duas cores hexadecimais. */
export function contraste(corA, corB) {
  const [a, b] = [luminancia(corA), luminancia(corB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

export function media(valores) {
  return valores.length ? valores.reduce((s, x) => s + x, 0) / valores.length : 0;
}
