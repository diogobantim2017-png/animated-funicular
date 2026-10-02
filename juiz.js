import { env, marca, politica } from './config.js';

const NOTA = { type: 'integer', minimum: 0, maximum: 10 };

export const CHECAGENS_VISUAIS = {
  texto_no_fundo: 'Texto, letras ou números na imagem de fundo',
  logos_ou_marcas: 'Logotipo ou marca de terceiros',
  dinheiro_ou_cartao: 'Cédulas, moedas ou cartão com números',
  pessoas_deformadas: 'Pessoa com rosto, mãos ou corpo deformados',
  conteudo_sensivel: 'Conteúdo sensível ou ofensivo',
  pessoa_publica: 'Pessoa pública reconhecível',
  criancas: 'Criança identificável',
};

/** Explicações extras para o revisor, nas checagens que costumam gerar alarme falso. */
const DETALHE_DA_CHECAGEM = {
  logos_ou_marcas:
    'Só true quando há logotipo, nome, símbolo ou estampa de marca VISÍVEL na imagem. Celular, notebook, carro ou qualquer objeto com formato parecido com um produto conhecido, mas sem logo ou nome visível, é false.',
};

export const NOTAS = {
  aderencia_ao_brief: 'Aderência ao brief',
  tom_de_voz: 'Tom de voz da marca',
  clareza: 'Clareza da mensagem',
  qualidade_visual: 'Qualidade visual',
  legibilidade: 'Legibilidade',
};

const ferramenta = {
  name: 'avaliar_peca',
  description: 'Registra a avaliação de compliance, marca e qualidade da peça.',
  input_schema: {
    type: 'object',
    properties: {
      elementos_no_fundo: {
        type: 'object',
        description:
          'Marque true quando o elemento aparece na IMAGEM DE FUNDO. Na dúvida, marque true (exceto em logos_ou_marcas, que exige marca visível). Sem imagem de fundo, marque tudo false.',
        properties: Object.fromEntries(
          Object.keys(CHECAGENS_VISUAIS).map((k) => [k, DETALHE_DA_CHECAGEM[k] ? { type: 'boolean', description: DETALHE_DA_CHECAGEM[k] } : { type: 'boolean' }]),
        ),
        required: Object.keys(CHECAGENS_VISUAIS),
      },
      observacoes_visuais: { type: 'string', description: 'O que você viu que justifica as marcações acima.' },
      notas: {
        type: 'object',
        properties: Object.fromEntries(Object.keys(NOTAS).map((k) => [k, NOTA])),
        required: Object.keys(NOTAS),
      },
      risco_reputacional: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
      justificativa_risco: { type: 'string' },
      aprovaria_sem_edicao: { type: 'boolean', description: 'Você publicaria exatamente como está?' },
      sugestoes: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    },
    required: ['elementos_no_fundo', 'observacoes_visuais', 'notas', 'risco_reputacional', 'justificativa_risco', 'aprovaria_sem_edicao', 'sugestoes'],
  },
};

function imagem(buffer, mime = 'image/jpeg') {
  return { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
}

function tipoMime(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/png';
}

export async function avaliarComVisao({ ia, fundo, arte, slides = null, visual = 'ia', formato = 'post', editorial = false, textos, brief, oportunidade, segmento }) {
  const origemFundo = editorial
    ? 'foto editorial real, com licença livre'
    : visual === 'foto'
      ? 'foto real de banco de imagens'
      : 'imagem gerada por IA';
  const sistema = `Você é o revisor de conteúdo e marca do perfil ${marca.nome}. ${marca.descricao} Avalie com rigor. Na dúvida, aponte o problema: um falso alarme custa uma revisão humana, um erro publicado custa a reputação do perfil.

Tom de voz esperado: ${marca.tom_de_voz}

${
    fundo
      ? editorial
        ? `A IMAGEM DE FUNDO é uma ${origemFundo} (ex.: Wikimedia Commons). Ela pode mostrar pilotos, carros, números e marcas reais, porque é uma foto de verdade. Marque com honestidade o que aparece em elementos_no_fundo: a equipe revisa essas peças. Confira se a foto combina com o assunto do post e se não é constrangedora para quem aparece nela.`
        : `A IMAGEM DE FUNDO é uma ${origemFundo} e não deve conter nenhum texto, logotipo, dinheiro ou cartão.`
      : 'Esta peça não tem imagem de fundo: foi feita só com o design da marca. Marque todos os itens de elementos_no_fundo como false.'
  }
${slides?.length ? `As imagens seguintes são os ${slides.length} slides de um ${{ flashcards: 'carrossel de flashcards', pista: 'carrossel em pista, em que a pista desenhada continua de uma imagem para a outra' }[formato] || 'carrossel'}, na ordem. Avalie a legibilidade e a sequência de todos.` : 'A ARTE FINAL é a imagem publicada.'} O texto das artes foi inserido pelo template oficial da marca e é esperado.

Risco reputacional alto quando ${
    politica.juiz?.risco_alto_quando ||
    'há recomendação de investimento (indicar produto, instituição, valor ou momento de compra), promessa implícita, leitura enganosa, tema sensível (política, religião, tragédias), estereótipo, insensibilidade com o público ou cena que possa constranger os seguidores.'
  }${
    oportunidade?.fatos?.length
      ? '\n\nEsta peça traz fatos de notícias. Se os textos afirmarem resultado, número, nome, data ou declaração que não está nos fatos confirmados, o risco reputacional é alto e aprovaria_sem_edicao é false.'
      : ''
  }`;

  const conteudo = [];
  if (fundo) conteudo.push({ type: 'text', text: `IMAGEM DE FUNDO: ${origemFundo}.` }, imagem(fundo, tipoMime(fundo)));
  if (slides?.length) {
    slides.forEach((s, i) => conteudo.push({ type: 'text', text: `SLIDE ${i + 1} de ${slides.length}.` }, imagem(s, 'image/jpeg')));
  } else {
    conteudo.push({ type: 'text', text: 'ARTE FINAL com o template da marca.' }, imagem(arte, 'image/jpeg'));
  }
  conteudo.push(
    {
      type: 'text',
      text: `Brief:
- Tema: ${oportunidade.tema}
- Público: ${segmento?.nome || brief.segmento_id}
- Objetivo: ${brief.objetivo}
- Mensagem-chave: ${brief.mensagem_chave}
- Cena pedida: ${brief.cena_visual}

Textos:
- Título: ${textos.titulo}
- Subtítulo: ${textos.subtitulo}
- Chamada: ${textos.cta_arte}
- Legenda: ${textos.legenda}
- Hashtags: ${(textos.hashtags || []).join(' ')}${(textos.slides || []).map((s, i) => `\n- Slide ${i + 2}: ${s.titulo}. ${s.texto}`).join('')}${
        textos.fechamento ? `\n- Fechamento: ${textos.fechamento}` : ''
      }${
        oportunidade?.fatos?.length
          ? `\n\nFatos confirmados nas fontes (${[...new Set((oportunidade.fontes || []).filter((f) => f.verificada).map((f) => f.veiculo))].join(', ') || 'sem fonte conferida'}):\n${oportunidade.fatos.map((f) => `- ${f}`).join('\n')}`
          : ''
      }`,
    },
  );

  const r = await ia({ modelo: env.modeloJuiz, sistema, conteudo, ferramenta, maxTokens: 1500 });
  return { ...r.dados, modelo: r.modelo, politica_versao: politica.versao };
}
