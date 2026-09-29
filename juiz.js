import { env, marca, politica } from './config.js';

const NOTA = { type: 'integer', minimum: 0, maximum: 10 };

export const CHECAGENS_VISUAIS = {
  texto_no_fundo: 'Texto, letras ou números no fundo gerado',
  logos_ou_marcas: 'Logotipo ou marca de terceiros',
  dinheiro_ou_cartao: 'Cédulas, moedas ou cartão com números',
  pessoas_deformadas: 'Pessoa com rosto, mãos ou corpo deformados',
  conteudo_sensivel: 'Conteúdo sensível ou ofensivo',
  pessoa_publica: 'Pessoa pública reconhecível',
  criancas: 'Criança identificável',
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
        description: 'Marque true quando o elemento aparece na IMAGEM 1 (fundo gerado por IA). Na dúvida, marque true.',
        properties: Object.fromEntries(Object.keys(CHECAGENS_VISUAIS).map((k) => [k, { type: 'boolean' }])),
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

export async function avaliarComVisao({ ia, fundo, arte, textos, brief, oportunidade, segmento }) {
  const sistema = `Você é o revisor de conteúdo e marca do perfil de educação financeira ${marca.nome}. Avalie com rigor. Na dúvida, aponte o problema: um falso alarme custa uma revisão humana, um erro publicado custa a reputação do perfil.

Tom de voz esperado: ${marca.tom_de_voz}

A IMAGEM 1 é o fundo gerado por IA e não deve conter nenhum texto, logotipo, dinheiro ou cartão.
A IMAGEM 2 é a arte final. O texto dela foi inserido pelo template oficial da marca e é esperado.

Risco reputacional alto quando há recomendação de investimento (indicar produto, instituição, valor ou momento de compra), promessa implícita, leitura enganosa, tema sensível (política, religião, tragédias), estereótipo, insensibilidade com o público ou cena que possa constranger os seguidores.`;

  const conteudo = [
    { type: 'text', text: 'IMAGEM 1: fundo gerado por IA.' },
    imagem(fundo, tipoMime(fundo)),
    { type: 'text', text: 'IMAGEM 2: arte final com o template da marca.' },
    imagem(arte, 'image/jpeg'),
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
- Hashtags: ${(textos.hashtags || []).join(' ')}`,
    },
  ];

  const r = await ia({ modelo: env.modeloJuiz, sistema, conteudo, ferramenta, maxTokens: 1500 });
  return { ...r.dados, modelo: r.modelo, politica_versao: politica.versao };
}
