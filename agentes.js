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
          enum: ['data_do_calendario', 'objetivo_do_perfil', 'lacuna_no_historico', 'orientacao_da_equipe'],
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
      },
      required: ['tema', 'categoria', 'gatilho', 'sinal', 'justificativa', 'urgencia', 'oferta_id'],
    },
  };

  const sistema = `Você é o radar de conteúdo do perfil de educação financeira ${marca.nome}.\nPerfil: ${marca.descricao}\nSua função é perceber qual necessidade de comunicação é mais relevante agora, usando apenas os sinais fornecidos.

Critérios, nesta ordem:
1. Proteger o seguidor: em períodos de compras, festas, viagens e impostos, os golpes costumam aumentar.
2. Datas próximas do calendário, com antecedência suficiente para o conteúdo ser útil.
3. Objetivos do perfil. Com público iniciante, prefira temas que ensinam a base antes dos avançados.
4. Variedade: evite repetir o tema ou a categoria que dominaram as últimas peças.

Não invente números, notícias, pesquisas ou tendências que não estejam nos sinais. Quando a equipe der uma orientação, ela tem prioridade.`;

  const conteudo = `Hoje: ${hoje} (fuso ${env.fuso})

Datas no radar:
${linhas(eventos, (e) => `${e.nome}: ${e.situacao}${e.data ? ` (${e.data})` : ''}${e.ate ? ` até ${e.ate}` : ''}. Temas sugeridos: ${e.temas.join(', ')}`)}

Objetivos do perfil:
${linhas(marca.objetivos_de_negocio || [], (o) => o)}

Categorias disponíveis:
${linhas(categorias, (c) => `${c.id}: ${c.nome} (risco ${c.risco})`)}

Ofertas ativas no catálogo:
${linhas(ativas, (o) => `${o.id}: ${o.produto} (${o.tipo})`)}

Últimas peças, da mais recente para a mais antiga:
${linhas(historico, (p) => `${p.criada_em.slice(0, 10)} | ${p.categoria} | ${p.tema} | ${p.status}`)}

Orientação da equipe: ${orientacao?.texto?.trim() || 'nenhuma'}${orientacao?.categoria ? `\nCategoria pedida pela equipe: ${orientacao.categoria}` : ''}${
    orientacao?.formato && orientacao.formato !== 'post'
      ? `\nFormato pedido: ${orientacao.formato === 'flashcards' ? 'flashcards (cartões de estudo)' : 'carrossel'} com ${orientacao.num_slides} imagens. Escolha um tema que renda esse número de partes.`
      : ''
  }`;

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
- A cena precisa funcionar sem nenhum texto: nada de letreiros, telas com texto legível, documentos, logotipos, cédulas, moedas ou cartões.
- Use pessoas e lugares brasileiros reais, com diversidade e sem estereótipos. Prefira cenas simples, com um foco claro.
- A metade de baixo da imagem recebe um painel de texto. Coloque o assunto principal na metade de cima.
- Em prompt_imagem_en, descreva só a cena. O sistema acrescenta estilo, paleta e restrições.
- Em busca_foto_en, use palavras simples de banco de imagens (ex.: "young woman budget notebook"), sem marcas e sem texto.`;

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

export async function escreverTextos({ ia, oportunidade, brief, segmento, oferta, formato = 'post', numSlides = 1 }) {
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
  const emSlides = formato === 'carrossel' || formato === 'flashcards';
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
- O conteúdo principal fica nos slides. A legenda complementa: 1 ou 2 parágrafos curtos com contexto e a chamada para ação, até ${LIMITES_SLIDE.legenda} caracteres, sem repetir os slides.`;

  const sistema = `Você é redator do perfil ${marca.nome}. Escreva em português do Brasil, com acentuação completa.
Tom de voz: ${marca.tom_de_voz}

${regrasDoFormato}

Regras verificadas automaticamente. Se você descumprir, a peça é bloqueada:
- Título até ${l.titulo_max} caracteres, subtítulo até ${l.subtitulo_max}, chamada da arte até ${l.cta_max}, legenda até ${l.legenda_max}, no máximo ${l.hashtags_max} hashtags.
- Não escreva percentuais, valores em reais, taxas, prazos de pagamento ou rendimentos. Quando há oferta, o sistema insere os dados oficiais e o texto legal.
- Não use estes termos: ${politica.termos_proibidos.join(', ')}.
- Não prometa ganho, retorno ou ausência de risco. Não cite bancos, corretoras, plataformas ou marcas.
- Explique, não recomende: nunca diga qual produto comprar, quanto colocar em cada coisa nem qual é a hora certa de investir.
- Evite construções típicas de texto gerado por IA: "não é só X, é Y", "mais do que um X", travessões, perguntas retóricas em sequência e trios de adjetivos.
- A legenda termina com a chamada para ação. Sem hashtags no corpo da legenda.
- Hashtags sem espaços, começando com #.`;

  const conteudo = `Brief:
- Tema: ${oportunidade.tema}
- Objetivo: ${brief.objetivo}
- Público: ${segmento.nome}. ${segmento.descricao}
- Insight: ${brief.insight}
- Mensagem-chave: ${brief.mensagem_chave}
- Chamada para ação: ${brief.cta}
${oferta ? `- Produto em oferta: ${oferta.produto}. Não escreva números: o destaque oficial e o texto legal entram pelo template.\n` : ''}`;

  const r = await ia({ modelo: env.modeloIa, sistema, conteudo, ferramenta, maxTokens: emSlides ? 3000 : 1500 });
  const dados = { ...r.dados };
  if (emSlides) {
    dados.slides = (dados.slides || []).slice(0, miolo).map((sl) => ({ titulo: String(sl.titulo || '').trim(), texto: String(sl.texto || '').trim() }));
    dados.fechamento = String(dados.fechamento || '').trim();
  }
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

/** Legenda final: texto da IA + texto legal oficial + rótulo de IA (só com imagem de IA) + crédito da foto + hashtags. */
export function montarLegendaFinal({ textos, oferta, visual = 'ia', credito = null }) {
  const partes = [textos.legenda.trim()];
  if (oferta?.texto_legal) partes.push(oferta.texto_legal.trim());
  if (visual === 'ia' && politica.rotulo_ia) partes.push(politica.rotulo_ia);
  if (visual === 'foto' && credito?.autor) partes.push(`Foto: ${credito.autor} / ${credito.fonte || 'Pexels'}`);
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
