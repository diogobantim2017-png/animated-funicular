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

const { raiz, marca, politica, ofertas, MARCADOR_PENDENTE, temPendencia } = await import('./config.js');

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

const chamadas = [];
async function iaSimulada({ ferramenta, conteudo }) {
  chamadas.push({ ferramenta: ferramenta.name, schema: ferramenta.input_schema, conteudo });
  const respostas = {
    propor_oportunidade: () => ({ ...OPORTUNIDADE, ...roteiro.oportunidade }),
    criar_brief: () => ({ ...BRIEF, ...roteiro.brief }),
    escrever_textos: () => {
      const pedeSlides = ferramenta.input_schema.properties.slides;
      const extras = pedeSlides ? { slides: slidesSimulados(pedeSlides.minItems), fechamento: 'Proteja quem você ama: compartilhe.' } : {};
      return { ...TEXTOS, ...extras, ...roteiro.textos };
    },
    avaliar_peca: () => ({
      ...JUIZ,
      ...roteiro.juiz,
      elementos_no_fundo: { ...JUIZ.elementos_no_fundo, ...roteiro.juiz?.elementos_no_fundo },
      notas: { ...JUIZ.notas, ...roteiro.juiz?.notas },
    }),
  };
  const dados = structuredClone(respostas[ferramenta.name]());
  validarSchema(ferramenta.input_schema, dados);
  return { dados, modelo: 'modelo-simulado' };
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
const fotosSimuladas = {
  provedor: 'teste',
  disponivel: true,
  async buscar(consulta, { evitar = [] } = {}) {
    fotosBuscadas++;
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
