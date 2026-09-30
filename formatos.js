/** Formatos de post, tipos de imagem e limites de texto dos slides. */

export const FORMATOS = { post: 'Post único', carrossel: 'Carrossel', flashcards: 'Flashcards' };
export const VISUAIS = { ia: 'Imagem criada por IA', foto: 'Foto real de banco de imagens', design: 'Só design, sem imagem' };

export const SLIDES_MIN = 3;
export const SLIDES_MAX = 10;
export const SLIDES_PADRAO = 6;

/** Limites dos textos de carrossel e flashcards (a capa usa os limites de título e subtítulo da política). */
export const LIMITES_SLIDE = { titulo: 60, texto: 240, fechamento: 90, legenda: 700 };

/** Valida as escolhas feitas no painel e devolve valores seguros. */
export function normalizarFormato({ formato, visual, num_slides } = {}) {
  const f = Object.hasOwn(FORMATOS, formato) ? formato : 'post';
  const v = Object.hasOwn(VISUAIS, visual) ? visual : 'ia';
  const n = Math.round(Number(num_slides));
  return {
    formato: f,
    visual: v,
    num_slides: f === 'post' ? 1 : Number.isFinite(n) ? Math.min(SLIDES_MAX, Math.max(SLIDES_MIN, n)) : SLIDES_PADRAO,
  };
}

/** Peças antigas não têm formato nem visual: eram post único com imagem de IA. */
export const formatoDaPeca = (peca) => peca?.formato || 'post';
export const visualDaPeca = (peca) => peca?.visual || 'ia';
