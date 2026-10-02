import { env, marca, politica, segmentos } from './config.js';
import { LIMITES_SLIDE, FORMATOS, VISUAIS, OPCOES_DESIGN } from './formatos.js';
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

const semProtocolo = (url = '') =>
  String(url)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

/** Marca como verificada cada fonte cujo endereço apareceu de fato nos resultados da busca na web. */
export function verificarFontes(fontes = [], buscas = []) {
  const achados = new Set(buscas.map((b) => semProtocolo(b.url)));
  return (fontes || [])
    .filter((f) => f?.url)
    .map((f) => ({
      url: String(f.url).trim(),
      veiculo: String(f.veiculo || '').trim(),
      titulo: String(f.titulo || '').trim(),
      data_publicacao: String(f.data_publicacao || '').trim(),
      verificada: achados.has(semProtocolo(f.url)),
    }));
}

/** Sites que recusaram a busca da Anthropic nesta execução: saem da lista de domínios. */
const dominiosSemAcesso = new Set();

/** Lê a recusa da API ("domains are not accessible to our user agent: [...]") e devolve os sites da lista. */
function dominiosRecusados(erro) {
  const achado = /not accessible to our user agent:\s*\[([^\]]*)\]/i.exec(String(erro?.message || ''));
  return achado ? achado[1].split(',').map((d) => d.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}

/** Ferramenta de busca na web executada pela própria API da Anthropic. */
function ferramentaDeBusca() {
  const busca = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: politica.radar?.max_buscas || 5,
    user_location: { type: 'approximate', country: 'BR', timezone: env.fuso },
  };
  const dominios = (politica.radar?.dominios_confiaveis || []).filter((d) => !dominiosSemAcesso.has(d));
  if (dominios.length) busca.allowed_domains = dominios;
  return busca;
}

const CRITERIOS_PADRAO = [
  'Proteger o seguidor: em períodos de compras, festas, viagens e impostos, os golpes costumam aumentar.',
  'Datas próximas do calendário, com antecedência suficiente para o conteúdo ser útil.',
  'Objetivos do perfil. Com público iniciante, prefira temas que ensinam a base antes dos avançados.',
  'Variedade: evite repetir o tema ou a categoria que dominaram as últimas peças.',
];

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
    description: 'Registra a necessidade de comunicação mais relevante para o perfil publicar agora.',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema do post em uma frase curta.' },
        categoria: { type: 'string', enum: categorias.map((c) => c.id) },
        gatilho: {
          type: 'string',
          enum: ['noticia_recente', 'data_do_calendario', 'objetivo_do_perfil', 'lacuna_no_historico', 'orientacao_da_equipe'],
        },
        sinal: {
          type: 'string',
          description: 'O sinal concreto que motivou a escolha, citando a data, o objetivo ou o histórico.',
        },
        justificativa: {
          type: 'string',
          description: 'Por que o tema importa para o seguidor e para o perfil agora, em até 3 frases.',
        },
        urgencia: { type: 'string', enum: ['baixa', 'media', 'alta'] },
        oferta_id: {
          type: 'string',
          enum: ['', ...ativas.map((o) => o.id)],
          description: 'Id da oferta do catálogo. Obrigatório só em categorias de oferta; vazio nos demais casos.',
        },
        fontes: {
          type: 'array',
          maxItems: 5,
          description: 'Páginas encontradas na busca que sustentam o tema. Obrigatório em categorias que exigem fonte.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Endereço exato da página, como veio na busca.' },
              veiculo: { type: 'string', description: 'Nome do site ou veículo.' },
              titulo: { type: 'string' },
              data_publicacao: { type: 'string', description: 'Data de publicação, no formato AAAA-MM-DD.' },
            },
            required: ['url', 'veiculo', 'titulo', 'data_publicacao'],
          },
        },
        fatos: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string' },
          description: 'Fatos confirmados nas fontes, em frases curtas, com nomes, números e datas exatamente como aparecem nelas.',
        },
      },
      required: ['tema', 'categoria', 'gatilho', 'sinal', 'justificativa', 'urgencia', 'oferta_id'],
    },
  };

  const buscaWeb = politica.radar?.busca_web === true;
  const maxDias = politica.noticias?.max_dias || 3;
  const comFonte = categorias.filter((c) => politica.categorias[c.id]?.exige_fonte).map((c) => c.id);
  const criterios = politica.radar?.criterios?.length ? politica.radar.criterios : CRITERIOS_PADRAO;
  const regrasDeBusca = buscaWeb
    ? `Busca na web:
- Pesquise antes de escolher o tema. Priorize o que aconteceu ou foi anunciado nos últimos ${maxDias} dias.
- Em categorias que exigem fonte (${comFonte.join(', ') || 'nenhuma'}), preencha fontes com o endereço exato da página, o veículo, o título e a data, e fatos com o que as fontes confirmam. Sem fonte recente, escolha outra categoria.
- Use só o que as fontes dizem. Rumor é rumor: diga quem publicou e não trate como fato.
- Prefira veículos reconhecidos. Não use sites de apostas como fonte.`
    : 'Não invente números, notícias, pesquisas ou tendências que não estejam nos sinais.';
  const sistema = `Você é o radar de conteúdo do perfil ${marca.nome}.
Perfil: ${marca.descricao}
Sua função é perceber qual necessidade de comunicação é mais relevante agora${buscaWeb ? ', usando os sinais fornecidos e a busca na web' : ', usando apenas os sinais fornecidos'}.

Critérios, nesta ordem:
${criterios.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${regrasDeBusca}
Quando a equipe der uma orientação, ela tem prioridade.`;

  const conteudo = `Hoje: ${hoje} (fuso ${env.fuso})

Datas no radar:
${linhas(eventos, (e) => `${e.nome}: ${e.situacao}${e.data ? ` (${e.data})` : ''}${e.ate ? ` até ${e.ate}` : ''}. Temas sugeridos: ${e.temas.join(', ')}`)}

Objetivos do perfil:
${linhas(marca.objetivos_de_negocio || [], (o) => o)}

Categorias disponíveis:
${linhas(categorias, (c) => `${c.id}: ${c.nome} (risco ${c.risco}${politica.categorias[c.id]?.exige_fonte ? ', exige fonte recente' : ''})`)}

Ofertas ativas no catálogo:
${linhas(ativas, (o) => `${o.id}: ${o.produto} (${o.tipo})`)}

Últimas peças, da mais recente para a mais antiga:
${linhas(historico, (p) => `${p.criada_em.slice(0, 10)} | ${p.categoria} | ${p.tema} | ${p.status}`)}

Orientação da equipe: ${orientacao?.texto?.trim() || 'nenhuma'}${orientacao?.categoria ? `\nCategoria pedida pela equipe: ${orientacao.categoria}` : ''}${
    orientacao?.formato && orientacao.formato !== 'post'
      ? `\nFormato pedido: ${{ flashcards: 'flashcards (cartões de estudo)', pista: 'carrossel em pista (uma volta contínua, trecho a trecho)' }[orientacao.formato] || 'carrossel'} com ${orientacao.num_slides} imagens. Escolha um tema que renda esse número de partes.`
      : ''
  }`;

  const chamar = () =>
    ia({
      modelo: env.modeloIa,
      sistema,
      conteudo,
      ferramenta,
      maxTokens: buscaWeb ? 3000 : 1200,
      ferramentasServidor: buscaWeb ? [ferramentaDeBusca()] : [],
    });
  let r;
  try {
    r = await chamar();
  } catch (erro) {
    // Alguns sites bloqueiam a busca da Anthropic e a API recusa a lista inteira: tira esses sites e tenta de novo.
    const recusados = buscaWeb ? dominiosRecusados(erro) : [];
    if (!recusados.length) throw erro;
    recusados.forEach((d) => dominiosSemAcesso.add(d));
    r = await chamar();
  }
  const dados = { ...r.dados };
  if (orientacao?.categoria) dados.categoria = orientacao.categoria;
  if (!politica.categorias[dados.categoria]?.exige_oferta) dados.oferta_id = '';
  dados.fontes = verificarFontes(dados.fontes, r.buscas || []);
  dados.fatos = (dados.fatos || []).map((f) => String(f).trim()).filter(Boolean);
  return {
    dados,
    modelo: r.modelo,
    contexto: { eventos, categorias: categorias.map((c) => c.id), buscas: (r.buscas || []).length, sites_sem_acesso: [...dominiosSemAcesso] },
  };
}

/* ------------------------------------------------------------------ brief */

export function segmentosPermitidos(categoriaId) {
  const categoria = politica.categorias[categoriaId];
  const protegeVulneraveis = categoria?.exige_oferta === 'credito' && politica.segmentacao?.credito_bloqueia_vulneraveis;
  return segmentos.filter((s) => !(protegeVulneraveis && s.vulneravel));
}

export async function criarBrief({ ia, oportunidade, oferta, formato = 'post', numSlides = 1, visual = 'ia' }) {
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
        busca_foto_en: {
          type: 'string',
          description: 'De 2 a 5 palavras em inglês para buscar uma foto real parecida com a cena num banco de imagens.',
        },
      },
      required: ['objetivo', 'segmento_id', 'insight', 'mensagem_chave', 'cta', 'kpi', 'estilo_visual', 'cena_visual', 'prompt_imagem_en', 'busca_foto_en'],
    },
  };

  const descricaoFormato =
    formato === 'carrossel'
      ? `um carrossel de ${numSlides} imagens (capa, ${numSlides - 2} slides de conteúdo e um slide final)`
      : formato === 'flashcards'
        ? `flashcards em carrossel: capa, ${numSlides - 2} cartões de estudo (termo ou pergunta e a explicação) e um slide final`
        : formato === 'pista'
          ? `um carrossel em pista de ${numSlides} imagens: uma volta contínua que atravessa todas elas, com a largada na capa, ${numSlides - 2} trechos com conteúdo e a bandeirada no slide final`
          : 'um post de imagem única';
  const descricaoVisual =
    visual === 'foto'
      ? 'A capa usa uma foto real de banco de imagens, buscada com busca_foto_en.'
      : visual === 'design'
        ? 'A peça usa só o design da marca, sem imagem. Mesmo assim preencha a cena, para registro.'
        : 'A capa usa uma imagem criada por IA a partir de prompt_imagem_en.';
  const sistema = `Você é estrategista de conteúdo do perfil ${marca.nome}. Transforme a oportunidade em um brief para ${descricaoFormato} no feed do Instagram (orgânico, formato 4:5). ${descricaoVisual}

Marca: ${marca.descricao}
Tom de voz: ${marca.tom_de_voz}
Valores: ${(marca.valores || []).join(', ')}

Regras:
- Escolha exatamente um segmento da lista.
${(marca.diretrizes_de_cena?.length
    ? marca.diretrizes_de_cena
    : [
        'A cena precisa funcionar sem nenhum texto: nada de letreiros, telas com texto legível, documentos, logotipos, cédulas, moedas ou cartões.',
        'Use pessoas e lugares brasileiros reais, com diversidade e sem estereótipos. Prefira cenas simples, com um foco claro.',
      ]
  )
    .map((d) => `- ${d}`)
    .join('\n')}
- A metade de baixo da imagem recebe um painel de texto. Coloque o assunto principal na metade de cima.
- Em prompt_imagem_en, descreva só a cena. O sistema acrescenta estilo, paleta e restrições.
- Em busca_foto_en, ${politica.fotos?.orientacao_busca || 'use palavras simples de banco de imagens (ex.: "young woman budget notebook"), sem marcas e sem texto.'}`;

  const conteudo = `Oportunidade escolhida pelo radar:
- Tema: ${oportunidade.tema}
- Categoria: ${politica.categorias[oportunidade.categoria].nome}
- Sinal: ${oportunidade.sinal}
- Justificativa: ${oportunidade.justificativa}
${oportunidade.fatos?.length ? `- Fatos confirmados nas fontes:\n${oportunidade.fatos.map((f) => `  - ${f}`).join('\n')}\n` : ''}${oferta ? `- Produto em oferta: ${oferta.produto} (números e texto legal entram pelo template, não pelo brief)\n` : ''}
Segmentos permitidos:
${linhas(permitidos, (s) => `${s.id}: ${s.nome}. ${s.descricao}`)}

Estilos visuais aprovados: ${estilos.join(', ')}`;

  const r = await ia({ modelo: env.modeloIa, sistema, conteudo, ferramenta, maxTokens: 1500 });
  return { dados: r.dados, modelo: r.modelo };
}

/* ----------------------------------------------------------------- textos */

/** Mostra os textos atuais numerados como o leitor vê: capa, slides e slide final. */
function textosNumerados(t, numSlides) {
  const linhas = [`Capa (slide 1). Título: ${t.titulo} | Subtítulo: ${t.subtitulo}`];
  (t.slides || []).forEach((sl, i) => linhas.push(`Slide ${i + 2}. Título: ${sl.titulo} | Texto: ${sl.texto}`));
  if (t.slides) linhas.push(`Slide final (slide ${numSlides}). Fechamento: ${t.fechamento} | Botão: ${t.cta_arte}`);
  else linhas.push(`Botão da arte: ${t.cta_arte}`);
  linhas.push(`Legenda: ${t.legenda}`, `Hashtags: ${(t.hashtags || []).join(' ')}`);
  return linhas.join('\n');
}

/**
 * Escreve os textos da peça. Com "pedido", revisa textos já escritos: a equipe diz o que mudar
 * e a IA reescreve só o necessário, com as mesmas regras e limites.
 */
export async function escreverTextos({
  ia,
  oportunidade,
  brief,
  segmento,
  oferta,
  formato = 'post',
  numSlides = 1,
  pedido = null,
  textosAtuais = null,
}) {
  const l = politica.limites;
  const ferramenta = {
    name: pedido ? 'reescrever_textos' : 'escrever_textos',
    description: pedido ? 'Registra os textos revisados conforme o pedido da equipe.' : 'Registra os textos da arte e da legenda do post.',
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
  const emSlides = formato === 'carrossel' || formato === 'flashcards' || formato === 'pista';
  const miolo = Math.max(1, numSlides - 2);
  if (emSlides) {
    const ehCard = formato === 'flashcards';
    ferramenta.input_schema.properties.slides = {
      type: 'array',
      minItems: miolo,
      maxItems: miolo,
      description: `Exatamente ${miolo} ${ehCard ? 'cartões' : 'slides de conteúdo'}, na ordem em que aparecem.`,
      items: {
        type: 'object',
        properties: {
          titulo: {
            type: 'string',
            description: ehCard
              ? `Termo ou pergunta do cartão, até ${LIMITES_SLIDE.titulo} caracteres.`
              : `Título do slide, até ${LIMITES_SLIDE.titulo} caracteres.`,
          },
          texto: {
            type: 'string',
            description: ehCard
              ? `Explicação ou resposta, até ${LIMITES_SLIDE.texto} caracteres.`
              : `Texto do slide, até ${LIMITES_SLIDE.texto} caracteres.`,
          },
        },
        required: ['titulo', 'texto'],
      },
    };
    ferramenta.input_schema.properties.fechamento = {
      type: 'string',
      description: `Frase do slide final, até ${LIMITES_SLIDE.fechamento} caracteres.`,
    };
    ferramenta.input_schema.properties.legenda.description = `Legenda do post, até ${LIMITES_SLIDE.legenda} caracteres, sem hashtags.`;
    ferramenta.input_schema.required.push('slides', 'fechamento');
  }
  const regrasDaPista =
    formato === 'pista'
      ? `\n- Carrossel em pista: a metade de baixo de cada imagem é a pista, então o texto é mais curto. Títulos com até 40 caracteres e textos com até 150. Cada slide é um trecho da volta, em ordem: pense em curvas, setores, etapas de um fim de semana ou momentos de uma corrida.`
      : '';
  const regrasDoFormato = !emSlides
    ? `O título e o subtítulo vão na arte e trazem a ideia principal. A legenda aprofunda, com 2 a 4 parágrafos curtos, sem repetir a arte.`
    : formato === 'flashcards'
      ? `Formato: flashcards em carrossel de ${numSlides} imagens.
- Capa: título e subtítulo que anunciam o que a pessoa vai aprender. A chamada da arte fica no slide final.
- ${miolo} cartões de estudo: em "titulo", um termo ou pergunta curta; em "texto", a explicação ou resposta em linguagem simples, até ${LIMITES_SLIDE.texto} caracteres. Um conceito por cartão, do mais básico ao mais avançado.
- Slide final: "fechamento" com uma frase curta de conclusão e a chamada da arte no botão.
- O conteúdo principal fica nos cartões. A legenda complementa: 1 ou 2 parágrafos curtos com contexto e a chamada para ação, até ${LIMITES_SLIDE.legenda} caracteres, sem repetir os cartões.`
      : `Formato: carrossel de ${numSlides} imagens.
- Capa: título e subtítulo que despertam curiosidade para deslizar. A chamada da arte fica no slide final.
- ${miolo} slides de conteúdo: um título curto (até ${LIMITES_SLIDE.titulo} caracteres) e um texto de até ${LIMITES_SLIDE.texto} caracteres cada. Uma ideia por slide, em sequência lógica, como passos ou tópicos. Não numere os títulos ("Passo 1", "2."): a arte já mostra a posição de cada slide.
- Slide final: "fechamento" com uma frase curta de conclusão e a chamada da arte no botão.
- O conteúdo principal fica nos slides. A legenda complementa: 1 ou 2 parágrafos curtos com contexto e a chamada para ação, até ${LIMITES_SLIDE.legenda} caracteres, sem repetir os slides.${regrasDaPista}`;

  const sistema = `Você é redator do perfil ${marca.nome}. Escreva em português do Brasil, com acentuação completa.
Tom de voz: ${marca.tom_de_voz}

${regrasDoFormato}

Regras verificadas automaticamente. Se você descumprir, a peça é bloqueada:
- Título até ${l.titulo_max} caracteres, subtítulo até ${l.subtitulo_max}, chamada da arte até ${l.cta_max}, legenda até ${l.legenda_max}, no máximo ${l.hashtags_max} hashtags.
${(politica.regras_de_redacao?.length
    ? politica.regras_de_redacao
    : [
        'Não escreva percentuais, valores em reais, taxas, prazos de pagamento ou rendimentos. Quando há oferta, o sistema insere os dados oficiais e o texto legal.',
        'Não prometa ganho, retorno ou ausência de risco. Não cite bancos, corretoras, plataformas ou marcas.',
        'Explique, não recomende: nunca diga qual produto comprar, quanto colocar em cada coisa nem qual é a hora certa de investir.',
      ]
  )
    .map((r) => `- ${r}`)
    .join('\n')}
- Não use estes termos: ${politica.termos_proibidos.join(', ')}.
- Evite construções típicas de texto gerado por IA: "não é só X, é Y", "mais do que um X", travessões, perguntas retóricas em sequência e trios de adjetivos.
- A legenda termina com a chamada para ação. Sem hashtags no corpo da legenda.
- Hashtags sem espaços, começando com #.`;

  if (pedido) {
    ferramenta.input_schema.properties.resumo_da_mudanca = {
      type: 'string',
      description: 'Uma frase, em português, dizendo o que mudou. Se alguma parte do pedido não pôde ser atendida por causa das regras, diga qual.',
    };
    ferramenta.input_schema.required.push('resumo_da_mudanca');
  }

  const revisao = pedido
    ? `

Revisão: a equipe leu a peça e pediu ajustes nos textos.
- Atenda o pedido e mude só o necessário. O que o pedido não mencionar volta igual, palavra por palavra.
- As regras acima continuam valendo, mesmo que o pedido diga o contrário. Se alguma parte não puder ser atendida, explique em resumo_da_mudanca.
- Mantenha a mesma quantidade de slides.`
    : '';

  let conteudo = `Brief:
- Tema: ${oportunidade.tema}
- Objetivo: ${brief.objetivo}
- Público: ${segmento.nome}. ${segmento.descricao}
- Insight: ${brief.insight}
- Mensagem-chave: ${brief.mensagem_chave}
- Chamada para ação: ${brief.cta}
${
    oportunidade.fatos?.length
      ? `- Fatos confirmados nas fontes. Resultados, números, nomes e declarações só podem vir daqui:\n${oportunidade.fatos
          .map((f) => `  - ${f}`)
          .join('\n')}\n- Fontes: ${[...new Set((oportunidade.fontes || []).map((f) => f.veiculo).filter(Boolean))].join(', ')}\n`
      : ''
  }${oferta ? `- Produto em oferta: ${oferta.produto}. Não escreva números: o destaque oficial e o texto legal entram pelo template.\n` : ''}`;

  if (pedido) {
    conteudo += `\nTextos atuais:\n${textosNumerados(textosAtuais || {}, numSlides)}\n\nPedido da equipe: "${pedido}"`;
  }

  const r = await ia({ modelo: env.modeloIa, sistema: sistema + revisao, conteudo, ferramenta, maxTokens: emSlides ? 3000 : 1500 });
  const dados = { ...r.dados };
  const resumo = pedido ? String(dados.resumo_da_mudanca || '').trim() : null;
  delete dados.resumo_da_mudanca;
  if (emSlides) {
    dados.slides = (dados.slides || []).slice(0, miolo).map((sl) => ({ titulo: String(sl.titulo || '').trim(), texto: String(sl.texto || '').trim() }));
    dados.fechamento = String(dados.fechamento || '').trim();
  }
  dados.hashtags = (dados.hashtags || [])
    .map((h) => String(h).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`));
  return { dados, modelo: r.modelo, resumo };
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

/** Legenda final: texto da IA + texto legal oficial + rótulo de IA (só com imagem de IA) + crédito da foto + hashtags. */
export function montarLegendaFinal({ textos, oferta, visual = 'ia', credito = null, fontes = [] }) {
  const partes = [textos.legenda.trim()];
  if (oferta?.texto_legal) partes.push(oferta.texto_legal.trim());
  const veiculos = [...new Set((fontes || []).filter((f) => f.verificada).map((f) => f.veiculo).filter(Boolean))];
  if (veiculos.length) partes.push(`Fonte: ${veiculos.join(', ')}`);
  if (visual === 'ia' && politica.rotulo_ia) partes.push(politica.rotulo_ia);
  if (visual === 'foto' && credito?.autor) {
    const licenca = credito.licenca ? ` (${credito.licenca}${credito.url_licenca ? `, ${credito.url_licenca}` : ''})` : '';
    const mesmaLicenca = credito.compartilha_igual ? ` Esta arte usa a foto adaptada e é compartilhada sob a mesma licença.` : '';
    partes.push(`Foto: ${credito.autor} / ${credito.fonte || 'Pexels'}${licenca}.${mesmaLicenca}`);
  }
  if (textos.hashtags?.length) partes.push(textos.hashtags.join(' '));
  return partes.join('\n\n');
}

/* ------------------------------------------------------- ajuste de visual */

/**
 * Lê o pedido da equipe no "Novo visual" e o transforma em ajustes concretos:
 * layout (formas, fundo, números, contador, pontos, tamanho do texto), nova cena para a IA de imagem
 * ou nova busca de foto. Mudanças de texto ficam de fora e são devolvidas à equipe.
 */
export async function interpretarAjusteVisual({ ia, peca, direcao, designAtual }) {
  const formato = peca.formato || 'post';
  const visual = peca.visual || 'ia';
  const ferramenta = {
    name: 'ajustar_visual',
    description: 'Registra os ajustes de visual pedidos pela equipe.',
    input_schema: {
      type: 'object',
      properties: {
        design: {
          type: 'object',
          properties: {
            formas: { type: 'string', enum: OPCOES_DESIGN.formas, description: 'Formas decorativas (círculos, anéis, pontinhos).' },
            fundo: {
              type: 'string',
              enum: OPCOES_DESIGN.fundo,
              description: 'padrao: o visual normal do formato. claro: fundos claros em tudo. escuro: fundos escuros em tudo.',
            },
            numeros_grandes: {
              type: 'string',
              enum: OPCOES_DESIGN.numeros_grandes,
              description: 'Números grandes decorativos (01, 02...) nos slides de conteúdo. auto: só quando os títulos não têm numeração própria.',
            },
            contador: { type: 'boolean', description: 'Contador de posição no topo (ex.: 2/6) e a etiqueta "cartão 1 de 3".' },
            pontos: { type: 'boolean', description: 'Pontinhos de navegação no rodapé.' },
            texto_maior: { type: 'boolean', description: 'Letras maiores nos títulos e textos.' },
          },
          required: ['formas', 'fundo', 'numeros_grandes', 'contador', 'pontos', 'texto_maior'],
        },
        trocar_imagem: {
          type: 'boolean',
          description:
            'true quando o pedido quer outra imagem, outra foto ou outra composição. false quando pede só ajustes de layout e a imagem atual pode ficar.',
        },
        nova_cena_en: {
          type: 'string',
          description: 'Só para imagem criada por IA e trocar_imagem true: a cena reescrita em inglês, em 1 a 3 frases, já com o pedido. Vazio nos outros casos.',
        },
        nova_busca_foto_en: {
          type: 'string',
          description: 'Só para foto real e trocar_imagem true: de 2 a 5 palavras em inglês para buscar uma nova foto que atenda o pedido. Vazio nos outros casos.',
        },
        resumo: { type: 'string', description: 'Uma frase, em português, dizendo o que vai mudar.' },
        fora_do_visual: {
          type: 'string',
          description:
            'Em português: partes do pedido que são mudança de texto (palavras, títulos, numeração escrita, legenda) e precisam ser editadas nos campos de texto. Vazio se não houver.',
        },
      },
      required: ['design', 'trocar_imagem', 'nova_cena_en', 'nova_busca_foto_en', 'resumo', 'fora_do_visual'],
    },
  };

  const sobreImagem =
    visual === 'ia'
      ? 'A imagem da capa é criada por IA. Se o pedido falar da cena, reescreva-a em nova_cena_en, sem texto, logotipos, dinheiro, cartões ou pessoas públicas.'
      : visual === 'foto'
        ? 'A capa usa uma foto real de banco de imagens. Se o pedido falar da foto, escreva nova_busca_foto_en com palavras simples de banco de imagens.'
        : 'A peça não tem imagem: é feita só com as formas e cores da marca. Pedir "outra composição" é trocar_imagem true. Deixe nova_cena_en e nova_busca_foto_en vazios.';

  const sistema = `Você é diretor de arte do perfil ${marca.nome}. A equipe revisou uma peça e pediu ajustes no visual. Traduza o pedido em ajustes concretos.

Regras:
- Mude só o que o pedido pede. O que não for mencionado volta igual ao estado atual.
- As cores são sempre as da marca. Pedidos de cor viram escolha entre fundo claro e escuro.
- ${sobreImagem}
- Textos não mudam aqui. Palavras, títulos, numeração escrita nos títulos e legenda vão para fora_do_visual, para a equipe editar.
- Se o pedido for vago ("ficou ruim", "tenta de novo"), marque trocar_imagem como true e mantenha o layout.`;

  const titulos = (peca.textos?.slides || []).map((sl, i) => `${i + 2}. ${sl.titulo}`).join('\n');
  const conteudo = `Formato: ${FORMATOS[formato]}. Imagem: ${VISUAIS[visual]}.
Layout atual: ${JSON.stringify(designAtual)}
Cena atual (inglês): ${peca.cena_ajustada_en || peca.brief?.prompt_imagem_en || '-'}
Busca de foto atual: ${peca.busca_foto_en || peca.brief?.busca_foto_en || '-'}
Título da capa: ${peca.textos?.titulo || '-'}
${titulos ? `Títulos dos slides:\n${titulos}\n` : ''}
Pedido da equipe: "${direcao}"`;

  const r = await ia({ modelo: env.modeloIa, sistema, conteudo, ferramenta, maxTokens: 900 });
  return { dados: r.dados, modelo: r.modelo };
}
