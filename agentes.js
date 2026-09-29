import { env, marca, politica, segmentos } from './config.js';
import { proximosEventos, ofertasDisponiveis } from './sinais.js';

/** Categorias que o radar pode escolher hoje. Oferta sem catálogo ativo não entra. */
export function categoriasDisponiveis(hoje) {
  const ativas = ofertasDisponiveis(hoje);
  return Object.entries(politica.categorias)
    .filter(([, c]) => !c.exige_oferta || ativas.some((o) => o.tipo === c.exige_oferta))
    .map(([id, c]) => ({ id, nome: c.nome, risco: c.risco }));
}

function linhas(itens, formatar) {
  return itens.length ? itens.map((i) => `- ${formatar(i)}`).join('\n') : '- nenhum';
}

/* ------------------------------------------------------------------ radar */

export async function radar({ ia, hoje, historico, orientacao }) {
  const categorias = categoriasDisponiveis(hoje);
  const ativas = ofertasDisponiveis(hoje);
  const eventos = proximosEventos(hoje);

  if (orientacao?.categoria && !categorias.some((c) => c.id === orientacao.categoria)) {
    const nome = politica.categorias[orientacao.categoria]?.nome || orientacao.categoria;
    throw new Error(
      `A categoria "${nome}" não está disponível hoje. Categorias de oferta exigem uma oferta ativa em ofertas.json.`,
    );
  }

  const ferramenta = {
    name: 'propor_oportunidade',
    description: 'Registra a necessidade de comunicação mais relevante para o banco publicar agora.',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema do post em uma frase curta.' },
        categoria: { type: 'string', enum: categorias.map((c) => c.id) },
        gatilho: {
          type: 'string',
          enum: ['data_do_calendario', 'objetivo_do_banco', 'lacuna_no_historico', 'orientacao_da_equipe'],
        },
        sinal: {
          type: 'string',
          description: 'O sinal concreto que motivou a escolha, citando a data, o objetivo ou o histórico.',
        },
        justificativa: {
          type: 'string',
          description: 'Por que o tema importa para o cliente e para o banco agora, em até 3 frases.',
        },
        urgencia: { type: 'string', enum: ['baixa', 'media', 'alta'] },
        oferta_id: {
          type: 'string',
          enum: ['', ...ativas.map((o) => o.id)],
          description: 'Id da oferta do catálogo. Obrigatório só em categorias de oferta; vazio nos demais casos.',
        },
      },
      required: ['tema', 'categoria', 'gatilho', 'sinal', 'justificativa', 'urgencia', 'oferta_id'],
    },
  };

  const sistema = `Você é o radar de conteúdo do banco ${marca.nome}. Sua função é perceber qual necessidade de comunicação é mais relevante agora, usando apenas os sinais fornecidos.

Critérios, nesta ordem:
1. Proteger o cliente: em períodos de compras, festas, viagens e impostos, os golpes costumam aumentar.
2. Datas próximas do calendário, com antecedência suficiente para o conteúdo ser útil.
3. Objetivos de negócio do banco.
4. Variedade: evite repetir o tema ou a categoria que dominaram as últimas peças.

Não invente números, notícias, pesquisas ou tendências que não estejam nos sinais. Quando a equipe der uma orientação, ela tem prioridade.`;

  const conteudo = `Hoje: ${hoje} (fuso ${env.fuso})

Datas no radar:
${linhas(eventos, (e) => `${e.nome}: ${e.situacao}${e.data ? ` (${e.data})` : ''}${e.ate ? ` até ${e.ate}` : ''}. Temas sugeridos: ${e.temas.join(', ')}`)}

Objetivos do banco:
${linhas(marca.objetivos_de_negocio || [], (o) => o)}

Categorias disponíveis:
${linhas(categorias, (c) => `${c.id}: ${c.nome} (risco ${c.risco})`)}

Ofertas ativas no catálogo:
${linhas(ativas, (o) => `${o.id}: ${o.produto} (${o.tipo})`)}

Últimas peças, da mais recente para a mais antiga:
${linhas(historico, (p) => `${p.criada_em.slice(0, 10)} | ${p.categoria} | ${p.tema} | ${p.status}`)}

Orientação da equipe: ${orientacao?.texto?.trim() || 'nenhuma'}${orientacao?.categoria ? `\nCategoria pedida pela equipe: ${orientacao.categoria}` : ''}`;

  const r = await ia({ modelo: env.modeloIa, sistema, conteudo, ferramenta, maxTokens: 1200 });
  const dados = { ...r.dados };
  if (orientacao?.categoria) dados.categoria = orientacao.categoria;
  if (!politica.categorias[dados.categoria]?.exige_oferta) dados.oferta_id = '';
  return { dados, modelo: r.modelo, contexto: { eventos, categorias: categorias.map((c) => c.id) } };
}

/* ------------------------------------------------------------------ brief */

export function segmentosPermitidos(categoriaId) {
  const categoria = politica.categorias[categoriaId];
  const protegeVulneraveis = categoria?.exige_oferta === 'credito' && politica.segmentacao?.credito_bloqueia_vulneraveis;
  return segmentos.filter((s) => !(protegeVulneraveis && s.vulneravel));
}

export async function criarBrief({ ia, oportunidade, oferta }) {
  const permitidos = segmentosPermitidos(oportunidade.categoria);
  const estilos = Object.keys(marca.estilos_visuais);

  const ferramenta = {
    name: 'criar_brief',
    description: 'Registra o brief de um post de feed do Instagram.',
    input_schema: {
      type: 'object',
      properties: {
        objetivo: { type: 'string', description: 'O que o post precisa provocar no público, em uma frase.' },
        segmento_id: { type: 'string', enum: permitidos.map((s) => s.id) },
        insight: { type: 'string', description: 'O que esse público sente ou precisa em relação ao tema.' },
        mensagem_chave: { type: 'string', description: 'A ideia central do post, em uma frase.' },
        cta: { type: 'string', description: 'Ação concreta pedida ao público.' },
        kpi: { type: 'string', enum: ['alcance', 'salvamentos', 'compartilhamentos', 'comentarios', 'visitas_ao_perfil'] },
        estilo_visual: { type: 'string', enum: estilos },
        cena_visual: { type: 'string', description: 'Descrição da cena da imagem, em português, para a equipe revisar.' },
        prompt_imagem_en: {
          type: 'string',
          description: 'A mesma cena descrita em inglês, em 1 a 3 frases, sem estilo e sem restrições.',
        },
      },
      required: ['objetivo', 'segmento_id', 'insight', 'mensagem_chave', 'cta', 'kpi', 'estilo_visual', 'cena_visual', 'prompt_imagem_en'],
    },
  };

  const sistema = `Você é estrategista de conteúdo do banco ${marca.nome}. Transforme a oportunidade em um brief para um post de feed do Instagram (orgânico, formato 4:5).

Marca: ${marca.descricao}
Tom de voz: ${marca.tom_de_voz}
Valores: ${(marca.valores || []).join(', ')}

Regras:
- Escolha exatamente um segmento da lista.
- A cena precisa funcionar sem nenhum texto: nada de letreiros, telas com texto legível, documentos, logotipos, cédulas, moedas ou cartões.
- Use pessoas e lugares brasileiros reais, com diversidade e sem estereótipos. Prefira cenas simples, com um foco claro.
- A metade de baixo da imagem recebe um painel de texto. Coloque o assunto principal na metade de cima.
- Em prompt_imagem_en, descreva só a cena. O sistema acrescenta estilo, paleta e restrições.`;

  const conteudo = `Oportunidade escolhida pelo radar:
- Tema: ${oportunidade.tema}
- Categoria: ${politica.categorias[oportunidade.categoria].nome}
- Sinal: ${oportunidade.sinal}
- Justificativa: ${oportunidade.justificativa}
${oferta ? `- Produto em oferta: ${oferta.produto} (números e texto legal entram pelo template, não pelo brief)\n` : ''}
Segmentos permitidos:
${linhas(permitidos, (s) => `${s.id}: ${s.nome}. ${s.descricao}`)}

Estilos visuais aprovados: ${estilos.join(', ')}`;

  const r = await ia({ modelo: env.modeloIa, sistema, conteudo, ferramenta, maxTokens: 1500 });
  return { dados: r.dados, modelo: r.modelo };
}

/* ----------------------------------------------------------------- textos */

export async function escreverTextos({ ia, oportunidade, brief, segmento, oferta }) {
  const l = politica.limites;
  const ferramenta = {
    name: 'escrever_textos',
    description: 'Registra os textos da arte e da legenda do post.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: `Título da arte, até ${l.titulo_max} caracteres.` },
        subtitulo: { type: 'string', description: `Subtítulo da arte, até ${l.subtitulo_max} caracteres.` },
        cta_arte: { type: 'string', description: `Chamada curta que aparece no botão da arte, até ${l.cta_max} caracteres.` },
        legenda: { type: 'string', description: `Legenda do post, até ${l.legenda_max} caracteres, sem hashtags.` },
        hashtags: { type: 'array', items: { type: 'string' }, maxItems: l.hashtags_max },
      },
      required: ['titulo', 'subtitulo', 'cta_arte', 'legenda', 'hashtags'],
    },
  };

  const sistema = `Você é redator do banco ${marca.nome}. Escreva em português do Brasil, com acentuação completa.
Tom de voz: ${marca.tom_de_voz}

O título e o subtítulo vão na arte. A legenda vai no texto do post.

Regras verificadas automaticamente. Se você descumprir, a peça é bloqueada:
- Título até ${l.titulo_max} caracteres, subtítulo até ${l.subtitulo_max}, chamada da arte até ${l.cta_max}, legenda até ${l.legenda_max}, no máximo ${l.hashtags_max} hashtags.
- Não escreva percentuais, valores em reais, taxas, prazos de pagamento ou rendimentos. Quando há oferta, o sistema insere os dados oficiais e o texto legal.
- Não use estes termos: ${politica.termos_proibidos.join(', ')}.
- Não prometa aprovação, ganho, retorno ou ausência de risco. Não cite outros bancos.
- Evite construções típicas de texto gerado por IA: "não é só X, é Y", "mais do que um X", travessões, perguntas retóricas em sequência e trios de adjetivos.
- Legenda com 2 a 4 parágrafos curtos, útil por si só, terminando com a chamada para ação. Sem hashtags no corpo da legenda.
- Hashtags sem espaços, começando com #.`;

  const conteudo = `Brief:
- Tema: ${oportunidade.tema}
- Objetivo: ${brief.objetivo}
- Público: ${segmento.nome}. ${segmento.descricao}
- Insight: ${brief.insight}
- Mensagem-chave: ${brief.mensagem_chave}
- Chamada para ação: ${brief.cta}
${oferta ? `- Produto em oferta: ${oferta.produto}. Não escreva números: o destaque oficial e o texto legal entram pelo template.\n` : ''}`;

  const r = await ia({ modelo: env.modeloIa, sistema, conteudo, ferramenta, maxTokens: 1500 });
  const dados = { ...r.dados };
  dados.hashtags = (dados.hashtags || [])
    .map((h) => String(h).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`));
  return { dados, modelo: r.modelo };
}

/* ---------------------------------------------------------- prompt imagem */

export function montarPromptImagem(brief) {
  const estilo = marca.estilos_visuais[brief.estilo_visual] ?? Object.values(marca.estilos_visuais)[0];
  return [
    String(brief.prompt_imagem_en || '').trim().replace(/\s+/g, ' '),
    `Visual style: ${estilo}.`,
    `Color palette that harmonizes with ${marca.cores.primaria} and ${marca.cores.secundaria}.`,
    'Vertical 4:5 composition. Keep the main subject in the upper half and the lower half calm and simple, because a text panel will cover it.',
    marca.restricoes_visuais_en,
  ].join(' ');
}

/** Legenda final: texto da IA + texto legal oficial + rótulo de IA + hashtags. */
export function montarLegendaFinal({ textos, oferta }) {
  const partes = [textos.legenda.trim()];
  if (oferta?.texto_legal) partes.push(oferta.texto_legal.trim());
  if (politica.rotulo_ia) partes.push(politica.rotulo_ia);
  if (textos.hashtags?.length) partes.push(textos.hashtags.join(' '));
  return partes.join('\n\n');
}
