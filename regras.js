import { marca, politica, segmentos, MARCADOR_PENDENTE, temPendencia } from './config.js';
import { ofertaPorId, ofertaTemPendencia } from './sinais.js';
import { contemTermo, contraste, normalizar } from './util.js';
import { LIMITES_SLIDE } from './formatos.js';

/** Padrões de números financeiros que só podem vir do catálogo oficial, nunca da IA. */
const NUMEROS_FINANCEIROS = [
  { regex: /\d\s*%|%\s*\d|\bpor\s*cento\b/i, descricao: 'percentual' },
  { regex: /R\$\s*\d|\d[\d.,]*\s*reais\b/i, descricao: 'valor em reais' },
  { regex: /\d[\d.,]*\s*%?\s*(a\.\s?[ma]\.|ao\s+m[eê]s\b|ao\s+ano\b)/i, descricao: 'taxa ao mês ou ao ano' },
  { regex: /\b(cet|cdi|selic|juros?)\b[^.\n]{0,20}\d/i, descricao: 'taxa ou indexador com número' },
  { regex: /\bsem\s+juros\b/i, descricao: 'condição de parcelamento' },
];

function resultado(id, nome, ok, severidade, detalhe) {
  return { id, nome, ok, severidade: ok ? null : severidade, detalhe };
}

function textosDaIa(textos) {
  return {
    titulo: textos.titulo || '',
    subtitulo: textos.subtitulo || '',
    'chamada da arte': textos.cta_arte || '',
    legenda: textos.legenda || '',
    hashtags: (textos.hashtags || []).join(' '),
    ...Object.fromEntries(
      (textos.slides || []).flatMap((s, i) => [
        [`slide ${i + 2} (título)`, s.titulo || ''],
        [`slide ${i + 2} (texto)`, s.texto || ''],
      ]),
    ),
    ...(textos.fechamento !== undefined ? { fechamento: textos.fechamento || '' } : {}),
  };
}

/**
 * Avalia a peça contra a política. Cada resultado traz ok, severidade (bloqueio | alerta) e detalhe.
 * bloqueio: nem humano publica sem corrigir. alerta: exige revisão humana.
 */
export function avaliarRegras({ textos, categoriaId, segmentoId, ofertaId, arte, hoje, modoPublicacao }) {
  const r = [];
  const l = politica.limites;
  const categoria = politica.categorias[categoriaId];
  const campos = textosDaIa(textos);
  const tudo = Object.values(campos).join('\n');

  r.push(resultado('categoria_valida', 'Categoria prevista na política', Boolean(categoria), 'bloqueio',
    categoria ? categoria.nome : `Categoria "${categoriaId}" não existe em politica.json.`));

  const vazios = ['titulo', 'subtitulo', 'cta_arte', 'legenda'].filter((c) => !String(textos[c] || '').trim());
  (textos.slides || []).forEach((s, i) => {
    if (!String(s.titulo || '').trim() || !String(s.texto || '').trim()) vazios.push(`slide ${i + 2}`);
  });
  if (textos.fechamento !== undefined && !String(textos.fechamento || '').trim()) vazios.push('fechamento');
  r.push(resultado('campos_obrigatorios', 'Textos obrigatórios preenchidos', vazios.length === 0, 'bloqueio',
    vazios.length ? `Faltando: ${vazios.join(', ')}.` : 'Título, subtítulo, chamada e legenda presentes.'));

  const excessos = [];
  if ((textos.titulo || '').length > l.titulo_max) excessos.push(`título com ${textos.titulo.length} de ${l.titulo_max}`);
  if ((textos.subtitulo || '').length > l.subtitulo_max) excessos.push(`subtítulo com ${textos.subtitulo.length} de ${l.subtitulo_max}`);
  if ((textos.cta_arte || '').length > l.cta_max) excessos.push(`chamada com ${textos.cta_arte.length} de ${l.cta_max}`);
  if ((textos.legenda || '').length > l.legenda_max) excessos.push(`legenda com ${textos.legenda.length} de ${l.legenda_max}`);
  if ((textos.hashtags || []).length > l.hashtags_max) excessos.push(`${textos.hashtags.length} hashtags de ${l.hashtags_max}`);
  (textos.slides || []).forEach((s, i) => {
    if ((s.titulo || '').length > LIMITES_SLIDE.titulo) excessos.push(`título do slide ${i + 2} com ${s.titulo.length} de ${LIMITES_SLIDE.titulo}`);
    if ((s.texto || '').length > LIMITES_SLIDE.texto) excessos.push(`texto do slide ${i + 2} com ${s.texto.length} de ${LIMITES_SLIDE.texto}`);
  });
  if ((textos.fechamento || '').length > LIMITES_SLIDE.fechamento) excessos.push(`fechamento com ${textos.fechamento.length} de ${LIMITES_SLIDE.fechamento}`);
  r.push(resultado('limites_de_tamanho', 'Tamanhos dentro do limite', excessos.length === 0, 'alerta',
    excessos.length ? `Acima do limite: ${excessos.join('; ')}.` : 'Todos os textos dentro dos limites.'));

  const proibidos = politica.termos_proibidos.filter((t) => contemTermo(tudo, t));
  r.push(resultado('termos_proibidos', 'Sem termos proibidos', proibidos.length === 0, 'bloqueio',
    proibidos.length ? `Encontrado: ${proibidos.join(', ')}.` : 'Nenhum termo da lista apareceu.'));

  const numeros = [];
  for (const [campo, texto] of Object.entries(campos)) {
    for (const p of NUMEROS_FINANCEIROS) if (p.regex.test(texto)) numeros.push(`${p.descricao} em ${campo}`);
  }
  r.push(resultado('numeros_so_do_catalogo', 'Sem taxas, valores ou rendimentos escritos pela IA', numeros.length === 0, 'bloqueio',
    numeros.length ? `A IA escreveu ${numeros.join('; ')}.` : 'A IA não escreveu taxas, valores nem condições.'));

  const nomeProprio = normalizar(marca.nome);
  const citados = politica.concorrentes.filter((c) => normalizar(c) !== nomeProprio && contemTermo(tudo, c));
  r.push(resultado('sem_concorrentes', 'Sem citar bancos, corretoras ou marcas', citados.length === 0, 'bloqueio',
    citados.length ? `Citado: ${citados.join(', ')}.` : 'Nenhuma marca da lista citada.'));

  const estilo = (politica.padroes_estilo_ia || []).filter((p) => new RegExp(p.regex, 'i').test(tudo)).map((p) => p.descricao);
  r.push(resultado('estilo_de_texto', 'Sem vícios de texto gerado por IA', estilo.length === 0, 'alerta',
    estilo.length ? `Encontrado: ${estilo.join('; ')}.` : 'Nenhum padrão da lista apareceu.'));

  const segmento = segmentos.find((s) => s.id === segmentoId);
  const protege = categoria?.exige_oferta === 'credito' && politica.segmentacao?.credito_bloqueia_vulneraveis;
  const segmentoOk = Boolean(segmento) && !(protege && segmento.vulneravel);
  r.push(resultado('segmento_permitido', 'Segmento permitido para a categoria', segmentoOk, 'bloqueio',
    !segmento
      ? `Segmento "${segmentoId}" não existe em segmentos.json.`
      : protege && segmento.vulneravel
        ? `Oferta de crédito direcionada a público protegido (${segmento.nome}).`
        : segmento.nome));

  if (categoria?.exige_oferta) {
    const oferta = ofertaPorId(ofertaId);
    const problemas = [];
    if (!oferta) problemas.push('nenhuma oferta do catálogo vinculada');
    else {
      if (oferta.ativa !== true) problemas.push('oferta inativa');
      if (oferta.tipo !== categoria.exige_oferta) problemas.push(`oferta do tipo ${oferta.tipo}, esperado ${categoria.exige_oferta}`);
      if (oferta.validade && oferta.validade < hoje) problemas.push(`oferta vencida em ${oferta.validade}`);
    }
    r.push(resultado('oferta_do_catalogo', 'Oferta vinculada ao catálogo oficial', problemas.length === 0, 'bloqueio',
      problemas.length ? `${problemas.join('; ')}.` : `${oferta.produto}, válida até ${oferta.validade || 'sem data'}.`));

    const avisos = categoria.avisos_obrigatorios || [];
    const faltando = oferta ? avisos.filter((a) => !normalizar(oferta.texto_legal).includes(normalizar(a))) : avisos;
    r.push(resultado('avisos_legais', 'Avisos legais obrigatórios presentes', faltando.length === 0, 'bloqueio',
      faltando.length ? `Faltando no texto legal: ${faltando.join('; ')}.` : 'Texto legal com todos os avisos exigidos.'));
  }

  const pendentes = [];
  if (temPendencia(marca)) pendentes.push('marca.json');
  if (categoria?.exige_oferta && ofertaTemPendencia(ofertaPorId(ofertaId) || {})) pendentes.push('oferta vinculada');
  if (tudo.includes(MARCADOR_PENDENTE)) pendentes.push('textos da peça');
  r.push(resultado('dados_validados', 'Sem dados pendentes de validação', pendentes.length === 0,
    modoPublicacao === 'real' ? 'bloqueio' : 'alerta',
    pendentes.length ? `${MARCADOR_PENDENTE} em: ${pendentes.join(', ')}.` : 'Configuração completa.'));

  if (arte) {
    const razao = contraste(marca.cores.primaria, marca.cores.texto_sobre_primaria);
    const problemas = [];
    if (arte.ajustes?.transbordou) problemas.push('texto não coube no espaço previsto');
    if (razao < 4.5) problemas.push(`contraste ${razao.toFixed(1)}:1 abaixo de 4,5:1`);
    r.push(resultado('legibilidade_da_arte', 'Arte legível', problemas.length === 0, 'alerta',
      problemas.length ? `${problemas.join('; ')}.` : `Contraste ${razao.toFixed(1)}:1 e texto dentro do espaço.`));
  }

  return r;
}
