/**
 * Teste offline do motor de campanhas.
 * Roda o pipeline inteiro com IA e imagem simuladas: nenhuma chave, nenhuma chamada externa.
 * Uso: npm run teste            (apaga os dados temporários ao final)
 *      npm run teste -- --manter (mantém a pasta temporária para inspeção)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const manter = process.argv.includes('--manter');
const temporario = await fs.mkdtemp(path.join(os.tmpdir(), 'motor-teste-'));

// Ambiente isolado: definido antes de importar a configuração (o .env local não interfere).
Object.assign(process.env, {
  ANTHROPIC_API_KEY: 'chave-de-teste',
  ARMAZENAMENTO: 'local',
  DADOS_DIR: temporario,
  PUBLIC_BASE_URL: '',
  PUBLICACAO_MODO: 'simulacao',
  CRON_RADAR: '',
  FUSO_HORARIO: 'America/Sao_Paulo',
});

const { raiz, marca, politica, ofertas, segmentos, calendario, MARCADOR_PENDENTE, temPendencia } = await import('./config.js');

/*
 * O teste verifica o motor com um perfil fixo (teste-perfil.json), para funcionar igual em qualquer perfil ativo.
 * Fontes e logo continuam os do perfil ativo, porque os arquivos são do repositório.
 */
const perfilAtivo = {
  marca: structuredClone(marca),
  politica: structuredClone(politica),
  segmentos: structuredClone(segmentos),
};
{
  const fixo = JSON.parse(await fs.readFile(path.join(raiz, 'teste-perfil.json'), 'utf8'));
  const trocar = (alvo, novo) => {
    for (const chave of Object.keys(alvo)) delete alvo[chave];
    Object.assign(alvo, novo);
  };
  trocar(marca, { ...fixo.marca, fontes: perfilAtivo.marca.fontes, logo: perfilAtivo.marca.logo, design_padrao: undefined });
  trocar(politica, fixo.politica);
  trocar(calendario, fixo.calendario);
  segmentos.splice(0, segmentos.length, ...fixo.segmentos);
  ofertas.splice(0, ofertas.length, ...fixo.ofertas);
}

/* Só no teste: o perfil atual não usa ofertas, mas as travas de oferta continuam no código e seguem testadas. */
politica.categorias.produto_credito = { nome: 'Oferta de crédito (só no teste)', risco: 'alto', autonomia_maxima: 'humano', exige_oferta: 'credito', avisos_obrigatorios: ['CET'] };
ofertas.push({ id: 'credito_pessoal', ativa: false, tipo: 'credito', produto: 'Crédito pessoal', destaque: 'Condições do teste', texto_legal: 'Crédito sujeito a análise. CET informado no teste.', validade: '2099-12-31' });
const { criarArmazenamentoLocal } = await import('./local.js');
const { criarCanalInstagram } = await import('./instagram.js');
const { criarMotor } = await import('./motor.js');
const { avaliarRegras } = await import('./regras.js');
const { calcularMetricas } = await import('./autonomia.js');
const { segmentosPermitidos, categoriasDisponiveis, montarLegendaFinal } = await import('./agentes.js');
const { hojeNoFuso } = await import('./util.js');
const { createCanvas } = await import('@napi-rs/canvas');

const HOJE = hojeNoFuso('America/Sao_Paulo');
const saida = path.join(raiz, 'teste-saida');
await fs.mkdir(saida, { recursive: true });

/* ------------------------------------------------------------ respostas simuladas */

const OPORTUNIDADE = {
  tema: 'Golpe da falsa central de atendimento',
  categoria: 'seguranca_golpes',
  gatilho: 'objetivo_do_perfil',
  sinal: 'Objetivo do banco: reduzir golpes contra clientes com conteúdo educativo sobre falsa central.',
  justificativa: 'A falsa central segue entre os golpes mais comuns. Um lembrete simples ajuda o cliente a desligar a tempo.',
  urgencia: 'alta',
  oferta_id: '',
};

const BRIEF = {
  objetivo: 'Fazer o cliente reconhecer e interromper a ligação da falsa central.',
  segmento_id: 'publico_geral',
  insight: 'A pressa e o medo de perder dinheiro fazem a pessoa obedecer a quem parece ser o banco.',
  mensagem_chave: 'O banco nunca pede senha por telefone.',
  cta: 'Salvar o post e compartilhar com a família.',
  kpi: 'salvamentos',
  estilo_visual: 'ilustracao_flat',
  cena_visual: 'Pessoa em casa encerrando uma ligação no celular, com expressão tranquila.',
  prompt_imagem_en: 'A calm Brazilian woman at home ending a phone call on her smartphone, relaxed expression, cozy living room.',
  busca_foto_en: 'woman phone call home',
};

/** Slides simulados no tamanho que o schema pede (carrossel e flashcards). */
function slidesSimulados(n) {
  return Array.from({ length: n }, (_, i) => ({
    titulo: `Passo ${i + 1}: desligue e confira`,
    texto: 'Quem liga pedindo senha ou código não é o banco. Desligue e procure o atendimento pelos canais oficiais que você já conhece.',
  }));
}

const TEXTOS = {
  titulo: 'Ligação do banco pedindo senha é golpe',
  subtitulo: 'O banco nunca pede senha, token ou código por telefone. Desligue e ligue você para o número do cartão.',
  cta_arte: 'Salve e compartilhe',
  legenda:
    'Golpistas se passam pela central do banco e criam urgência para você agir rápido.\n\n' +
    'O banco nunca liga pedindo senha, código recebido por SMS ou para você instalar aplicativos.\n\n' +
    'Na dúvida, desligue e ligue você para o número que está no verso do seu cartão. Salve este post e mande para quem você quer proteger.',
  hashtags: ['#SegurançaDigital', '#FalsaCentral', '#GolpeNão'],
};

const JUIZ = {
  elementos_no_fundo: {
    texto_no_fundo: false,
    logos_ou_marcas: false,
    dinheiro_ou_cartao: false,
    pessoas_deformadas: false,
    conteudo_sensivel: false,
    pessoa_publica: false,
    criancas: false,
  },
  observacoes_visuais: 'Cena limpa, sem texto, marcas ou dinheiro.',
  notas: { aderencia_ao_brief: 9, tom_de_voz: 9, clareza: 9, qualidade_visual: 8, legibilidade: 9 },
  risco_reputacional: 'baixo',
  justificativa_risco: 'Conteúdo educativo, sem promessa nem tema sensível.',
  aprovaria_sem_edicao: true,
  sugestoes: [],
};

/** Ajustes pontuais para o próximo cenário. Zerado depois de cada caso. */
let roteiro = {};

/** Confere se a resposta simulada respeita o schema da ferramenta, como a API faria. */
function validarSchema(schema, valor, caminho = 'raiz') {
  if (schema.type === 'object') {
    assert.ok(valor && typeof valor === 'object' && !Array.isArray(valor), `${caminho} deveria ser objeto`);
    for (const campo of schema.required || []) assert.ok(campo in valor, `campo obrigatório ausente: ${caminho}.${campo}`);
    for (const [campo, sub] of Object.entries(schema.properties || {})) {
      if (campo in valor) validarSchema(sub, valor[campo], `${caminho}.${campo}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(valor), `${caminho} deveria ser lista`);
    if (schema.maxItems != null) assert.ok(valor.length <= schema.maxItems, `${caminho} com itens demais`);
    if (schema.minItems != null) assert.ok(valor.length >= schema.minItems, `${caminho} com itens de menos`);
    valor.forEach((item, i) => validarSchema(schema.items, item, `${caminho}[${i}]`));
  } else if (schema.type === 'string') {
    assert.equal(typeof valor, 'string', `${caminho} deveria ser texto`);
    if (schema.enum) assert.ok(schema.enum.includes(valor), `${caminho} fora das opções permitidas: "${valor}"`);
  } else if (schema.type === 'integer') {
    assert.ok(Number.isInteger(valor), `${caminho} deveria ser inteiro`);
    if (schema.minimum != null) assert.ok(valor >= schema.minimum);
    if (schema.maximum != null) assert.ok(valor <= schema.maximum);
  } else if (schema.type === 'boolean') {
    assert.equal(typeof valor, 'boolean', `${caminho} deveria ser verdadeiro ou falso`);
  }
}

/** Campos do artigo do LinkedIn, quando o redator pede esse formato. */
function artigoSimulado(ferramenta) {
  const secoes = ferramenta.input_schema.properties.secoes;
  if (!secoes) return {};
  return {
    secoes: Array.from({ length: secoes.minItems }, (_, i) => ({
      intertitulo: `Parte ${i + 1} do raciocínio`,
      texto: `Primeiro parágrafo da seção ${i + 1}, com contexto.\n\nSegundo parágrafo, com um exemplo prático.`,
    })),
    conclusao: 'A ideia principal, em poucas frases.',
    chamada_final: 'Como esse tema aparece na sua organização?',
  };
}

const chamadas = [];
async function iaSimulada({ ferramenta, conteudo, sistema, ferramentasServidor = [] }) {
  chamadas.push({ ferramenta: ferramenta.name, schema: ferramenta.input_schema, conteudo, sistema, servidor: ferramentasServidor });
  if (ferramenta.name === 'propor_oportunidade' && roteiro.recusarSites) {
    const lista = roteiro.recusarSites;
    roteiro.recusarSites = null;
    throw Object.assign(
      new Error(`400 {"type":"error","error":{"type":"invalid_request_error","message":"The following domains are not accessible to our user agent: ['${lista.join("', '")}']."}}`),
      { status: 400 },
    );
  }
  const respostas = {
    propor_oportunidade: () => ({ ...OPORTUNIDADE, ...roteiro.oportunidade }),
    criar_brief: () => ({ ...BRIEF, ...roteiro.brief }),
    escrever_textos: () => {
      const pedeSlides = ferramenta.input_schema.properties.slides;
      const extras = pedeSlides ? { slides: slidesSimulados(pedeSlides.minItems), fechamento: 'Proteja quem você ama: compartilhe.' } : {};
      return { ...TEXTOS, ...extras, ...artigoSimulado(ferramenta), ...roteiro.textos };
    },
    escolher_imagem_do_banco: () => ({ indice: roteiro.banco?.indice ?? 0, motivo: roteiro.banco?.motivo || 'Combina com o tema do post.' }),
    diagnosticar_geo: () => ({
      resumo: 'A marca aparece pouco nas respostas sobre CRM.',
      fragilidades: [
        { titulo: 'Ausente na pergunta de CRM', evidencia: 'Pergunta 1 com score 0.', impacto: 'alto', perguntas: [1] },
        { titulo: 'Site não é citado', evidencia: 'Citação 0%.', impacto: 'medio', perguntas: [1, 2] },
      ],
      acoes: [
        { canal: 'site', titulo: 'Página que responde à pergunta de CRM', o_que_fazer: 'Criar a página.', por_que: 'Pergunta 1.', prioridade: 'alta', esforco: 'medio', prazo: 'este mês', o_motor_faz: false, formato: 'nenhum', orientacao_para_o_motor: 'não usar' },
        { canal: 'linkedin', titulo: 'Artigo sobre como escolher CRM', o_que_fazer: 'Publicar artigo.', por_que: 'Pergunta 1.', prioridade: 'alta', esforco: 'baixo', prazo: 'esta semana', o_motor_faz: true, formato: 'artigo', orientacao_para_o_motor: 'Artigo: como escolher uma consultoria de CRM' },
        { canal: 'youtube', titulo: 'Vídeo curto', o_que_fazer: 'Gravar vídeo.', por_que: 'Fontes.', prioridade: 'baixa', esforco: 'alto', prazo: 'este trimestre', o_motor_faz: false, formato: 'nenhum', orientacao_para_o_motor: '' },
        { canal: 'imprensa', titulo: 'Pauta para veículos citados', o_que_fazer: 'Sugerir pauta.', por_que: 'Fontes.', prioridade: 'media', esforco: 'medio', prazo: 'este mês', o_motor_faz: false, formato: 'nenhum', orientacao_para_o_motor: '' },
      ],
      vitorias_rapidas: ['Publicar o artigo', 'Conferir o acesso dos robôs ao site'],
      como_medir: 'Ver se o score da pergunta 1 sobe nas próximas rodadas.',
    }),
    descrever_fotos: () => ({
      fotos: conteudo.filter((b) => b.type === 'image').map((_, i) => ({ indice: i, descricao: `Foto ${i + 1} descrita pela IA`, temas: ['equipe', 'escritório', 'tecnologia'] })),
    }),
    planejar_regua: () => {
      const esquema = ferramenta.input_schema.properties.itens;
      const props = esquema.items.properties;
      return {
        nome: 'Série de teste',
        objetivo: 'Testar a régua.',
        narrativa: 'Abertura, aprofundamento e convite.',
        itens: Array.from({ length: esquema.minItems }, (_, i) => ({
          titulo: `Tema ${i + 1}`,
          categoria: props.categoria.enum[i % props.categoria.enum.length],
          segmento: props.segmento.enum[0],
          etapa_funil: i === esquema.minItems - 1 ? 'converter' : 'engajar',
          formato: i % 2 ? 'carrossel' : 'post',
          gancho: `Gancho ${i + 1}`,
          mensagem: `Mensagem ${i + 1}`,
          provas: [],
          cta: 'Vamos conversar?',
          ja_produzido: i === 0,
          observacoes: '',
        })),
        ...roteiro.regua,
      };
    },
    reescrever_textos: () => {
      const pedeSlides = ferramenta.input_schema.properties.slides;
      const extras = pedeSlides
        ? { slides: slidesSimulados(pedeSlides.minItems), fechamento: 'Proteja quem você ama: compartilhe.' }
        : artigoSimulado(ferramenta);
      return { ...TEXTOS, ...extras, resumo_da_mudanca: 'Textos ajustados.', ...roteiro.reescrita };
    },
    ajustar_visual: () => ({
      trocar_imagem: true,
      nova_cena_en: '',
      nova_busca_foto_en: '',
      resumo: 'Ajuste simulado.',
      fora_do_visual: '',
      ...roteiro.ajuste,
      design: { formas: 'normal', fundo: 'padrao', numeros_grandes: 'auto', contador: true, pontos: true, texto_maior: false, cor: '', ...roteiro.ajuste?.design },
    }),
    avaliar_peca: () => ({
      ...JUIZ,
      ...roteiro.juiz,
      elementos_no_fundo: { ...JUIZ.elementos_no_fundo, ...roteiro.juiz?.elementos_no_fundo },
      notas: { ...JUIZ.notas, ...roteiro.juiz?.notas },
    }),
  };
  const dados = structuredClone(respostas[ferramenta.name]());
  validarSchema(ferramenta.input_schema, dados);
  const buscas = ferramenta.name === 'propor_oportunidade' ? roteiro.buscas || [] : [];
  return { dados, modelo: 'modelo-simulado', buscas };
}

const promptsImagem = [];
const imagemSimulada = {
  provedor: 'teste',
  modelo: 'fundo-sintetico',
  async gerar(prompt) {
    promptsImagem.push(prompt);
    const c = createCanvas(1024, 1536);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 1024, 1536);
    g.addColorStop(0, '#bfe3f2');
    g.addColorStop(1, '#f6e3b4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1536);
    ctx.fillStyle = '#2f6f8f';
    ctx.beginPath();
    ctx.arc(512, 470, 230, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2b705';
    ctx.beginPath();
    ctx.arc(640, 360, 90, 0, Math.PI * 2);
    ctx.fill();
    return { buffer: await c.encode('png'), mime: 'image/png' };
  },
};

let fotosBuscadas = 0;
const consultasDeFoto = [];
const fotosSimuladas = {
  provedor: 'teste',
  disponivel: true,
  async buscar(consulta, { evitar = [] } = {}) {
    fotosBuscadas++;
    consultasDeFoto.push(consulta);
    let id = 1000;
    while (evitar.includes(String(id))) id++;
    const c = createCanvas(940, 1400);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6c8f7d';
    ctx.fillRect(0, 0, 940, 1400);
    return { buffer: await c.encode('jpeg'), mime: 'image/jpeg', id: String(id), consulta, credito: { autor: 'Fotógrafa Teste', url: 'https://www.pexels.com/photo/1', fonte: 'Pexels' } };
  },
};

/* ----------------------------------------------------------------- preparação */

const db = await criarArmazenamentoLocal({ diretorio: temporario, urlPublica: '' });
let sorteio = 0.99; // 0.99 = nunca cai na amostra de auditoria; 0 = sempre cai
const motor = criarMotor({ db, ia: iaSimulada, imagem: imagemSimulada, fotos: fotosSimuladas, canal: criarCanalInstagram(), sortear: () => sorteio });

// Ajustes só em memória, para o teste caber em um dia e exercitar a escada de autonomia.
const marcaOriginal = { nome: marca.nome, descricao: marca.descricao };
marca.nome = 'Banco Exemplo';
marca.descricao = 'Banco de varejo brasileiro usado nos testes automatizados.';
politica.limites.geracoes_por_dia = 100;
politica.limites.publicacoes_por_dia = 100;
politica.autonomia.min_amostras = 3;

const gerarPeca = (opcoes = {}) => motor.gerar({ origem: 'manual', usuario: 'teste', aguardar: true, ...opcoes });

/** Espera a tarefa em segundo plano terminar de fato (o painel usa o mesmo campo "processando"). */
async function aguardarProcessamento(id) {
  for (let i = 0; i < 400; i++) {
    const { peca, processando } = await motor.detalhe(id);
    if (!processando && peca.status !== 'gerando') return peca;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('A peça não terminou de processar a tempo.');
}

const resultados = [];
async function caso(nome, fn) {
  const inicio = Date.now();
  try {
    await fn();
    resultados.push({ nome, ok: true });
    console.log(`  ok      ${nome} (${Date.now() - inicio} ms)`);
  } catch (erro) {
    resultados.push({ nome, ok: false, erro });
    console.log(`  FALHOU  ${nome}\n          ${erro.message}`);
  } finally {
    roteiro = {};
    sorteio = 0.99;
  }
}

console.log('\nTeste offline do motor de campanhas (IA, imagem e publicação simuladas)\n');

/* ---------------------------------------------------------------------- casos */

let pecaBase = null;

await caso('Pipeline completo: radar, brief, textos, imagem, arte 1080x1350, travas e decisão', async () => {
  const peca = await gerarPeca();
  assert.equal(peca.status, 'em_revisao');
  assert.equal(peca.governanca.gate.veredito, 'publicavel');
  assert.equal(peca.decisao.tipo, 'fila_humana');
  assert.match(peca.decisao.motivo, /modo humano/);
  assert.equal(peca.arte.largura, 1080);
  assert.equal(peca.arte.altura, 1350);
  const etapas = (await db.listarAuditoria(peca.id)).map((a) => a.etapa);
  for (const e of ['inicio', 'radar', 'brief', 'textos', 'imagem', 'arte', 'regras', 'revisor_ia', 'gate', 'decisao']) {
    assert.ok(etapas.includes(e), `faltou a etapa ${e} na auditoria`);
  }
  assert.match(promptsImagem.at(-1), /no text/i, 'o prompt de imagem precisa levar as restrições da marca');
  assert.match(promptsImagem.at(-1), /4:5/);
  await fs.writeFile(path.join(saida, 'previa-arte.jpg'), await db.lerMidia(peca.arte.chave));
  pecaBase = peca.id;
});

await caso('Termo proibido bloqueia a peça e impede a aprovação', async () => {
  roteiro.textos = { subtitulo: 'Com o app, sua proteção é garantida em qualquer compra.' };
  const peca = await gerarPeca();
  assert.equal(peca.governanca.gate.veredito, 'bloqueada');
  assert.equal(peca.governanca.regras.find((r) => r.id === 'termos_proibidos').ok, false);
  await assert.rejects(motor.aprovar(peca.id, 'teste'), /bloqueada/i);
});

await caso('Taxa escrita pela IA é bloqueada: números só vêm do catálogo oficial', async () => {
  roteiro.textos = { subtitulo: 'Parcele em até 12x com taxa de 1,99% ao mês.' };
  const peca = await gerarPeca();
  assert.equal(peca.governanca.gate.veredito, 'bloqueada');
  assert.equal(peca.governanca.regras.find((r) => r.id === 'numeros_so_do_catalogo').ok, false);
});

await caso('Crédito nunca é direcionado a público vulnerável', async () => {
  assert.ok(!segmentosPermitidos('produto_credito').some((s) => s.id === 'jovens_endividados'));
  assert.ok(segmentosPermitidos('educacao_financeira').some((s) => s.id === 'jovens_endividados'));
  const regras = avaliarRegras({
    textos: TEXTOS,
    categoriaId: 'produto_credito',
    segmentoId: 'jovens_endividados',
    ofertaId: 'credito_pessoal',
    arte: null,
    hoje: HOJE,
    modoPublicacao: 'simulacao',
  });
  const segmento = regras.find((r) => r.id === 'segmento_permitido');
  assert.equal(segmento.ok, false);
  assert.equal(segmento.severidade, 'bloqueio');
  assert.equal(regras.find((r) => r.id === 'oferta_do_catalogo').ok, false, 'oferta inativa também precisa bloquear');
});

await caso('Oferta sem catálogo ativo não entra no radar', async () => {
  const ids = categoriasDisponiveis(HOJE).map((c) => c.id);
  assert.ok(!ids.includes('produto_credito') && !ids.includes('produto_investimento'));
  await assert.rejects(gerarPeca({ orientacao: { categoria: 'produto_credito' } }), /não está disponível hoje/);
});

await caso('Revisor com visão: texto no fundo gerado bloqueia', async () => {
  roteiro.juiz = { elementos_no_fundo: { texto_no_fundo: true }, observacoes_visuais: 'Letras ilegíveis em uma placa ao fundo.' };
  const peca = await gerarPeca();
  assert.equal(peca.governanca.gate.veredito, 'bloqueada');
  assert.ok(peca.governanca.gate.motivos.some((m) => m.origem === 'visao' && m.id === 'texto_no_fundo'));
});

await caso('Criança identificável na imagem pede revisão humana', async () => {
  roteiro.juiz = { elementos_no_fundo: { criancas: true } };
  const peca = await gerarPeca();
  assert.equal(peca.governanca.gate.veredito, 'precisa_humano');
});

await caso('Nota baixa do revisor de IA pede revisão humana', async () => {
  roteiro.juiz = { notas: { clareza: 5 }, aprovaria_sem_edicao: false };
  const peca = await gerarPeca();
  assert.equal(peca.governanca.gate.veredito, 'precisa_humano');
  assert.ok(peca.governanca.gate.motivos.some((m) => m.id === 'nota_item'));
});

await caso('Vício de texto de IA gera alerta', async () => {
  roteiro.textos = { legenda: 'Mais do que um aplicativo, é a sua segurança. Desligue e ligue você para o banco.' };
  const peca = await gerarPeca();
  assert.equal(peca.governanca.gate.veredito, 'precisa_humano');
  assert.equal(peca.governanca.regras.find((r) => r.id === 'estilo_de_texto').ok, false);
});

await caso('Dado pendente de validação: alerta em simulação, bloqueio em publicação real', async () => {
  assert.equal(temPendencia({ observacao: `Preencha tudo que tiver ${MARCADOR_PENDENTE}.`, nome: 'Banco X' }), false, 'instruções não contam como pendência');
  assert.equal(temPendencia({ cores: { primaria: MARCADOR_PENDENTE } }), true);
  const nomeTeste = marca.nome;
  marca.nome = marcaOriginal.nome.includes(MARCADOR_PENDENTE) ? marcaOriginal.nome : MARCADOR_PENDENTE;
  try {
    const base = { textos: TEXTOS, categoriaId: 'seguranca_golpes', segmentoId: 'publico_geral', ofertaId: '', arte: null, hoje: HOJE };
    const simulacao = avaliarRegras({ ...base, modoPublicacao: 'simulacao' }).find((r) => r.id === 'dados_validados');
    const real = avaliarRegras({ ...base, modoPublicacao: 'real' }).find((r) => r.id === 'dados_validados');
    assert.equal(simulacao.severidade, 'alerta');
    assert.equal(real.severidade, 'bloqueio');
  } finally {
    marca.nome = nomeTeste;
  }
});

await caso('Aprovação humana publica (simulação) com rótulo de IA e hashtags', async () => {
  const peca = await motor.aprovar(pecaBase, 'Revisora Teste');
  assert.equal(peca.status, 'publicada');
  assert.equal(peca.publicacao.modo, 'simulacao');
  assert.equal(peca.revisao.usuario, 'Revisora Teste');
  assert.ok(peca.publicacao.legenda_final.includes(politica.rotulo_ia));
  assert.ok(peca.publicacao.legenda_final.includes('#FalsaCentral'));
  const comOferta = montarLegendaFinal({ textos: TEXTOS, oferta: { texto_legal: 'Texto legal oficial do produto.' } });
  assert.ok(comOferta.includes('Texto legal oficial do produto.'));
});

await caso('Edição humana refaz a arte, reavalia e registra a intervenção', async () => {
  const peca = await gerarPeca();
  await motor.editarTextos(peca.id, 'teste', { titulo: 'Desconfie de ligação pedindo senha' });
  const editada = await aguardarProcessamento(peca.id);
  assert.equal(editada.status, 'em_revisao');
  assert.equal(editada.intervencao_humana, true);
  assert.equal(editada.textos.titulo, 'Desconfie de ligação pedindo senha');
  assert.notEqual(editada.arte.chave, peca.arte.chave);

  await motor.editarTextos(peca.id, 'teste', { subtitulo: 'Proteção garantida em qualquer ligação.' });
  const bloqueada = await aguardarProcessamento(peca.id);
  assert.equal(bloqueada.governanca.gate.veredito, 'bloqueada', 'edição humana também passa pelas travas');
  assert.equal(bloqueada.governanca.veredito_inicial, 'publicavel', 'o veredito inicial da IA fica preservado para as métricas');
  await motor.reprovar(peca.id, 'teste', 'Encerrando cenário de edição');
});

await caso('Nova imagem com direção do revisor', async () => {
  const peca = await gerarPeca();
  await motor.regenerarImagem(peca.id, 'teste', 'Trocar para uma cena ao ar livre');
  const depois = await aguardarProcessamento(peca.id);
  assert.notEqual(depois.imagem.chave, peca.imagem.chave);
  assert.match(depois.imagem.prompt, /Trocar para uma cena ao ar livre/);
  assert.equal(depois.status, 'em_revisao');
});

await caso('Escada de autonomia: libera com evidência, publica sozinho, audita por amostragem e revoga', async () => {
  const categoria = 'educacao_financeira';
  roteiro.oportunidade = { tema: 'Como montar uma reserva de emergência' };
  await assert.rejects(motor.definirModo(categoria, 'auto', 'teste'), /Faltam 3/);
  await assert.rejects(motor.definirModo('como_investir', 'auto', 'teste'), /não permite/);

  for (let i = 0; i < 3; i++) {
    const peca = await gerarPeca({ orientacao: { categoria } });
    assert.equal(peca.status, 'em_revisao');
    await motor.aprovar(peca.id, 'teste');
  }
  const m = calcularMetricas(await db.listarPecas({ limite: 2000 }), categoria);
  assert.equal(m.revisadas_com_gate_publicavel, 3);
  assert.equal(m.concordancia, 1);
  assert.equal(m.pode_liberar, true);
  await motor.definirModo(categoria, 'auto', 'teste');

  const sozinha = await gerarPeca({ orientacao: { categoria } });
  assert.equal(sozinha.status, 'publicada');
  assert.equal(sozinha.decisao.tipo, 'automatica');

  sorteio = 0;
  const amostra = await gerarPeca({ orientacao: { categoria } });
  assert.equal(amostra.status, 'em_revisao');
  assert.equal(amostra.decisao.amostra_auditoria, true);

  await motor.reprovar(amostra.id, 'teste', 'Tom inadequado');
  const modos = await db.obterModosCategorias();
  assert.equal(modos[categoria].modo, 'humano', 'concordância de 75% precisa revogar a autonomia');
});

await caso('Limite diário de publicações retém a peça aprovada', async () => {
  const publicadas = (await db.listarPecas({ status: 'publicada', limite: 500 })).length;
  politica.limites.publicacoes_por_dia = publicadas;
  try {
    const peca = await gerarPeca();
    const retida = await motor.aprovar(peca.id, 'teste');
    assert.equal(retida.status, 'aprovada');
    assert.equal(retida.publicacao.pendente, true);
    assert.match(retida.publicacao.motivo, /Limite/);
    politica.limites.publicacoes_por_dia = 100;
    assert.equal((await motor.publicarAgora(peca.id, 'teste')).status, 'publicada');
  } finally {
    politica.limites.publicacoes_por_dia = 100;
  }
});

await caso('Pausa geral: publicação retida, agenda parada e retomada publica o que ficou pendente', async () => {
  const peca = await gerarPeca();
  await motor.pausar('teste', 'Crise de imagem simulada');
  const retida = await motor.aprovar(peca.id, 'teste');
  assert.equal(retida.status, 'aprovada');
  assert.match(retida.publicacao.motivo, /pausado/);
  const antes = (await db.listarPecas({ limite: 2000 })).length;
  await motor.cicloAutomatico();
  assert.equal((await db.listarPecas({ limite: 2000 })).length, antes, 'pausado, o ciclo automático não gera nada');
  await motor.retomar('teste');
  assert.equal((await db.obterPeca(peca.id)).status, 'publicada');
});

await caso('Limite diário de gerações', async () => {
  const geradas = (await db.listarPecas({ limite: 2000 })).length;
  politica.limites.geracoes_por_dia = geradas;
  try {
    await assert.rejects(gerarPeca(), (erro) => erro.status === 429);
  } finally {
    politica.limites.geracoes_por_dia = 100;
  }
});

await caso('Programação: agenda no próximo horário, publica na hora marcada, respeita a pausa e gera antes do horário', async () => {
  const dbProg = await criarArmazenamentoLocal({ diretorio: path.join(temporario, 'programacao'), urlPublica: '' });
  let relogio = new Date('2026-09-29T18:30:00Z'); // terça, 15:30 em São Paulo
  const m = criarMotor({ db: dbProg, ia: iaSimulada, imagem: imagemSimulada, fotos: fotosSimuladas, canal: criarCanalInstagram(), sortear: () => 0.99, agora: () => relogio });
  const gerarAqui = () => m.gerar({ origem: 'manual', usuario: 'teste', aguardar: true });

  const p1 = await gerarAqui();
  assert.equal(p1.status, 'em_revisao');
  await assert.rejects(m.aprovar(p1.id, 'Diogo', { quando: 'proximo' }), /Não há horários/);

  await assert.rejects(m.salvarProgramacao({ horarios: [{ dia: 3, hora: '27:00' }] }, 'Diogo'), /Horário inválido/);
  const prog = await m.salvarProgramacao(
    { horarios: [{ dia: 5, hora: '18:30' }, { dia: 3, hora: '09:00' }], gerar_automaticamente: true, antecedencia_horas: 12 },
    'Diogo',
  );
  assert.equal(prog.proximos[0].para, '2026-09-30T12:00:00.000Z'); // quarta 09:00 em São Paulo
  assert.equal((await m.detalhe(p1.id)).sugestao_agendamento, '2026-09-30T12:00:00.000Z');

  const ag1 = await m.aprovar(p1.id, 'Diogo', { quando: 'proximo' });
  assert.equal(ag1.status, 'agendada');
  assert.equal(ag1.agendamento.para, '2026-09-30T12:00:00.000Z');

  const p2 = await gerarAqui();
  const ag2 = await m.aprovar(p2.id, 'Diogo', { quando: 'proximo' });
  assert.equal(ag2.agendamento.para, '2026-10-02T21:30:00.000Z', 'segunda peça vai para o horário seguinte (sexta 18:30)');
  const p3 = await gerarAqui();
  await assert.rejects(m.aprovar(p3.id, 'Diogo', { quando: '2026-09-29T10:00:00Z' }), /futuro/);
  assert.equal((await m.cancelarAgendamento(p2.id, 'Diogo')).status, 'em_revisao');

  await m.tickProgramacao();
  assert.equal((await m.detalhe(p1.id)).peca.status, 'agendada', 'antes da hora nada sai');

  relogio = new Date('2026-09-30T12:00:30Z');
  await m.pausar('Diogo', 'teste de pausa');
  await m.tickProgramacao();
  assert.equal((await m.detalhe(p1.id)).peca.status, 'agendada', 'pausa segura a publicação agendada');
  await m.retomar('Diogo');
  await m.tickProgramacao();
  const publicada = (await m.detalhe(p1.id)).peca;
  assert.equal(publicada.status, 'publicada');
  assert.equal(publicada.publicacao.ator, 'sistema:programacao');

  // Sexta 07:00 em São Paulo: faltam 11h30 para o horário das 18:30, dentro da antecedência de 12h.
  relogio = new Date('2026-10-02T10:00:00Z');
  await m.tickProgramacao();
  for (let i = 0; i < 400 && (await m.estado()).em_geracao; i++) await new Promise((r) => setTimeout(r, 25));
  const geradas = (await dbProg.listarPecas()).filter((p) => p.para_horario === '2026-10-02T21:30:00.000Z');
  assert.equal(geradas.length, 1);
  assert.equal(geradas[0].origem, 'programacao');
  assert.equal(geradas[0].status, 'em_revisao');
  await m.tickProgramacao();
  assert.equal((await dbProg.listarPecas()).filter((p) => p.para_horario === '2026-10-02T21:30:00.000Z').length, 1, 'não gera duas vezes');

  const ag3 = await m.aprovar(geradas[0].id, 'Diogo', { quando: 'proximo' });
  assert.equal(ag3.agendamento.para, '2026-10-02T21:30:00.000Z', 'peça gerada para um horário fica nele');
  const ag4 = await m.aprovar(p2.id, 'Diogo', { quando: 'proximo' });
  assert.equal(ag4.agendamento.para, '2026-10-07T12:00:00.000Z');
  assert.equal(
    (await m.reagendar(p2.id, 'Diogo', '2026-10-03T12:00')).agendamento.para,
    '2026-10-03T15:00:00.000Z',
    'data sem fuso vale no fuso do sistema (12:00 em São Paulo)',
  );
  assert.equal((await m.publicarAgora(p2.id, 'Diogo')).status, 'publicada');
  const visao = await m.programacao();
  assert.ok(visao.agendadas.some((a) => a.id === geradas[0].id));
});

await caso('Carrossel, flashcards, foto real e peça só com design', async () => {
  const antesImagens = promptsImagem.length;

  // Carrossel de 5 imagens só com design: nenhuma imagem de IA nem foto.
  const car = await gerarPeca({ orientacao: { formato: 'carrossel', visual: 'design', num_slides: 5 } });
  assert.equal(car.formato, 'carrossel');
  assert.equal(car.slides_arte.length, 5);
  assert.equal(car.arte.url, car.slides_arte[0].url, 'a capa é a arte principal');
  assert.equal(car.imagem, null);
  assert.equal(car.textos.slides.length, 3);
  assert.equal(promptsImagem.length, antesImagens, 'design não chama a IA de imagem');
  const pedidoTextos = chamadas.filter((c) => c.ferramenta === 'escrever_textos').at(-1);
  assert.equal(pedidoTextos.schema.properties.slides.minItems, 3);
  const revisao = chamadas.filter((c) => c.ferramenta === 'avaliar_peca').at(-1);
  const rotulos = revisao.conteudo.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  assert.ok(!rotulos.includes('IMAGEM DE FUNDO') && rotulos.includes('SLIDE 5 de 5'), 'o revisor vê os 5 slides e nenhum fundo');
  const detalheCar = await motor.detalhe(car.id);
  assert.ok(!detalheCar.legenda_final.includes(politica.rotulo_ia), 'sem imagem de IA, sem rótulo de IA');

  // Edição de um slide refaz todas as imagens e passa pelas travas de novo.
  const novosSlides = structuredClone(car.textos.slides);
  novosSlides[1].texto = 'Texto revisado pela equipe, curto e direto.';
  await motor.editarTextos(car.id, 'Diogo', { slides: novosSlides });
  const editada = await aguardarProcessamento(car.id);
  assert.equal(editada.textos.slides[1].texto, 'Texto revisado pela equipe, curto e direto.');
  assert.notEqual(editada.slides_arte[2].url, car.slides_arte[2].url);
  assert.equal(editada.status, 'em_revisao');
  await assert.rejects(motor.editarTextos(car.id, 'Diogo', { slides: novosSlides.slice(0, 2) }), /quantidade de slides/);

  // Termo proibido dentro de um slide bloqueia a peça.
  roteiro = { textos: { slides: [{ titulo: 'Retorno garantido existe?', texto: 'Não existe.' }, ...slidesSimulados(2)] } };
  const proibida = await gerarPeca({ orientacao: { formato: 'carrossel', visual: 'design', num_slides: 5 } });
  roteiro = {};
  assert.equal(proibida.governanca.gate.veredito, 'bloqueada');

  // Flashcards com foto real: crédito na arte e na legenda, sem rótulo de IA.
  const flash = await gerarPeca({ orientacao: { formato: 'flashcards', visual: 'foto', num_slides: 4 } });
  assert.equal(flash.formato, 'flashcards');
  assert.equal(flash.slides_arte.length, 4);
  assert.equal(flash.imagem.origem, 'foto');
  const detalheFlash = await motor.detalhe(flash.id);
  assert.ok(detalheFlash.legenda_final.includes('Foto: Fotógrafa Teste / Pexels'));
  assert.ok(!detalheFlash.legenda_final.includes(politica.rotulo_ia));
  await motor.regenerarImagem(flash.id, 'Diogo');
  const outraFoto = await aguardarProcessamento(flash.id);
  assert.notEqual(outraFoto.imagem.foto_id, flash.imagem.foto_id, 'pedir outra foto não repete a anterior');

  // Aprovar publica o carrossel inteiro (simulação conta as imagens).
  const publicada = await motor.aprovar(flash.id, 'Diogo');
  assert.equal(publicada.status, 'publicada');
  assert.equal(publicada.publicacao.itens, 4);

  // Post único só com design também funciona.
  const post = await gerarPeca({ orientacao: { visual: 'design' } });
  assert.equal(post.formato, 'post');
  assert.equal(post.slides_arte, null);
  assert.equal(post.imagem, null);

  // Sem chave do banco de fotos, a escolha "foto" é recusada com mensagem clara.
  const semFotos = criarMotor({ db, ia: iaSimulada, imagem: imagemSimulada, fotos: { disponivel: false }, canal: criarCanalInstagram() });
  await assert.rejects(semFotos.gerar({ orientacao: { visual: 'foto' } }), /PEXELS_API_KEY/);

  const slidesPrevia = await Promise.all(editada.slides_arte.map((sl) => db.lerMidia(sl.chave)));
  for (const [i, b] of slidesPrevia.entries()) await fs.writeFile(path.join(saida, `previa-carrossel-${i + 1}.jpg`), b);
});

await caso('Novo visual com pedido de correção: layout, nova cena, nova foto e sem limite diário', async () => {
  // Carrossel só com design: pedido só de layout mantém a composição e muda o resto.
  const car = await gerarPeca({ orientacao: { formato: 'carrossel', visual: 'design', num_slides: 5 } });
  roteiro = {
    ajuste: {
      trocar_imagem: false,
      resumo: 'Fundo escuro, sem números grandes e sem contador.',
      fora_do_visual: 'Tirar "Passo 1" dos títulos.',
      design: { fundo: 'escuro', numeros_grandes: 'nao', contador: false },
    },
  };
  await motor.regenerarImagem(car.id, 'Diogo', 'tira os números grandes e o contador, fundo escuro, e tira o Passo 1 do título');
  const ajustada = await aguardarProcessamento(car.id);
  roteiro = {};
  const pedido = chamadas.filter((c) => c.ferramenta === 'ajustar_visual').at(-1);
  assert.ok(pedido.conteudo.includes('tira os números grandes'), 'o agente recebe o pedido da equipe');
  assert.equal(ajustada.design.fundo, 'escuro');
  assert.equal(ajustada.design.numeros_grandes, 'nao');
  assert.equal(ajustada.design.contador, false);
  assert.equal(ajustada.design_semente || 1, car.design_semente || 1, 'só layout: a composição fica');
  assert.notEqual(ajustada.slides_arte[1].url, car.slides_arte[1].url, 'os slides foram refeitos');
  assert.equal(ajustada.status, 'em_revisao');
  const trilha = (await motor.detalhe(car.id)).auditoria;
  const registro = trilha.find((a) => a.ator === 'ia:diretor');
  assert.ok(registro.resumo.includes('Fundo escuro') && registro.resumo.includes('Para editar no texto'));

  // Imagem de IA: o pedido vira uma cena nova em inglês, usada na nova imagem.
  const post = await gerarPeca();
  roteiro = { ajuste: { trocar_imagem: true, nova_cena_en: 'A young woman reading in a sunny park.' } };
  const antes = promptsImagem.length;
  await motor.regenerarImagem(post.id, 'Diogo', 'quero uma jovem num parque');
  const novaIa = await aguardarProcessamento(post.id);
  roteiro = {};
  assert.equal(promptsImagem.length, antes + 1);
  assert.ok(promptsImagem.at(-1).includes('A young woman reading in a sunny park.'));
  assert.ok(!promptsImagem.at(-1).includes('quero uma jovem'), 'o pedido entra na cena reescrita, não cru');
  assert.equal(novaIa.cena_ajustada_en, 'A young woman reading in a sunny park.');

  // Foto real: o pedido vira uma nova busca no banco de imagens.
  const comFoto = await gerarPeca({ orientacao: { visual: 'foto' } });
  roteiro = { ajuste: { trocar_imagem: true, nova_busca_foto_en: 'young man studying home' } };
  await motor.regenerarImagem(comFoto.id, 'Diogo', 'um rapaz estudando em casa');
  await aguardarProcessamento(comFoto.id);
  roteiro = {};
  assert.equal(consultasDeFoto.at(-1), 'young man studying home');

  // Sem limite diário: com os limites vazios, gerar e publicar seguem sem trava.
  const limites = { ...politica.limites };
  politica.limites.geracoes_por_dia = null;
  politica.limites.publicacoes_por_dia = null;
  try {
    const extra = await gerarPeca();
    assert.equal(extra.status, 'em_revisao');
    assert.equal((await motor.aprovar(extra.id, 'Diogo')).status, 'publicada');
  } finally {
    Object.assign(politica.limites, limites);
  }
});

await caso('Ajuste de texto com IA: reescreve a partir do pedido, refaz a arte e passa pelas travas', async () => {
  const car = await gerarPeca({ orientacao: { formato: 'carrossel', visual: 'design', num_slides: 5 } });
  const novos = [
    { titulo: 'Saiba quanto deve', texto: 'Some tudo o que falta pagar na fatura.' },
    { titulo: 'Pare de usar o cartão', texto: 'Assim a dívida para de crescer.' },
    { titulo: 'Procure uma dívida mais barata', texto: 'Compare o custo total antes de trocar.' },
  ];
  roteiro = {
    reescrita: {
      slides: novos,
      legenda: 'Três atitudes simples para sair do rotativo. Salve este post.',
      resumo_da_mudanca: 'Tirei a numeração dos títulos e encurtei a legenda.',
    },
  };
  await motor.ajustarTextosComIa(car.id, 'Diogo', 'tira a numeração dos títulos e deixa a legenda mais curta');
  const ajustada = await aguardarProcessamento(car.id);
  roteiro = {};
  const pedido = chamadas.filter((c) => c.ferramenta === 'reescrever_textos').at(-1);
  assert.ok(pedido.conteudo.includes('tira a numeração dos títulos'), 'a IA recebe o pedido');
  assert.ok(pedido.conteudo.includes('Slide 2.') && pedido.conteudo.includes('Slide final'), 'a IA vê os slides numerados como o leitor');
  assert.equal(pedido.schema.properties.slides.minItems, 3, 'mesma quantidade de slides');
  assert.deepEqual(ajustada.textos.slides, novos);
  assert.equal(ajustada.textos.legenda, 'Três atitudes simples para sair do rotativo. Salve este post.');
  assert.equal(ajustada.textos.resumo_da_mudanca, undefined, 'o resumo não vira texto da peça');
  assert.notEqual(ajustada.slides_arte[1].url, car.slides_arte[1].url, 'a arte foi refeita');
  assert.equal(ajustada.status, 'em_revisao');
  assert.equal(ajustada.intervencao_humana, true);
  const trilha = (await motor.detalhe(car.id)).auditoria;
  assert.ok(trilha.some((a) => a.ator === 'ia:redator' && a.resumo.includes('Tirei a numeração')));

  // As travas continuam valendo: se o texto reescrito tiver termo proibido, a peça fica bloqueada.
  roteiro = { reescrita: { legenda: 'Com esse método o lucro é garantido. Salve este post.' } };
  await motor.ajustarTextosComIa(car.id, 'Diogo', 'promete que dá lucro');
  const bloqueada = await aguardarProcessamento(car.id);
  roteiro = {};
  assert.equal(bloqueada.governanca.gate.veredito, 'bloqueada');

  // Post único também pode ser ajustado; pedido vazio é recusado.
  const post = await gerarPeca();
  roteiro = { reescrita: { titulo: 'Senha pelo telefone? É golpe' } };
  await motor.ajustarTextosComIa(post.id, 'Diogo', 'título mais direto');
  assert.equal((await aguardarProcessamento(post.id)).textos.titulo, 'Senha pelo telefone? É golpe');
  roteiro = {};
  await assert.rejects(motor.ajustarTextosComIa(post.id, 'Diogo', '   '), /Escreva o que/);
});

await caso('Perfil ativo: marca, política e públicos válidos', async () => {
  const { marca: m, politica: p, segmentos: seg } = perfilAtivo;
  const { contraste } = await import('./util.js');
  assert.ok(m.nome && m.descricao && m.tom_de_voz);
  assert.ok(contraste(m.cores.texto_sobre_primaria, m.cores.primaria) >= 4.5, 'texto sobre a cor principal legível');
  assert.ok(contraste(m.cores.texto_sobre_secundaria, m.cores.secundaria) >= 4.5, 'texto sobre a cor de destaque legível');
  for (const arquivo of [...Object.values(m.fontes), m.logo, ...Object.values(m.logos || {})].filter(Boolean)) await fs.access(path.join(raiz, arquivo));
  for (const [id, c] of Object.entries(p.categorias)) {
    assert.ok(c.nome && ['baixo', 'medio', 'alto'].includes(c.risco) && ['auto', 'humano'].includes(c.autonomia_maxima), `categoria ${id}`);
  }
  assert.equal(new Set(seg.map((s) => s.id)).size, seg.length, 'públicos sem id repetido');
  if (p.radar?.busca_web) assert.ok(Object.values(p.categorias).some((c) => c.exige_fonte), 'busca ligada com categorias de notícia');
});

await caso('Notícia com busca na web: fonte conferida, trava de fonte, fatos no texto e fonte na legenda', async () => {
  const guardado = structuredClone({ radar: politica.radar, noticias: politica.noticias, travas: politica.travas, categorias: politica.categorias });
  politica.radar = { busca_web: true, max_buscas: 4, dominios_confiaveis: ['motorsport.com'], criterios: ['Notícias quentes do automobilismo.'] };
  politica.noticias = { max_dias: 3 };
  politica.travas = { numeros_financeiros: false };
  politica.categorias.noticia = { nome: 'Notícia do dia', risco: 'medio', autonomia_maxima: 'auto', exige_fonte: true };
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const antigo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  const fonte = (url, data = hoje) => ({ url, veiculo: 'Motorsport.com', titulo: 'Piloto X vence o GP Y', data_publicacao: data });
  try {
    roteiro = {
      oportunidade: { categoria: 'noticia', gatilho: 'noticia_recente', fontes: [fonte('https://www.motorsport.com/f1/news/x/')], fatos: ['Piloto X venceu o GP Y.'] },
      buscas: [{ url: 'https://motorsport.com/f1/news/x', titulo: 'Piloto X vence o GP Y' }],
      textos: { legenda: 'Ele somou 25 pontos e liderou 60% das voltas. Salve este post.' },
    };
    const boa = await gerarPeca({ orientacao: { categoria: 'noticia' } });
    const pedidoRadar = chamadas.filter((c) => c.ferramenta === 'propor_oportunidade').at(-1);
    assert.equal(pedidoRadar.servidor[0].type, 'web_search_20250305', 'o radar pesquisa na web');
    assert.deepEqual(pedidoRadar.servidor[0].allowed_domains, ['motorsport.com']);
    assert.ok(pedidoRadar.sistema.includes('Busca na web'));
    assert.equal(boa.oportunidade.fontes[0].verificada, true, 'endereço igual ao da busca, com ou sem www e barra final');
    const regras = boa.governanca.regras;
    assert.ok(regras.find((r) => r.id === 'fonte_da_noticia').ok);
    assert.ok(!regras.some((r) => r.id === 'numeros_so_do_catalogo'), 'perfil sem trava de números financeiros');
    const pedidoTextos = chamadas.filter((c) => c.ferramenta === 'escrever_textos').at(-1);
    assert.ok(pedidoTextos.conteudo.includes('Piloto X venceu o GP Y.'), 'o redator recebe os fatos confirmados');
    const pedidoRevisor = chamadas.filter((c) => c.ferramenta === 'avaliar_peca').at(-1);
    assert.ok(pedidoRevisor.conteudo.some((b) => b.type === 'text' && b.text.includes('Fatos confirmados nas fontes')));
    assert.ok((await motor.detalhe(boa.id)).legenda_final.includes('Fonte: Motorsport.com'));

    // Fonte que não apareceu na busca: bloqueada.
    roteiro = { ...roteiro, oportunidade: { ...roteiro.oportunidade, fontes: [fonte('https://site-inventado.com/noticia')] } };
    const inventada = await gerarPeca({ orientacao: { categoria: 'noticia' } });
    assert.equal(inventada.oportunidade.fontes[0].verificada, false);
    assert.equal(inventada.governanca.gate.veredito, 'bloqueada');
    assert.ok(!(await motor.detalhe(inventada.id)).legenda_final.includes('Fonte:'), 'fonte não conferida não vai para a legenda');

    // Fonte conferida, mas antiga: bloqueada.
    roteiro = { ...roteiro, oportunidade: { ...roteiro.oportunidade, fontes: [fonte('https://www.motorsport.com/f1/news/x/', antigo)] } };
    const velha = await gerarPeca({ orientacao: { categoria: 'noticia' } });
    assert.equal(velha.governanca.gate.veredito, 'bloqueada');
    assert.match(velha.governanca.regras.find((r) => r.id === 'fonte_da_noticia').detalhe, /mais de 3 dias/);

    // Site que bloqueia a busca da Anthropic: sai da lista e a busca é refeita, sem parar a geração.
    politica.radar.dominios_confiaveis = ['motorsport.com', 'bbc.com', 'reuters.com'];
    roteiro = { ...roteiro, recusarSites: ['bbc.com', 'reuters.com'], oportunidade: { ...roteiro.oportunidade, fontes: [fonte('https://www.motorsport.com/f1/news/x/')] } };
    const refeita = await gerarPeca({ orientacao: { categoria: 'noticia' } });
    const tentativas = chamadas.filter((c) => c.ferramenta === 'propor_oportunidade').slice(-2);
    assert.deepEqual(tentativas[0].servidor[0].allowed_domains, ['motorsport.com', 'bbc.com', 'reuters.com']);
    assert.deepEqual(tentativas[1].servidor[0].allowed_domains, ['motorsport.com'], 'refaz a busca sem os sites que bloquearam');
    assert.equal(refeita.status, 'em_revisao');
  } finally {
    roteiro = {};
    Object.assign(politica, guardado);
    for (const chave of ['radar', 'noticias', 'travas']) if (guardado[chave] === undefined) delete politica[chave];
  }
});

await caso('Busca na web na chamada à IA: continua depois da pausa e devolve os resultados', async () => {
  const fetchOriginal = globalThis.fetch;
  const pedidos = [];
  const resposta = (corpo) => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'modelo-teste', usage: { input_tokens: 1, output_tokens: 1 }, ...corpo }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'request-id': 'req_teste' },
  });
  globalThis.fetch = async (url, op) => {
    const corpo = JSON.parse(op.body);
    pedidos.push(corpo);
    if (pedidos.length === 1) {
      return resposta({
        stop_reason: 'pause_turn',
        content: [
          { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'f1 hoje' } },
          { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://www.formula1.com/en/latest/a', title: 'A', page_age: '1 day ago', encrypted_content: 'x' }] },
        ],
      });
    }
    return resposta({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'propor_oportunidade', input: { tema: 'Tema' } }] });
  };
  try {
    const { chamarFerramenta } = await import('./claude.js');
    const r = await chamarFerramenta({
      modelo: 'modelo-teste',
      sistema: 'Sistema.',
      conteudo: 'Conteúdo.',
      ferramenta: { name: 'propor_oportunidade', description: 'x', input_schema: { type: 'object', properties: { tema: { type: 'string' } } } },
      ferramentasServidor: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    });
    assert.deepEqual(r.dados, { tema: 'Tema' });
    assert.equal(r.buscas[0].url, 'https://www.formula1.com/en/latest/a');
    assert.equal(pedidos[0].tool_choice.type, 'auto', 'com busca, o modelo tem liberdade para pesquisar');
    assert.equal(pedidos[0].tools[0].type, 'web_search_20250305');
    assert.equal(pedidos[1].messages.at(-1).role, 'assistant', 'a continuação devolve o turno pausado');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await caso('Foto real do Wikimedia Commons: licença livre, crédito completo e revisão humana obrigatória', async () => {
  const { criarBancoDeFotos } = await import('./fotos.js');
  const { consolidarGate } = await import('./autonomia.js');
  const { NOTAS } = await import('./juiz.js');
  const { montarLegendaFinal } = await import('./agentes.js');
  const { createCanvas } = await import('@napi-rs/canvas');
  const quadro = createCanvas(1200, 900);
  quadro.getContext('2d').fillRect(0, 0, 1200, 900);
  const jpeg = await quadro.encode('jpeg');
  const info = (extra) => ({ mime: 'image/jpeg', width: 3000, height: 2000, url: 'https://upload.wikimedia.org/x.jpg', ...extra });
  const api = {
    query: {
      pages: [
        { pageid: 1, index: 1, imageinfo: [info({ extmetadata: { LicenseShortName: { value: 'GFDL' } } })] },
        { pageid: 2, index: 2, imageinfo: [info({ width: 400, height: 300, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } })] },
        {
          pageid: 3,
          index: 3,
          imageinfo: [
            info({
              thumburl: 'https://upload.wikimedia.org/thumb/x.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Piloto.jpg',
              extmetadata: {
                LicenseShortName: { value: 'CC BY-SA 4.0' },
                LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
                Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:F">Fotógrafo Exemplo</a>' },
              },
            }),
          ],
        },
      ],
    },
  };
  const pedidos = [];
  const buscarNaRede = async (url, op = {}) => {
    pedidos.push({ url, op });
    return url.includes('api.php')
      ? new Response(JSON.stringify(api), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const banco = criarBancoDeFotos({ provedores: ['wikimedia'], buscarNaRede, chave: '' });
  assert.equal(banco.disponivel, true, 'Wikimedia Commons não precisa de chave');
  const foto = await banco.buscar('Gabriel Bortoleto 2025');
  assert.equal(foto.id, 'wikimedia:3', 'descarta licença que não é livre e foto pequena');
  assert.equal(foto.editorial, true);
  assert.deepEqual(
    { autor: foto.credito.autor, licenca: foto.credito.licenca, mesma: foto.credito.compartilha_igual },
    { autor: 'Fotógrafo Exemplo', licenca: 'CC BY-SA 4.0', mesma: true },
  );
  assert.ok(pedidos[0].op.headers['User-Agent'], 'identifica o sistema, como o Wikimedia pede');
  assert.ok(pedidos[0].url.includes('gsrnamespace=6'));
  const legenda = montarLegendaFinal({ textos: { legenda: 'Texto.', hashtags: [] }, visual: 'foto', credito: foto.credito });
  assert.ok(legenda.includes('Fotógrafo Exemplo / Wikimedia Commons (CC BY-SA 4.0'));
  assert.ok(legenda.includes('mesma licença'));

  const guardado = politica.visao_foto_editorial;
  politica.visao_foto_editorial = { pessoa_publica: 'alerta', logos_ou_marcas: 'alerta', texto_no_fundo: 'alerta' };
  try {
    const notas = Object.fromEntries(Object.keys(NOTAS).map((k) => [k, 9]));
    const juiz = { notas, risco_reputacional: 'baixo', aprovaria_sem_edicao: true, elementos_no_fundo: { pessoa_publica: true, logos_ou_marcas: true } };
    assert.equal(consolidarGate({ regras: [], juiz, editorial: true }).veredito, 'precisa_humano', 'piloto real em foto licenciada: uma pessoa confere');
    assert.equal(consolidarGate({ regras: [], juiz, editorial: false }).veredito, 'bloqueada', 'pessoa pública em imagem de IA continua bloqueada');
    const vazia = consolidarGate({ regras: [], juiz: { ...juiz, elementos_no_fundo: {} }, editorial: true });
    assert.equal(vazia.veredito, 'precisa_humano', 'foto editorial nunca sai sem revisão humana');
    assert.ok(vazia.motivos.some((m) => m.id === 'foto_editorial'));
  } finally {
    politica.visao_foto_editorial = guardado;
  }
});

await caso('Carrossel em pista: só design e pista contínua de uma imagem para a outra', async () => {
  const antes = promptsImagem.length;
  const peca = await gerarPeca({ orientacao: { formato: 'pista', visual: 'ia', num_slides: 5 } });
  assert.equal(peca.formato, 'pista');
  assert.equal(peca.visual, 'design', 'a pista é a imagem: não chama IA de imagem');
  assert.equal(promptsImagem.length, antes);
  assert.equal(peca.slides_arte.length, 5);
  const pedido = chamadas.filter((c) => c.ferramenta === 'escrever_textos').at(-1);
  assert.ok(pedido.sistema.includes('Carrossel em pista'));
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const coluna = async (chave, x) => {
    const img = await loadImage(await db.lerMidia(chave));
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(x, 760, 1, 560).data;
  };
  for (let k = 0; k < 4; k++) {
    const direita = await coluna(peca.slides_arte[k].chave, 1079);
    const esquerda = await coluna(peca.slides_arte[k + 1].chave, 0);
    let diferenca = 0;
    let claros = 0;
    for (let i = 0; i < direita.length; i += 4) {
      diferenca += Math.abs(direita[i] - esquerda[i]) + Math.abs(direita[i + 1] - esquerda[i + 1]) + Math.abs(direita[i + 2] - esquerda[i + 2]);
      if (direita[i] > 150) claros++;
    }
    assert.ok(diferenca / (direita.length / 4) < 45, `pista contínua entre as imagens ${k + 1} e ${k + 2}`);
    assert.ok(claros > 5, `a zebra da pista aparece na borda da imagem ${k + 1}`);
  }
});

await caso('Modo demonstração ou canal manual: nunca publica no Instagram, mesmo com token configurado', async () => {
  if (perfilAtivo.politica.demonstracao !== true && perfilAtivo.politica.canal?.tipo !== 'manual') return;
  const { execFileSync } = await import('node:child_process');
  const saida = execFileSync(
    process.execPath,
    ['-e', "import('./config.js').then((c) => console.log(c.env.publicacaoModo))"],
    { cwd: raiz, env: { ...process.env, PUBLICACAO_MODO: 'real', IG_ACCESS_TOKEN: 'token-de-teste' }, encoding: 'utf8' },
  ).trim();
  assert.equal(saida, 'simulacao');
});

await caso('Layout corporativo: post, carrossel e flashcards com os logos da marca', async () => {
  if (perfilAtivo.marca.layout !== 'corporativo') return;
  const { renderizarArte, renderizarCarrossel } = await import('./arte.js');
  const { loadImage } = await import('@napi-rs/canvas');
  const guardado = { layout: marca.layout, logos: marca.logos, cores: marca.cores };
  Object.assign(marca, { layout: 'corporativo', logos: perfilAtivo.marca.logos, cores: perfilAtivo.marca.cores });
  try {
    const textos = {
      titulo: 'Ligação pedindo senha é golpe',
      subtitulo: 'O banco nunca pede senha por telefone.',
      cta_arte: 'Salve e compartilhe',
      fechamento: 'Na dúvida, desligue e ligue você.',
      slides: [
        { titulo: 'Desconfie da pressa', texto: 'Golpista cria urgência para você agir sem pensar.' },
        { titulo: 'Confira o número', texto: 'Ligue você para o número que está no verso do cartão.' },
        { titulo: 'Nunca passe códigos', texto: 'Código recebido por SMS é só seu.' },
      ],
    };
    const post = await renderizarArte({ fundo: null, textos, oferta: null, visual: 'design' });
    const img = await loadImage(post.buffer);
    assert.deepEqual([img.width, img.height], [1080, 1350]);
    assert.equal(post.ajustes.transbordou, false);
    for (const formato of ['carrossel', 'flashcards']) {
      const r = await renderizarCarrossel({ fundo: null, textos, oferta: null, formato, visual: 'design', design: {} });
      assert.equal(r.slides.length, 5, formato);
      assert.equal(r.ajustes.transbordou, false, formato);
    }
  } finally {
    Object.assign(marca, guardado);
  }
});

await caso('Base de conhecimento: números só da base, sem preços, e PDF do carrossel', async () => {
  const { conhecimento } = await import('./config.js');
  if (!conhecimento) return;
  const guardado = politica.travas;
  politica.travas = { numeros_financeiros: false, numeros_da_base: true };
  try {
    roteiro = { textos: { legenda: 'Vimos +500% na taxa de conversão e 3,7x de ganho de produtividade. Vamos conversar?' } };
    const boa = await gerarPeca();
    const regra = (p) => p.governanca.regras.find((r) => r.id === 'numeros_da_base');
    assert.equal(regra(boa).ok, true, 'números que estão na base passam');
    roteiro = { textos: { legenda: 'Vimos +250% na taxa de conversão. Vamos conversar?' } };
    const inventada = await gerarPeca();
    assert.equal(regra(inventada).ok, false);
    assert.match(regra(inventada).detalhe, /250%/);
    assert.equal(inventada.governanca.gate.veredito, 'bloqueada');
    roteiro = { textos: { legenda: 'O diagnóstico custa R$ 311 mil. Vamos conversar?' } };
    const comPreco = await gerarPeca();
    assert.match(regra(comPreco).detalhe, /Valor em reais/);
  } finally {
    politica.travas = guardado;
    roteiro = {};
  }
  const car = await gerarPeca({ orientacao: { formato: 'carrossel', visual: 'design', num_slides: 4 } });
  const pdf = await motor.pdfDaPeca(car.id);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page /g) || []).length, 4, 'uma página por imagem');
});

await caso('Régua de comunicação: calendário sem feriados, montagem com IA, post gerado e PDF', async () => {
  const { distribuirDatas, pascoa } = await import('./regua.js');
  assert.equal(pascoa(2026).toISOString().slice(0, 10), '2026-04-05');
  const { datas, pulados } = distribuirDatas({ inicio: '2026-11-17', diasSemana: [2, 4, 5], total: 4 });
  assert.deepEqual(datas, ['2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']);
  assert.equal(pulados[0].motivo, 'Dia da Consciência Negra');

  const regua = await motor.criarRegua('Diogo', { objetivo: 'Teste', total: 5, inicio: '2026-11-03', dias_semana: [2, 4], obrigatorios: 'Reconhecimento' });
  assert.equal(regua.itens.length, 5);
  assert.deepEqual(regua.itens.map((i) => i.data), ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17']);
  const pedido = chamadas.filter((c) => c.ferramenta === 'planejar_regua').at(-1);
  assert.equal(pedido.schema.properties.itens.minItems, 5);
  assert.ok(pedido.conteudo.includes('Reconhecimento'), 'itens obrigatórios chegam à IA');
  assert.equal((await motor.listarReguas())[0].id, regua.id);

  // Gerar o post de um item: vira peça com a orientação do item e fica ligada à régua.
  const item = regua.itens[1];
  const { regua: depois, peca } = await motor.gerarPecaDaRegua(regua.id, item.id, 'Diogo');
  await aguardarProcessamento(peca.id);
  const gerada = await motor.detalhe(peca.id);
  assert.equal(gerada.peca.origem, 'regua');
  assert.ok(gerada.peca.orientacao.texto.includes('Tema 2'));
  assert.equal(gerada.peca.orientacao.categoria, item.categoria);
  const ligado = (await motor.obterRegua(regua.id)).itens.find((i) => i.id === item.id);
  assert.equal(ligado.peca.id, peca.id);
  assert.ok(depois.itens.find((i) => i.id === item.id).peca_id);

  // Mudar a data reordena a régua.
  const ultimo = regua.itens[4];
  const reordenada = await motor.atualizarItemRegua(regua.id, ultimo.id, { data: '2026-11-01' });
  assert.equal(reordenada.itens[0].id, ultimo.id);
  await assert.rejects(motor.atualizarItemRegua(regua.id, ultimo.id, { data: '01/11/2026' }), /Data inválida/);

  const pdf = await motor.pdfDaRegua(regua.id);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  // Régua pronta (sugerida) também entra, com as datas recalculadas.
  const importada = await motor.importarRegua('Diogo', {
    nome: 'Sugerida',
    cadencia: { inicio: '2026-11-17', dias_semana: [2, 4, 5] },
    itens: [{ titulo: 'A' }, { titulo: 'B' }, { titulo: 'C' }],
  });
  assert.deepEqual(importada.itens.map((i) => i.data), ['2026-11-17', '2026-11-19', '2026-11-24']);
  await motor.excluirRegua(importada.id);
  assert.ok(!(await motor.listarReguas()).some((r) => r.id === importada.id));
});

await caso('Playbook da Capgemini: degradê, destaque por cor, barra de progresso e só design', async () => {
  if (perfilAtivo.marca.layout !== 'playbook') return;
  const { renderizarArte, renderizarCarrossel } = await import('./arte.js');
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const guardado = { layout: marca.layout, logos: marca.logos, cores: marca.cores, playbook: marca.playbook };
  Object.assign(marca, { layout: 'playbook', logos: perfilAtivo.marca.logos, cores: perfilAtivo.marca.cores, playbook: perfilAtivo.marca.playbook });
  try {
    const textos = {
      titulo: 'Martech robusta não é só sobre ter mais tecnologia. É sobre gerar mais valor.',
      titulo_destaque: 'mais valor.',
      subtitulo: 'Como transformar investimentos em plataformas, dados e automação em crescimento.',
      rotulo_arte: 'Maturidade em Martech',
      cta_arte: 'Leia no post',
      fechamento: 'Quantos desses sinais você reconhece hoje?',
      fechamento_destaque: 'reconhece hoje?',
      slides: [
        { titulo: 'Investimentos em CRM fragmentados', texto: 'Cada área contrata a sua ferramenta.' },
        { titulo: 'Estratégia, dados e tecnologia em silos', texto: 'As decisões não conversam entre si.' },
        { titulo: 'Visibilidade limitada de ROI', texto: 'O investimento fica difícil de defender.' },
      ],
    };
    const post = await renderizarArte({ fundo: null, textos, oferta: null, visual: 'design', design: {} });
    assert.equal(post.ajustes.transbordou, false);
    const img = await loadImage(post.buffer);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const brilho = (x, y) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return r + g + b;
    };
    assert.ok(brilho(40, 300) < brilho(40, 1300), 'degradê do escuro (alto) para o claro (baixo)');
    for (const formato of ['carrossel', 'flashcards']) {
      const r = await renderizarCarrossel({ fundo: null, textos, oferta: null, formato, visual: 'design', design: {} });
      assert.equal(r.slides.length, 5, formato);
      assert.equal(r.ajustes.transbordou, false, formato);
    }
  } finally {
    Object.assign(marca, guardado);
  }

  // O playbook não permite imagem gerada por IA: o pedido vira "só design".
  const guardadoV = politica.visuais_permitidos;
  politica.visuais_permitidos = ['design'];
  try {
    const antes = promptsImagem.length;
    const peca = await gerarPeca({ orientacao: { visual: 'ia' } });
    assert.equal(peca.visual, 'design');
    assert.equal(promptsImagem.length, antes, 'nenhuma imagem de IA foi pedida');
  } finally {
    politica.visuais_permitidos = guardadoV;
  }
});

await caso('Artigo do LinkedIn: seções, capa 1920 x 1080, travas e formato só quando liberado', async () => {
  const guardado = politica.formatos_extras;
  politica.formatos_extras = ['artigo'];
  try {
    const peca = await gerarPeca({ orientacao: { formato: 'artigo', visual: 'design' } });
    assert.equal(peca.formato, 'artigo');
    assert.equal(peca.textos.secoes.length, 3);
    assert.ok(peca.textos.conclusao && peca.textos.chamada_final);
    assert.equal(peca.arte.largura, 1920);
    assert.equal(peca.arte.altura, 1080);
    const pedido = chamadas.filter((c) => c.ferramenta === 'escrever_textos').at(-1);
    assert.ok(pedido.schema.properties.secoes, 'o redator recebe o esquema do artigo');
    assert.match(pedido.sistema, /artigo do LinkedIn/);
    const travas = peca.governanca.regras;
    assert.ok(travas.find((r) => r.id === 'campos_obrigatorios').ok, 'artigo completo passa na trava de campos');
    // Uma seção com termo proibido aparece na trava, como em qualquer outro texto.
    const proibido = politica.termos_proibidos[0];
    if (proibido) {
      const { avaliarRegras } = await import('./regras.js');
      const r = avaliarRegras({ textos: { ...peca.textos, secoes: [{ intertitulo: 'Seção', texto: `Texto com ${proibido}.` }, ...peca.textos.secoes.slice(1)] }, categoriaId: peca.categoria, segmentoId: peca.segmento_id, arte: peca.arte, hoje: '2026-11-04', modoPublicacao: 'simulacao' });
      assert.equal(r.find((x) => x.id === 'termos_proibidos').ok, false);
    }
    // Na edição manual, a quantidade de seções não muda.
    await assert.rejects(motor.editarTextos(peca.id, 'teste', { secoes: peca.textos.secoes.slice(0, 2) }), /quantidade de seções/);
    const editada = await motor.editarTextos(peca.id, 'teste', { secoes: peca.textos.secoes.map((sc, i) => (i === 0 ? { ...sc, intertitulo: 'Novo intertítulo' } : sc)) });
    const final = await aguardarProcessamento(editada.id);
    assert.equal(final.textos.secoes[0].intertitulo, 'Novo intertítulo');
    assert.equal(final.arte.largura, 1920);

    // Capa no layout do playbook também cabe.
    const { renderizarCapaArtigo } = await import('./arte.js');
    const guardadoMarca = { layout: marca.layout, logos: marca.logos, cores: marca.cores, playbook: marca.playbook };
    Object.assign(marca, { layout: 'playbook', logos: perfilAtivo.marca.logos, cores: perfilAtivo.marca.cores, playbook: perfilAtivo.marca.playbook });
    try {
      const capa = await renderizarCapaArtigo({ textos: { ...peca.textos, titulo_destaque: 'decisões', rotulo_arte: 'Artigo' }, design: {} });
      assert.equal(capa.ajustes.transbordou, false);
    } finally {
      Object.assign(marca, guardadoMarca);
    }
  } finally {
    politica.formatos_extras = guardado;
  }
  // Sem a liberação na política, o pedido de artigo vira post único.
  const comum = await gerarPeca({ orientacao: { formato: 'artigo', visual: 'design' } });
  assert.equal(comum.formato, 'post');
});

await caso('Banco de imagens: a IA escolhe a foto, o Novo visual troca e sem foto cai no design', async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const pasta = await fsp.mkdtemp(path.join(os.tmpdir(), 'banco-'));
  for (const [nome, cor] of [['banco-fabrica.jpg', '#3a6ea5'], ['banco-reuniao.jpg', '#a5703a']]) {
    const c = createCanvas(800, 600);
    const ctx = c.getContext('2d');
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, 800, 600);
    await fsp.writeFile(path.join(pasta, nome), await c.encode('jpeg', 80));
  }
  await fsp.writeFile(path.join(pasta, 'nao-entra.jpg'), 'x');
  await fsp.writeFile(path.join(pasta, 'banco-imagens.json'), JSON.stringify([{ arquivo: 'banco-reuniao.jpg', descricao: 'Equipe em reunião', tags: ['reunião'], credito: 'Banco de imagens da marca' }]));
  const antes = process.env.BANCO_DIR;
  const guardadoV = politica.visuais_permitidos;
  process.env.BANCO_DIR = pasta;
  politica.visuais_permitidos = undefined;
  try {
    const { listarBanco, descreverPendentes, catalogoCompleto, caminhoDoBanco } = await import('./banco.js');
    const lista = await listarBanco();
    assert.deepEqual(lista.map((f) => f.arquivo), ['banco-fabrica.jpg', 'banco-reuniao.jpg']);
    assert.equal(lista[1].descricao, 'Equipe em reunião');
    assert.equal(caminhoDoBanco('../segredo.jpg'), null);
    assert.equal(caminhoDoBanco('banco-imagens/../motor.js'), null);

    roteiro.banco = { indice: 1, motivo: 'Mostra uma equipe em reunião.' };
    const peca = await gerarPeca({ orientacao: { visual: 'banco' } });
    assert.equal(peca.imagem.origem, 'banco');
    assert.equal(peca.imagem.arquivo, 'banco-reuniao.jpg');
    const escolha = chamadas.filter((c) => c.ferramenta === 'escolher_imagem_do_banco').at(-1);
    assert.equal(escolha.conteudo.filter((b) => b.type === 'image').length, 2, 'a IA vê as duas fotos');
    const { legenda_final } = await motor.detalhe(peca.id);
    assert.match(legenda_final, /Foto: Banco de imagens da marca/);
    assert.ok(!peca.governanca.gate.motivos.some((m) => m.id === 'foto_editorial'), 'foto do banco não leva o alerta de banco livre');

    // Novo visual: a foto já usada sai da lista, e a IA escolhe entre as outras.
    roteiro.banco = { indice: 0 };
    await motor.regenerarImagem(peca.id, 'teste');
    const trocada = await aguardarProcessamento(peca.id);
    assert.equal(trocada.imagem.arquivo, 'banco-fabrica.jpg');

    // Pasta banco-imagens: fotos com qualquer nome, descritas pela IA de uma vez e guardadas no catálogo.
    await fsp.mkdir(path.join(pasta, 'banco-imagens'));
    for (const nome of ['IMG_0001.jpg', 'foto evento 2.jpg']) {
      const c = createCanvas(400, 300);
      c.getContext('2d').fillRect(0, 0, 400, 300);
      await fsp.writeFile(path.join(pasta, 'banco-imagens', nome), await c.encode('jpeg', 70));
    }
    const comPasta = await listarBanco();
    assert.equal(comPasta.length, 4);
    assert.ok(comPasta.some((f) => f.arquivo === 'banco-imagens/foto evento 2.jpg' && f.url === '/banco/banco-imagens/foto%20evento%202.jpg'));
    const r = await descreverPendentes({ ia: iaSimulada, modelo: 'modelo-simulado' });
    assert.equal(r.descritas, 3, 'descreve só as fotos sem descrição');
    assert.equal(r.faltam, 0);
    const descritas = await listarBanco();
    assert.ok(descritas.find((f) => f.arquivo === 'banco-imagens/IMG_0001.jpg').descrita_pela_ia);
    assert.equal(descritas.find((f) => f.arquivo === 'banco-reuniao.jpg').descricao, 'Equipe em reunião', 'a descrição do catálogo é mantida');
    const catalogo = await catalogoCompleto();
    assert.equal(catalogo.imagens.length, 4);
    assert.ok(catalogo.imagens.every((f) => f.descricao));

    // Nenhuma foto combina: a peça sai só com o design da marca.
    roteiro.banco = { indice: -1, motivo: 'Nenhuma combina.' };
    const semFoto = await gerarPeca({ orientacao: { visual: 'banco' } });
    assert.equal(semFoto.imagem, null);
    assert.ok(semFoto.arte?.url);
  } finally {
    roteiro.banco = undefined;
    politica.visuais_permitidos = guardadoV;
    // Banco vazio: também cai no design.
    process.env.BANCO_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'banco-vazio-'));
    const vazio = await gerarPeca({ orientacao: { visual: 'banco' } });
    assert.equal(vazio.imagem, null);
    if (antes === undefined) delete process.env.BANCO_DIR;
    else process.env.BANCO_DIR = antes;
  }
});

await caso('Programação: o calendário mostra horários salvos e datas da régua', async () => {
  const prog = await motor.salvarProgramacao({ horarios: [{ dia: 2, hora: '10:00' }, { dia: 4, hora: '10:00' }], gerar_automaticamente: false }, 'teste');
  assert.ok(prog.calendario, 'a programação traz o calendário');
  assert.ok(prog.calendario.horarios.length >= 16, 'dois meses de horários de terça e quinta');
  assert.ok(prog.calendario.horarios.every((h) => [2, 4].includes(new Date(h.para).getUTCDay())));
  const regua = await motor.importarRegua('teste', {
    nome: 'Série do calendário',
    objetivo: 'Testar o calendário.',
    narrativa: 'Um post.',
    cadencia: { inicio: '2026-11-17', dias_semana: [2, 4] },
    itens: [{ titulo: 'Post da régua no calendário', categoria: Object.keys(politica.categorias)[0], segmento: 'x', etapa_funil: 'atrair', formato: 'post', gancho: 'g', mensagem: 'm', provas: [], cta: 'c', ja_produzido: false, observacoes: '' }],
  });
  const depois = await motor.programacao();
  assert.ok(depois.calendario.regua.some((i) => i.titulo === 'Post da régua no calendário' && i.data === '2026-11-17'));
  await motor.excluirRegua(regua.id);
  await motor.salvarProgramacao({ horarios: [], gerar_automaticamente: false }, 'teste');
});

await caso('Visibilidade em IA: análise das respostas, score, comparação, histórico e rodada semanal', async () => {
  const { analisarResposta, criarGeo, limparConfig, configPadrao } = await import('./geo.js');
  const cfg = limparConfig({
    nomes_da_marca: ['Capgemini', 'Capgemini Invent'],
    dominios: ['https://www.capgemini.com/br-pt'],
    concorrentes: ['Accenture', 'Deloitte', 'CI&T'],
    perguntas: ['Quais as melhores consultorias de CRM?', 'Quem implementa Customer 360?'],
    repeticoes: 1,
  });
  assert.deepEqual(cfg.dominios, ['capgemini.com']);

  // Análise de uma resposta: menção, posição frente aos concorrentes, site citado e pontos.
  const a = analisarResposta({ texto: 'As mais citadas são Accenture, CAPGEMINI e Deloitte.', fontes: ['https://www.capgemini.com/br-pt/servicos', 'https://exame.com/x'] }, cfg);
  assert.equal(a.mencionada, true);
  assert.equal(a.posicao, 2);
  assert.equal(a.citada, true);
  assert.equal(a.pontos, 50 + 10 + 30);
  assert.deepEqual(a.concorrentes, ['Accenture', 'Deloitte']);
  assert.deepEqual(a.dominios, ['capgemini.com', 'exame.com']);
  const b = analisarResposta({ texto: 'A CI&T e a capgeminiano não são a mesma coisa.', fontes: [] }, cfg);
  assert.equal(b.mencionada, false, 'só conta o nome inteiro da marca');
  assert.deepEqual(b.concorrentes, ['CI&T']);
  assert.equal(b.pontos, 0);
  const c = analisarResposta({ texto: 'A Capgemini Invent lidera, seguida pela Accenture.', fontes: [] }, cfg);
  assert.equal(c.posicao, 1);
  assert.equal(c.pontos, 70);

  // Rodadas com IAs simuladas: a segunda melhora em uma pergunta.
  const dbGeo = await criarArmazenamentoLocal({ diretorio: path.join(temporario, 'geo'), urlPublica: '' });
  let rodada = 1;
  const motores = [
    {
      id: 'ia1',
      nome: 'IA 1',
      perguntar: async (p) =>
        p.includes('CRM')
          ? { texto: rodada === 1 ? 'Accenture e Deloitte.' : 'Capgemini e Accenture.', fontes: rodada === 1 ? [] : ['https://capgemini.com/a'] }
          : { texto: 'Capgemini e CI&T.', fontes: [] },
    },
    { id: 'ia2', nome: 'IA 2', perguntar: async (p) => (p.includes('CRM') ? { texto: 'Deloitte.', fontes: [] } : (() => { throw new Error('limite de uso'); })()) },
  ];
  let relogio = new Date('2026-11-02T12:00:00Z');
  const geo = criarGeo({ db: dbGeo, motores, agora: () => relogio });
  assert.ok(configPadrao().perguntas.length >= 1, 'o geo.json traz perguntas iniciais');
  await geo.salvarConfig(cfg);
  const r1 = await geo.rodar('teste', { aguardar: true });
  // Pergunta 1: IA1 0 pontos, IA2 0 → 0. Pergunta 2: IA1 70 (Capgemini antes da CI&T), IA2 erro → 70. Rodada: 35.
  assert.equal(r1.resumo.score, 35);
  assert.equal(r1.resumo.respostas_com_erro, 1);
  assert.equal(r1.resumo.por_motor.find((m) => m.id === 'ia2').erros, 1);
  relogio = new Date('2026-11-09T12:00:00Z');
  rodada = 2;
  const r2 = await geo.rodar('teste', { aguardar: true });
  // Pergunta 1: IA1 100 (1º e site citado), IA2 0 → 50. Pergunta 2: 70. Rodada: 60.
  assert.equal(r2.resumo.score, 60);
  assert.equal(r2.resumo.taxa_citacao, 33.3);
  const lista = await geo.listar();
  assert.deepEqual(lista.map((r) => r.id), [r2.id, r1.id], 'a rodada mais nova vem primeiro');
  assert.ok(!('respostas' in lista[0]), 'a lista não carrega os textos das respostas');
  const d = await geo.comparar(r2.id, r1.id);
  assert.equal(d.score, 25);
  assert.deepEqual(d.por_pergunta, [50, 0]);

  // Rodada semanal: só roda de novo depois de uma semana, e só se estiver ligada.
  assert.equal(await geo.verificarSemanal(), false, 'desligada');
  await geo.salvarConfig({ semanal: true });
  relogio = new Date('2026-11-12T12:00:00Z');
  assert.equal(await geo.verificarSemanal(), false, 'ainda não passou uma semana');
  relogio = new Date('2026-11-16T12:30:00Z');
  assert.equal(await geo.verificarSemanal(), true);
  assert.equal((await geo.listar()).length, 3);

  // Histórico: baixar e restaurar num armazenamento vazio.
  const historico = await geo.exportar();
  const dbNovo = await criarArmazenamentoLocal({ diretorio: path.join(temporario, 'geo-novo'), urlPublica: '' });
  const geoNovo = criarGeo({ db: dbNovo, motores });
  assert.deepEqual(await geoNovo.importar(JSON.parse(JSON.stringify(historico))), { novas: 3 });
  assert.deepEqual(await geoNovo.importar(historico), { novas: 0 }, 'não duplica rodadas');
  assert.equal((await geoNovo.config()).semanal, true, 'a configuração vem junto quando não havia nenhuma');
  await assert.rejects(geoNovo.importar({ rodadas: [] }), /Arquivo inválido/);

  // Sinais de fragilidade calculados dos números da primeira rodada.
  const { sinaisDeFragilidade } = await import('./geo.js');
  const sinais = sinaisDeFragilidade(r1.resumo, cfg).map((x) => x.tipo);
  assert.deepEqual(sinais, ['ausente', 'sem_citacao', 'concorrentes', 'motor']);
  assert.deepEqual(r1.resumo.sinais.map((x) => x.tipo), sinais, 'os sinais ficam guardados no resumo da rodada');
  assert.match(sinaisDeFragilidade(r1.resumo, cfg)[2].titulo, /Deloitte/);

  // Diagnóstico e plano de ação pela IA, logo depois da rodada.
  const dbDiag = await criarArmazenamentoLocal({ diretorio: path.join(temporario, 'geo-diag'), urlPublica: '' });
  const geoDiag = criarGeo({ db: dbDiag, motores, ia: iaSimulada, modelo: 'modelo-simulado' });
  await geoDiag.salvarConfig(cfg);
  const comDiag = await geoDiag.rodar('teste', { aguardar: true });
  assert.equal(comDiag.diagnostico.fragilidades.length, 2);
  assert.equal(comDiag.diagnostico.acoes.length, 4);
  assert.deepEqual(comDiag.diagnostico.acoes.map((a) => a.prioridade), ['alta', 'alta', 'media', 'baixa'], 'o plano vem em ordem de prioridade');
  assert.equal(comDiag.diagnostico.acoes.find((a) => a.canal === 'site').orientacao_para_o_motor, '', 'só ação que o Motor faz leva orientação');
  const pedidoDiag = chamadas.filter((c) => c.ferramenta === 'diagnosticar_geo').at(-1);
  assert.ok(String(pedidoDiag.conteudo).includes('Pergunta 1: "Quais as melhores consultorias de CRM?"'), 'a IA recebe o detalhe de cada pergunta');
  const plano = await geoDiag.plano(comDiag.id);
  for (const trecho of ['PLANO DE VISIBILIDADE EM IA', 'SINAIS NOS NÚMEROS', 'FRAGILIDADES', 'SITE DA MARCA', 'LINKEDIN', 'IMPRENSA', 'No Motor: Artigo: como escolher uma consultoria de CRM', 'VITÓRIAS RÁPIDAS', 'COMO MEDIR']) {
    assert.ok(plano.includes(trecho), `o plano traz ${trecho}`);
  }
  // Se a IA falha no diagnóstico, a rodada fica salva com o aviso, e dá para gerar de novo.
  const geoFalha = criarGeo({ db: dbDiag, motores, ia: async () => { throw new Error('IA fora do ar'); } });
  const semDiag = await geoFalha.rodar('teste', { aguardar: true });
  assert.equal(semDiag.diagnostico, undefined);
  assert.match(semDiag.diagnostico_erro, /IA fora do ar/);
  const refeito = await geoDiag.diagnosticar(semDiag.id);
  assert.ok(refeito.diagnostico && !refeito.diagnostico_erro);

  // Sem perguntas, não roda.
  await geo.salvarConfig({ perguntas: [] });
  await assert.rejects(geo.rodar('teste', { aguardar: true }), /pelo menos uma pergunta/);
});

await caso('Cor de fundo pedida pela equipe e playbook sem pixelização', async () => {
  const { normalizarDesign } = await import('./formatos.js');
  assert.equal(normalizarDesign({ cor: '#6e2c8c' }).cor, '#6E2C8C');
  assert.equal(normalizarDesign({ cor: 'roxo' }).cor, undefined, 'só aceita cor em hexadecimal');
  assert.equal(normalizarDesign({}).cor, undefined, 'sem cor, vale o degradê da marca');
  if (perfilAtivo.marca.layout !== 'playbook') return;
  const { renderizarArte } = await import('./arte.js');
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const guardado = { layout: marca.layout, logos: marca.logos, cores: marca.cores, playbook: marca.playbook };
  Object.assign(marca, { layout: 'playbook', logos: perfilAtivo.marca.logos, cores: perfilAtivo.marca.cores, playbook: perfilAtivo.marca.playbook });
  try {
    const textos = { titulo: 'Orçamento 2027: decida onde investir em Marketing & CRM', titulo_destaque: 'Marketing & CRM', subtitulo: 'Um diagnóstico executivo mostra onde colocar a verba e dá clareza para decidir mais rápido.', rotulo_arte: 'Diagnóstico', cta_arte: 'Leia no post' };
    const roxo = await renderizarArte({ fundo: null, textos, oferta: null, visual: 'design', design: { cor: '#6E2C8C' } });
    assert.equal(roxo.ajustes.transbordou, false);
    const img = await loadImage(roxo.buffer);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const [r, , b] = ctx.getImageData(540, 700, 1, 1).data;
    assert.ok(r > 60 && b > 90, 'o degradê usa a cor pedida');
    // Com foto, título e subtítulo longos cabem acima da chamada (antes ficavam por cima).
    const foto = createCanvas(1200, 900);
    foto.getContext('2d').fillRect(0, 0, 1200, 900);
    const comFoto = await renderizarArte({ fundo: await foto.encode('jpeg', 80), textos, oferta: null, visual: 'ia', design: {} });
    assert.equal(comFoto.ajustes.transbordou, false);
  } finally {
    Object.assign(marca, guardado);
  }
});

await caso('Estado do painel com métricas por categoria e configuração ativa', async () => {
  const e = await motor.estado();
  assert.equal(e.categorias.length, Object.keys(politica.categorias).length);
  assert.ok(e.categorias.every((c) => c.metricas && typeof c.metricas.pode_liberar === 'boolean'));
  assert.equal(e.config.publicacao_modo, 'simulacao');
  assert.equal(e.controle.pausado, false);
  const detalhe = await motor.detalhe(pecaBase);
  assert.ok(detalhe.legenda_final.includes(politica.rotulo_ia));
});

/* -------------------------------------------------------------------- resumo */

const falhas = resultados.filter((r) => !r.ok);
const chamadasPorFerramenta = chamadas.reduce((acc, c) => ({ ...acc, [c.ferramenta]: (acc[c.ferramenta] || 0) + 1 }), {});
console.log(`\n${resultados.length - falhas.length} de ${resultados.length} casos passaram.`);
console.log(`Chamadas simuladas à IA: ${JSON.stringify(chamadasPorFerramenta)}. Imagens simuladas: ${promptsImagem.length}.`);
console.log(`Prévia da arte (fundo sintético de teste): ${path.relative(raiz, path.join(saida, 'previa-arte.jpg'))}`);
if (manter) console.log(`Dados temporários mantidos em ${temporario}`);
else await fs.rm(temporario, { recursive: true, force: true });

if (falhas.length) {
  for (const f of falhas) console.error(`\n${f.nome}\n${f.erro.stack}`);
  process.exitCode = 1;
}
