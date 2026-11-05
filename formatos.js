/** Formatos de post, tipos de imagem e limites de texto dos slides. */

export const FORMATOS = { post: 'Post único', carrossel: 'Carrossel', flashcards: 'Flashcards', pista: 'Carrossel em pista', artigo: 'Artigo do LinkedIn' };
/** Formatos que só aparecem quando a política do perfil libera (em "formatos_extras"). */
export const FORMATOS_OPCIONAIS = ['artigo'];
export const VISUAIS = {
  ia: 'Imagem criada por IA',
  foto: 'Foto real de banco de imagens',
  banco: 'Foto do banco de imagens da marca',
  design: 'Só design, sem imagem',
};

/** Limites do artigo do LinkedIn: seções com intertítulo, conclusão, chamada final e o post de divulgação. */
export const LIMITES_ARTIGO = { secoes_min: 3, secoes_max: 6, intertitulo: 90, texto: 1600, conclusao: 700, chamada_final: 250, legenda: 1300 };

export const SLIDES_MIN = 3;
export const SLIDES_MAX = 10;
export const SLIDES_PADRAO = 6;

/** Limites dos textos de carrossel e flashcards (a capa usa os limites de título e subtítulo da política). */
export const LIMITES_SLIDE = { titulo: 60, texto: 240, fechamento: 90, legenda: 700 };

/** Valida as escolhas feitas no painel e devolve valores seguros. */
export function normalizarFormato({ formato, visual, num_slides } = {}) {
  const f = Object.hasOwn(FORMATOS, formato) ? formato : 'post';
  // O carrossel em pista é todo desenhado pelo sistema: a pista é a imagem.
  const v = f === 'pista' ? 'design' : Object.hasOwn(VISUAIS, visual) ? visual : 'ia';
  const n = Math.round(Number(num_slides));
  return {
    formato: f,
    visual: v,
    num_slides: f === 'post' || f === 'artigo' ? 1 : Number.isFinite(n) ? Math.min(SLIDES_MAX, Math.max(SLIDES_MIN, n)) : SLIDES_PADRAO,
  };
}

/** Peças antigas não têm formato nem visual: eram post único com imagem de IA. */
export const formatoDaPeca = (peca) => peca?.formato || 'post';
export const visualDaPeca = (peca) => peca?.visual || 'ia';

/**
 * Ajustes de layout que a equipe pode pedir no "Novo visual".
 * fundo "padrao" mantém o visual de cada tipo de imagem (capa clara, cartões em fundo escuro).
 */
export const DESIGN_PADRAO = { formas: 'normal', fundo: 'padrao', numeros_grandes: 'auto', contador: true, pontos: true, texto_maior: false };
export const OPCOES_DESIGN = {
  formas: ['nenhuma', 'poucas', 'normal'],
  fundo: ['padrao', 'claro', 'escuro'],
  numeros_grandes: ['auto', 'sim', 'nao'],
};

export function normalizarDesign(bruto = {}) {
  const design = { ...DESIGN_PADRAO };
  for (const [campo, opcoes] of Object.entries(OPCOES_DESIGN)) if (opcoes.includes(bruto?.[campo])) design[campo] = bruto[campo];
  for (const campo of ['contador', 'pontos', 'texto_maior']) if (typeof bruto?.[campo] === 'boolean') design[campo] = bruto[campo];
  // Cor de fundo pedida pela equipe (#RRGGBB). Sem ela, vale o degradê da marca.
  if (typeof bruto?.cor === 'string' && /^#[0-9a-f]{6}$/i.test(bruto.cor.trim())) design.cor = bruto.cor.trim().toUpperCase();
  return design;
}

/** Título que já traz numeração própria ("Passo 2", "Passos 4 e 5", "3.", "1)"). */
export const temNumeracaoPropria = (titulo = '') => /^\s*(passos?\s*\d|etapa\s*\d|\d+\s*[.)º°:–-]|#\s*\d)/i.test(String(titulo));
