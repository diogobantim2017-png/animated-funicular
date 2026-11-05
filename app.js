/* Painel do motor de campanhas. JavaScript puro, sem etapa de build. */

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

const esc = (valor) =>
  String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ------------------------------------------------------------- vocabulário */

const VEREDITOS = [
  { id: 'bloqueada', nome: 'Bloqueada pelas travas', significado: 'Não sai sem correção, nem com aprovação humana.', classe: 'bloqueada' },
  { id: 'precisa_humano', nome: 'Precisa de revisão humana', significado: 'Alertas pedem o olhar de uma pessoa.', classe: 'humano' },
  { id: 'publicavel', nome: 'Publicável sem humano', significado: 'Sai sozinha se a categoria tiver autonomia.', classe: 'publicavel' },
];
const NOME_VEREDITO = Object.fromEntries(VEREDITOS.map((v) => [v.id, v.nome]));

const ETAPAS = [
  ['radar', 'Radar'],
  ['brief', 'Brief e público'],
  ['textos', 'Textos'],
  ['imagem', 'Imagem'],
  ['arte', 'Arte'],
  ['governanca', 'Travas'],
];
const NOME_ETAPA = { ...Object.fromEntries(ETAPAS), ajuste: 'Lendo o seu pedido' };

const GATILHOS = {
  noticia_recente: 'Notícia recente',
  data_do_calendario: 'Data do calendário',
  objetivo_do_perfil: 'Objetivo do perfil',
  objetivo_do_banco: 'Objetivo do perfil',
  lacuna_no_historico: 'Lacuna no histórico de posts',
  orientacao_da_equipe: 'Orientação da equipe',
};
const KPIS = {
  alcance: 'Alcance',
  salvamentos: 'Salvamentos',
  compartilhamentos: 'Compartilhamentos',
  comentarios: 'Comentários',
  visitas_ao_perfil: 'Visitas ao perfil',
};
const NIVEIS = { baixa: 'Baixa', media: 'Média', alta: 'Alta', baixo: 'baixo', medio: 'médio', alto: 'alto' };
const ESTILOS = {
  fotografia_lifestyle: 'Fotografia lifestyle',
  ilustracao_flat: 'Ilustração flat',
  render_3d_suave: 'Render 3D suave',
};
const PROVEDORES = { openai: 'OpenAI', google: 'Google' };

const CAMPOS = [
  { id: 'titulo', rotulo: 'Título da arte', limite: 'titulo_max' },
  { id: 'subtitulo', rotulo: 'Subtítulo da arte', limite: 'subtitulo_max', linhas: 2 },
  { id: 'cta_arte', rotulo: 'Chamada no botão da arte', limite: 'cta_max' },
  { id: 'legenda', rotulo: 'Legenda do post', limite: 'legenda_max', linhas: 7 },
  { id: 'hashtags', rotulo: 'Hashtags, separadas por espaço', limite: 'hashtags_max' },
];

const FORMATOS = { post: 'Post único', carrossel: 'Carrossel', flashcards: 'Flashcards', pista: 'Carrossel em pista', artigo: 'Artigo do LinkedIn' };
const VISUAIS = { ia: 'imagem criada por IA', foto: 'foto real', banco: 'foto do banco de imagens', design: 'só design' };
const LIMITES_SLIDE = { titulo: 60, texto: 240, fechamento: 90, legenda: 700 };
const LIMITES_ARTIGO = { intertitulo: 90, texto: 1600, conclusao: 700, chamada_final: 250, legenda: 1300 };

const emPlaybook = () => ui.estado?.config?.layout === 'playbook';
const CAMPOS_PLAYBOOK = [
  { id: 'titulo_destaque', rotulo: 'Destaque do título, em azul-claro (copie as palavras do título)', max: 60 },
  { id: 'rotulo_arte', rotulo: 'Rótulo com o cursor, em caixa alta', max: 28 },
];

/** Campos editáveis conforme o formato: post único ou capa, slides e slide final. */
function camposDaPeca(p) {
  const t = p?.textos || {};
  if (Array.isArray(t.secoes)) {
    const campos = [
      { id: 'titulo', rotulo: 'Título do artigo', limite: 'titulo_max', grupo: 'Título e capa' },
      ...(emPlaybook() ? CAMPOS_PLAYBOOK : []),
      { id: 'subtitulo', rotulo: 'Linha fina', limite: 'subtitulo_max', linhas: 2 },
      { id: 'cta_arte', rotulo: 'Chamada na capa', limite: 'cta_max' },
    ];
    t.secoes.forEach((_, i) => {
      campos.push(
        { id: `secao_${i}_intertitulo`, rotulo: 'Intertítulo', max: LIMITES_ARTIGO.intertitulo, grupo: `Seção ${i + 1}` },
        { id: `secao_${i}_texto`, rotulo: 'Texto (deixe uma linha em branco entre os parágrafos)', max: LIMITES_ARTIGO.texto, linhas: 8 },
      );
    });
    campos.push(
      { id: 'conclusao', rotulo: 'Conclusão', max: LIMITES_ARTIGO.conclusao, linhas: 4, grupo: 'Fechamento do artigo' },
      { id: 'chamada_final', rotulo: 'Chamada final', max: LIMITES_ARTIGO.chamada_final, linhas: 2 },
      { id: 'legenda', rotulo: 'Texto do post que divulga o artigo', max: LIMITES_ARTIGO.legenda, linhas: 5, grupo: 'Divulgação no feed' },
      { id: 'hashtags', rotulo: 'Hashtags, separadas por espaço', limite: 'hashtags_max' },
    );
    return campos;
  }
  if (!Array.isArray(t.slides)) {
    if (!emPlaybook()) return CAMPOS;
    return CAMPOS.flatMap((c) => (c.id === 'titulo' ? [c, ...CAMPOS_PLAYBOOK] : c.id === 'cta_arte' ? [{ ...c, rotulo: 'Chamada no pé da arte' }] : [c]));
  }
  const cartao = p.formato === 'flashcards';
  const campos = [
    { id: 'titulo', rotulo: 'Título', limite: 'titulo_max', grupo: 'Capa' },
    { id: 'subtitulo', rotulo: 'Subtítulo', limite: 'subtitulo_max', linhas: 2 },
    ...(emPlaybook() ? CAMPOS_PLAYBOOK : []),
  ];
  t.slides.forEach((_, i) => {
    const nome = cartao ? `Cartão ${i + 1}` : `Slide ${i + 2}`;
    campos.push(
      { id: `slide_${i}_titulo`, rotulo: cartao ? 'Termo ou pergunta' : 'Título', max: LIMITES_SLIDE.titulo, grupo: nome },
      { id: `slide_${i}_texto`, rotulo: cartao ? 'Explicação' : 'Texto', max: LIMITES_SLIDE.texto, linhas: 3 },
    );
  });
  campos.push(
    { id: 'fechamento', rotulo: 'Frase de fechamento', max: LIMITES_SLIDE.fechamento, grupo: 'Slide final' },
    ...(emPlaybook() ? [{ id: 'fechamento_destaque', rotulo: 'Destaque do fechamento, em azul-claro', max: 60 }] : []),
    { id: 'cta_arte', rotulo: emPlaybook() ? 'Chamada no pé da arte' : 'Chamada no botão', limite: 'cta_max' },
    { id: 'legenda', rotulo: 'Legenda do post', max: LIMITES_SLIDE.legenda, linhas: 6, grupo: 'Legenda' },
    { id: 'hashtags', rotulo: 'Hashtags, separadas por espaço', limite: 'hashtags_max' },
  );
  return campos;
}

/** Monta o que vai para o servidor a partir do rascunho do formulário. */
function formParaTextos(r, t = {}) {
  const saida = { titulo: r.titulo, subtitulo: r.subtitulo, cta_arte: r.cta_arte, legenda: r.legenda, hashtags: r.hashtags };
  if (t.fechamento !== undefined) saida.fechamento = r.fechamento;
  for (const campo of ['titulo_destaque', 'rotulo_arte', 'fechamento_destaque']) if (r[campo] !== undefined) saida[campo] = r[campo];
  if (Array.isArray(t.slides)) saida.slides = t.slides.map((_, i) => ({ titulo: r[`slide_${i}_titulo`], texto: r[`slide_${i}_texto`] }));
  if (Array.isArray(t.secoes)) {
    saida.secoes = t.secoes.map((_, i) => ({ intertitulo: r[`secao_${i}_intertitulo`], texto: r[`secao_${i}_texto`] }));
    saida.conclusao = r.conclusao;
    saida.chamada_final = r.chamada_final;
  }
  return saida;
}

function descreverFormato(p) {
  const formato = p.formato || 'post';
  const n = p.slides_arte?.length || p.slides || p.num_slides;
  const nome = formato === 'post' ? 'Post único' : formato === 'artigo' ? 'Artigo do LinkedIn com capa' : `${FORMATOS[formato]} de ${n} imagens`;
  return `${nome}, ${VISUAIS[p.visual || 'ia']}`;
}

/* ------------------------------------------------------------------ estado */

const ui = {
  aba: 'fila',
  filtro: '',
  selecionada: null,
  estado: null,
  pecas: [],
  detalhe: null,
  rascunho: null,
  verFundo: false,
  semConexao: false,
  gaveta: false,
  cache: {},
};

/** Só troca o HTML quando o conteúdo muda: preserva rolagem, foco e blocos abertos. */
function pintar(elemento, chave, html) {
  if (ui.cache[chave] === html) return;
  ui.cache[chave] = html;
  elemento.innerHTML = html;
}

/* ------------------------------------------------------------- utilidades */

const fuso = () => ui.estado?.config?.fuso || 'America/Sao_Paulo';

function dataHora(iso, { diaSemana = false, segundos = false } = {}) {
  if (!iso) return '';
  const opcoes = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: fuso() };
  if (diaSemana) opcoes.weekday = 'short';
  if (segundos) opcoes.second = '2-digit';
  return new Intl.DateTimeFormat('pt-BR', opcoes).format(new Date(iso));
}

const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const decimal = (x) => Number(x ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function ator(bruto = '') {
  if (bruto.startsWith('humano:')) return bruto.slice(7);
  const nomes = {
    'ia:radar': 'Radar (IA)',
    'ia:estrategista': 'Estrategista (IA)',
    'ia:redator': 'Redator (IA)',
    'ia:revisor': 'Revisor com visão (IA)',
    'ia:diretor': 'Diretor de arte (IA)',
    template: 'Template da marca',
    regras: 'Travas em código',
    governanca: 'Governança',
    'sistema:autonomia': 'Controle de autonomia',
    'sistema:agenda': 'Agenda automática',
    sistema: 'Sistema',
  };
  if (bruto.startsWith('ia:imagem:')) return `Gerador de imagem (${PROVEDORES[bruto.slice(10)] || bruto.slice(10)})`;
  return nomes[bruto] || bruto;
}

/* ------------------------------------------------------------------ revisor */

const CHAVE_REVISOR = 'motor-campanhas:revisor';

function lerRevisorSalvo() {
  try {
    return localStorage.getItem(CHAVE_REVISOR) || '';
  } catch {
    return '';
  }
}

const nomeRevisor = () => $('#revisor').value.trim();

function exigirNome() {
  if (nomeRevisor() || ui.estado?.sessao?.usuario) return true;
  avisar('Informe seu nome no topo do painel. Ele fica registrado na auditoria.', 'erro');
  $('#revisor').focus();
  return false;
}

/* ---------------------------------------------------------------------- API */

async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify({ usuario: nomeRevisor(), ...corpo }) : undefined,
  });
  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }
  if (!resposta.ok) {
    const erro = new Error(dados?.erro || `O servidor respondeu com erro ${resposta.status}.`);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

const acao = (caminho, corpo = {}) => api(caminho, { metodo: 'POST', corpo });

/* ------------------------------------------------------------------- avisos */

function avisar(texto, tipo = 'info') {
  const item = document.createElement('div');
  item.className = `aviso__item aviso__item--${tipo}`;
  if (tipo === 'erro') item.setAttribute('role', 'alert');
  item.textContent = texto;
  $('#aviso').append(item);
  setTimeout(() => item.remove(), tipo === 'erro' ? 9000 : 5000);
}

/* ---------------------------------------------------------------- carregamento */

async function carregarEstado() {
  ui.estado = await api('/api/estado');
  renderTopo();
  renderPendencias();
  $('#contador-fila').textContent = String(ui.estado.contagens.em_revisao + ui.estado.contagens.aguardando_publicacao || '');
  if (ui.aba === 'autonomia') renderAutonomia();
}

async function carregarLista() {
  if (ui.aba === 'autonomia' || ui.aba === 'programacao' || ui.aba === 'banco' || ui.aba === 'geo') return;
  const status = ui.aba === 'fila' ? 'gerando,em_revisao,aprovada,agendada' : ui.filtro;
  const [pecas, historico] = await Promise.all([
    api(`/api/pecas${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    // Na tela inicial, o histórico recente fica sempre à vista, abaixo da fila.
    ui.aba === 'fila' ? api(`/api/pecas?status=${encodeURIComponent('publicada,reprovada,erro')}`) : Promise.resolve([]),
  ]);
  ui.pecas = pecas;
  const quando = (p) => p.publicacao?.em || p.criada_em || '';
  ui.historico = historico.sort((a, b) => quando(b).localeCompare(quando(a))).slice(0, 8);
  renderLista();
  // Na tela inicial, o resumo da fila acompanha a contagem; com uma peça aberta, só o botão da fila muda.
  if (!ui.selecionada) renderDetalhe();
  else {
    const botao = $('.peca__navegacao .abrir-fila');
    if (botao) botao.outerHTML = botaoFila();
  }
}

async function carregarDetalhe() {
  if (!ui.selecionada) {
    ui.detalhe = null;
    renderDetalhe();
    return;
  }
  const anterior = ui.detalhe?.peca?.id === ui.selecionada ? ui.detalhe : null;
  try {
    ui.detalhe = await api(`/api/pecas/${encodeURIComponent(ui.selecionada)}`);
  } catch (erro) {
    if (erro.status !== 404) throw erro;
    ui.selecionada = null;
    ui.detalhe = null;
  }
  const antes = anterior && (anterior.processando || anterior.peca.status === 'gerando');
  const agora = ui.detalhe && (ui.detalhe.processando || ui.detalhe.peca.status === 'gerando');
  if (antes && !agora && ui.detalhe) {
    const p = ui.detalhe.peca;
    if (p.status === 'erro') avisar('A geração falhou. Veja o motivo na peça.', 'erro');
    else if (p.status === 'publicada') avisar('Peça publicada sozinha: passou em todas as travas e a categoria tem autonomia.', 'sucesso');
    else if (p.governanca) avisar(`Peça pronta: ${NOME_VEREDITO[p.governanca.gate.veredito].toLowerCase()}.`);
  }
  renderDetalhe();
}

async function atualizarTudo() {
  await carregarEstado();
  await carregarLista();
  await carregarDetalhe();
}

/* --------------------------------------------------------------- atualização */

let temporizador = null;

function processandoAlgo() {
  return Boolean(
    ui.estado?.em_geracao ||
      ui.detalhe?.processando ||
      ui.detalhe?.peca?.status === 'gerando' ||
      ui.pecas.some((p) => p.status === 'gerando'),
  );
}

function agendar() {
  clearTimeout(temporizador);
  const intervalo = document.hidden ? 60000 : processandoAlgo() ? 2500 : 15000;
  temporizador = setTimeout(ciclo, intervalo);
}

async function ciclo() {
  try {
    await carregarEstado();
    await carregarLista();
    const d = ui.detalhe;
    const item = ui.pecas.find((p) => p.id === ui.selecionada);
    const mudou = item && d && (item.status !== d.peca.status || (item.veredito || null) !== (d.peca.governanca?.gate?.veredito || null));
    if (ui.selecionada && (d?.processando || d?.peca?.status === 'gerando' || (mudou && !rascunhoAlterado()))) {
      await carregarDetalhe();
    }
    if (ui.semConexao) {
      ui.semConexao = false;
      avisar('Conexão com o servidor restabelecida.', 'sucesso');
    }
  } catch (erro) {
    if (!ui.semConexao) avisar(`Sem conexão com o servidor. Tentando de novo. (${erro.message})`, 'erro');
    ui.semConexao = true;
  } finally {
    agendar();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ciclo();
});

/* -------------------------------------------------------------------- topo */

function renderTopo() {
  const e = ui.estado;
  $('#topo-marca').textContent = `Marca: ${e.config.marca}`;
  const pausado = Boolean(e.controle?.pausado);
  const real = e.config.publicacao_modo === 'real';
  const agenda = e.agenda?.ativa && e.agenda.proxima
    ? `Próxima execução automática: ${dataHora(e.agenda.proxima, { diaSemana: true })}`
    : 'Agenda automática desligada';
  const html = `
    <span class="estado-chip ${pausado ? 'estado-chip--pausado' : ''}">${pausado ? 'Pausado' : 'Operando'}</span>
    <span class="modo-chip ${real ? 'modo-chip--real' : ''}">${real ? `Publicação real no Instagram${ui.estado?.instagram?.usuario ? `: @${esc(ui.estado.instagram.usuario)}` : ''}` : canalManual() ? `${esc(canalManual().nome)}: o executivo publica` : ui.estado?.config?.demonstracao ? 'Demonstração: nada é publicado' : 'Simulação: nada é publicado'}</span>
    ${pausado ? `<span>Pausado por ${esc(e.controle.atualizado_por || 'equipe')}${e.controle.motivo ? `: ${esc(e.controle.motivo)}` : ''}</span>` : ''}
    <button type="button" class="topo__mais" data-acao="topo-detalhes" aria-expanded="${Boolean(ui.topoDetalhes)}">${ui.topoDetalhes ? 'Menos' : 'Detalhes'}</button>
    ${
      ui.topoDetalhes
        ? `<span class="topo__extra">${pausado ? '' : esc(agenda)}</span><span class="topo__extra">Hoje: ${e.contagens.geradas_hoje}${e.limites.geracoes_por_dia ? ` de ${e.limites.geracoes_por_dia}` : ''} ${
            e.contagens.geradas_hoje === 1 ? 'geração' : 'gerações'
          }, ${e.contagens.publicadas_hoje}${e.limites.publicacoes_por_dia ? ` de ${e.limites.publicacoes_por_dia}` : ''} ${
            e.contagens.publicadas_hoje === 1 ? 'publicação' : 'publicações'
          }</span>`
        : ''
    }`;
  pintar($('#topo-situacao'), 'topo', html);

  const gerar = $('#btn-gerar');
  gerar.textContent = e.em_geracao ? 'Acompanhar geração' : 'Gerar peça agora';
  const pausa = $('#btn-pausa');
  pausa.textContent = pausado ? 'Retomar' : 'Pausar tudo';
  pausa.className = `botao ${pausado ? 'botao--retomar' : 'botao--alerta'}`;
  if (e.sessao?.usuario) $('#revisor').placeholder = e.sessao.usuario;
}

const telaEstreita = () => matchMedia('(max-width: 760px)').matches;

/** Canal em que o executivo publica à mão (ex.: LinkedIn), quando configurado na política. */
const canalManual = () => (ui.estado?.config?.canal?.tipo === 'manual' ? ui.estado.config.canal : null);

function renderPendencias() {
  const lista = ui.estado?.pendencias || [];
  const el = $('#pendencias');
  el.hidden = !lista.length;
  pintar(
    el,
    'pendencias',
    lista.length
      ? `<details><summary>Configuração pendente (${lista.length})</summary><ul>${lista.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>`
      : '',
  );
}

/* -------------------------------------------------------------------- lista */

function seloDoItem(p) {
  if (p.status === 'gerando') return { classe: 'gerando', texto: `Gerando: ${NOME_ETAPA[p.etapa] || 'preparando'}` };
  if (p.status === 'erro') return { classe: 'bloqueada', texto: 'Falhou na geração' };
  if (p.status === 'reprovada') return { classe: 'neutro', texto: 'Reprovada' };
  if (p.status === 'aprovada') return { classe: 'aguardando', texto: 'Aprovada, aguardando publicação' };
  if (p.status === 'agendada') return { classe: 'aguardando', texto: `Agendada: ${dataHora(p.agendamento_para, { diaSemana: true })}` };
  if (p.status === 'publicada') {
    const canal = canalManual();
    if (canal) return { classe: 'publicada', texto: `Pronta para o ${canal.nome}` };
    const simulacao = p.publicacao?.modo === 'simulacao' ? ' (simulação)' : '';
    return { classe: 'publicada', texto: `${p.decisao === 'automatica' ? 'Publicada sozinha' : 'Publicada'}${simulacao}` };
  }
  if (p.veredito === 'bloqueada') return { classe: 'bloqueada', texto: 'Bloqueada' };
  if (p.veredito === 'precisa_humano') return { classe: 'humano', texto: 'Precisa de revisão humana' };
  if (p.amostra_auditoria) return { classe: 'publicavel', texto: 'Publicável, sorteada para auditoria' };
  return { classe: 'publicavel', texto: 'Publicável' };
}

function itemHtml(p) {
  const selo = seloDoItem(p);
  return `<button type="button" class="item" data-acao="abrir" data-id="${esc(p.id)}" ${p.id === ui.selecionada ? 'aria-current="true"' : ''}>
    <span class="item__miniatura">${p.arte_url ? `<img src="${esc(p.arte_url)}" alt="" loading="lazy">` : ''}</span>
    <span class="item__texto">
      <span class="item__tema">${esc(p.tema || p.titulo || 'Tema em definição pelo radar')}</span>
      <span class="item__meta"><span>${esc(p.categoria_nome || 'Categoria em definição')}</span>${p.formato && p.formato !== 'post' ? `<span>${esc(FORMATOS[p.formato])} · ${p.slides}</span>` : ''}<span>${dataHora(p.criada_em)}</span></span>
      <span class="selo selo--${selo.classe}">${esc(selo.texto)}</span>
    </span>
  </button>`;
}

/* A fila fica numa gaveta: só aparece quando a pessoa pede. */
const nomeDaLista = () => (ui.aba === 'todas' ? 'Todas as peças' : 'Fila de revisão');
const contagemDaLista = () => (ui.aba === 'todas' ? ui.pecas.length : ui.pecas.filter((p) => p.status === 'em_revisao').length);

function aplicarGaveta() {
  $('#area-pecas').dataset.gaveta = ui.gaveta ? 'aberta' : 'fechada';
  $('#gaveta-fundo').hidden = !ui.gaveta;
  for (const botao of $$('[data-acao="abrir-fila"]')) botao.setAttribute('aria-expanded', String(ui.gaveta));
}

function botaoFila(classe = 'abrir-fila') {
  const n = contagemDaLista();
  return `<button type="button" class="${classe}" data-acao="abrir-fila" aria-controls="lista" aria-expanded="${ui.gaveta}">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h9" /></svg>
    ${nomeDaLista()}${n ? `<span class="abrir-fila__contador">${n}</span>` : ''}
  </button>`;
}

function renderLista() {
  let html = `<div class="gaveta__topo"><h2 class="gaveta__titulo">${nomeDaLista()}</h2><button type="button" class="gaveta__fechar" data-acao="fechar-fila">Fechar</button></div>`;
  if (ui.aba === 'todas') {
    const opcoes = [
      ['', 'Todas'],
      ['em_revisao', 'Em revisão'],
      ['aprovada', 'Aprovadas aguardando publicação'],
      ['agendada', 'Agendadas'],
      ['publicada', 'Publicadas'],
      ['reprovada', 'Reprovadas'],
      ['erro', 'Com falha na geração'],
    ];
    html += `<div class="lista__filtro"><label>Mostrar<select id="filtro-status">${opcoes
      .map(([v, t]) => `<option value="${v}" ${v === ui.filtro ? 'selected' : ''}>${t}</option>`)
      .join('')}</select></label></div>`;
  }

  if (!ui.pecas.length) {
    html +=
      ui.aba === 'fila'
        ? `<div class="vazio"><h2 class="vazio__titulo">Nada para revisar agora</h2><p>${
            ui.estado?.agenda?.ativa && ui.estado.agenda.proxima
              ? `A próxima peça automática sai em ${esc(dataHora(ui.estado.agenda.proxima, { diaSemana: true }))}.`
              : 'Gere uma peça para ver o fluxo completo.'
          }</p><button type="button" class="botao botao--primario" data-acao="abrir-gerar">Gerar peça agora</button></div>`
        : '<div class="vazio"><p>Nenhuma peça com esse filtro.</p></div>';
  } else if (ui.aba === 'fila') {
    const grupos = [
      ['gerando', 'Gerando agora'],
      ['em_revisao', 'Para revisar'],
      ['aprovada', 'Aprovadas aguardando publicação'],
      ['agendada', 'Agendadas'],
    ];
    for (const [status, titulo] of grupos) {
      const itens = ui.pecas.filter((p) => p.status === status);
      if (itens.length) html += `<h2 class="lista__grupo">${titulo} (${itens.length})</h2>${itens.map(itemHtml).join('')}`;
    }
  } else {
    html += ui.pecas.map(itemHtml).join('');
  }
  if (ui.aba === 'fila' && ui.historico?.length) {
    html += `<h2 class="lista__grupo">Histórico recente</h2>${ui.historico.map(itemHtml).join('')}
      <div class="lista__mais"><button type="button" class="botao botao--texto" data-acao="ver-todas">Ver todas as peças</button></div>`;
  }
  pintar($('#lista'), `lista:${ui.aba}`, html);
}

/* ------------------------------------------------------------------ detalhe */

const textosParaForm = (t = {}) => ({
  titulo: t.titulo || '',
  subtitulo: t.subtitulo || '',
  cta_arte: t.cta_arte || '',
  legenda: t.legenda || '',
  hashtags: (t.hashtags || []).join(' '),
  ...(t.fechamento !== undefined ? { fechamento: t.fechamento || '' } : {}),
  ...(emPlaybook()
    ? {
        titulo_destaque: t.titulo_destaque || '',
        rotulo_arte: t.rotulo_arte || '',
        ...(t.fechamento !== undefined ? { fechamento_destaque: t.fechamento_destaque || '' } : {}),
      }
    : {}),
  ...Object.fromEntries(
    (t.slides || []).flatMap((sl, i) => [
      [`slide_${i}_titulo`, sl.titulo || ''],
      [`slide_${i}_texto`, sl.texto || ''],
    ]),
  ),
  ...Object.fromEntries(
    (t.secoes || []).flatMap((sc, i) => [
      [`secao_${i}_intertitulo`, sc.intertitulo || ''],
      [`secao_${i}_texto`, sc.texto || ''],
    ]),
  ),
  ...(t.secoes ? { conclusao: t.conclusao || '', chamada_final: t.chamada_final || '' } : {}),
});

function rascunhoAlterado() {
  if (!ui.rascunho || !ui.detalhe?.peca?.textos) return false;
  const original = textosParaForm(ui.detalhe.peca.textos);
  return camposDaPeca(ui.detalhe.peca).some((c) => (ui.rascunho[c.id] ?? '') !== original[c.id]);
}

function medida(campo, valor) {
  const max = campo.max ?? ui.estado?.limites?.[campo.limite];
  const atual = campo.id === 'hashtags' ? valor.split(/\s+/).filter(Boolean).length : valor.length;
  return { atual, max, excedido: max != null && atual > max, texto: max != null ? `${atual} de ${max}` : String(atual) };
}

const bloco = (titulo, conteudo) => `<section class="bloco"><h3 class="bloco__titulo">${titulo}</h3>${conteudo}</section>`;

function fatos(pares) {
  const linhas = pares
    .filter((par) => par && par[1] != null && par[1] !== '')
    .map(([rotulo, valor]) => `<dt>${esc(rotulo)}</dt><dd>${typeof valor === 'object' ? valor.html : esc(valor)}</dd>`)
    .join('');
  return linhas ? `<dl class="fatos">${linhas}</dl>` : '';
}

function contextoDaPeca(p, categoria) {
  const quem = p.origem === 'agenda' ? 'pela agenda automática' : `por ${esc(p.criada_por || 'equipe')}`;
  return `${esc(categoria?.nome || 'Categoria em definição')}. ${esc(descreverFormato(p))}. Criada em ${dataHora(p.criada_em)} ${quem}`;
}

function progresso(p, reprocessando) {
  // "ajuste" acontece antes da imagem: o agente lê o pedido de correção.
  const indice = Math.max(0, ETAPAS.findIndex(([id]) => id === (p.etapa === 'ajuste' ? 'imagem' : p.etapa)));
  const etapas = ETAPAS.map(([id, nome], i) => {
    const classe = i < indice ? 'progresso__etapa--feita' : i === indice ? 'progresso__etapa--atual' : '';
    return `<li class="progresso__etapa ${classe}" ${i === indice ? 'aria-current="step"' : ''}>${nome}</li>`;
  }).join('');
  const titulo = reprocessando
    ? 'Refazendo a peça depois da alteração humana. Ela passa pelas travas de novo.'
    : 'Gerando a peça. Leva de 1 a 2 minutos.';
  return `<section class="progresso" aria-label="Andamento"><p class="progresso__titulo">${titulo}</p><ol class="progresso__etapas">${etapas}</ol></section>`;
}

function situacao(p) {
  const r = p.revisao;
  const modoSimulacao = p.publicacao?.modo === 'simulacao';
  if (p.status === 'em_revisao') return `Aguardando decisão humana. ${esc(p.decisao?.motivo || '')}.`.replace('..', '.');
  if (p.status === 'aprovada') {
    return `Aprovada por ${esc(r?.usuario || 'equipe')} em ${dataHora(r?.em)}. Publicação pendente: ${esc(p.publicacao?.motivo || 'aguardando')}${
      p.publicacao?.erro ? ` (${esc(p.publicacao.erro)})` : ''
    }.`;
  }
  if (p.status === 'agendada') {
    const quem = r?.usuario ? `Aprovada por ${esc(r.usuario)}.` : 'Aprovada pelas travas, sem revisão humana.';
    return `${quem} Agendada para ${dataHora(p.agendamento?.para, { diaSemana: true })}.`;
  }
  if (p.status === 'publicada') {
    const base =
      p.decisao?.tipo === 'automatica'
        ? `Publicada sozinha em ${dataHora(p.publicacao?.em)}, sem revisão humana.`
        : `Aprovada por ${esc(r?.usuario || 'equipe')} e publicada em ${dataHora(p.publicacao?.em)}.`;
    const canal = canalManual();
    if (canal) {
      return `Aprovada por ${esc(r?.usuario || 'equipe')} em ${dataHora(p.publicacao?.em)}. Pronta para o executivo publicar no ${esc(canal.nome)}: copie o texto e baixe o PDF ou a imagem abaixo.`;
    }
    return `${base}${modoSimulacao ? ' Simulação: nada foi enviado ao Instagram.' : ''}`;
  }
  if (p.status === 'reprovada') return `Reprovada por ${esc(r?.usuario || 'equipe')} em ${dataHora(r?.em)}${r?.motivo ? `. Motivo: ${esc(r.motivo)}` : ''}.`;
  return '';
}

function regua(p, { comSituacao = true } = {}) {
  const g = p.governanca;
  const gate = g.gate;
  const passos = VEREDITOS.map((v) => {
    const ativo = v.id === gate.veredito;
    const apontamentos = [
      gate.bloqueios ? plural(gate.bloqueios, 'bloqueio', 'bloqueios') : '',
      gate.alertas ? plural(gate.alertas, 'alerta', 'alertas') : '',
    ].filter(Boolean);
    const legenda = ativo
      ? `${apontamentos.length ? apontamentos.join(' e ') : 'Nenhum apontamento'}. Nota média do revisor: ${decimal(gate.media_notas)}.`
      : v.significado;
    return `<li class="regua__passo regua__passo--${v.classe}" ${ativo ? 'aria-current="true"' : ''}><span class="regua__nome">${v.nome}</span><span class="regua__legenda">${esc(legenda)}</span></li>`;
  }).join('');
  const inicial =
    g.veredito_inicial && g.veredito_inicial !== gate.veredito
      ? `<p class="regua__nota">Veredito original, antes da alteração humana: ${esc(NOME_VEREDITO[g.veredito_inicial])}. É ele que conta na métrica de concordância da categoria.</p>`
      : '';
  return `<section class="regua" aria-label="Veredito das travas de governança"><ol class="regua__trilho">${passos}</ol>${comSituacao ? `<p class="regua__situacao">${situacao(p)}</p>` : ''}${inicial}</section>`;
}

function faixaSuperior(d) {
  const p = d.peca;
  if (p.status === 'gerando' || d.processando) return progresso(p, Boolean(p.governanca));
  if (p.status === 'erro') {
    return `<section class="falha" role="alert"><strong>A geração parou na etapa ${esc(NOME_ETAPA[p.etapa] || p.etapa || 'inicial')}</strong>${esc(p.erro || 'Motivo não informado.')}</section>`;
  }
  const aviso = p.erro ? `<section class="falha" role="alert"><strong>A última ação falhou</strong>${esc(p.erro)}</section>` : '';
  if (!p.governanca) return aviso;
  const gate = p.governanca.gate;
  const v = VEREDITOS.find((x) => x.id === gate.veredito) || VEREDITOS[1];
  const contagem = [gate.bloqueios ? plural(gate.bloqueios, 'bloqueio', 'bloqueios') : '', gate.alertas ? plural(gate.alertas, 'alerta', 'alertas') : '']
    .filter(Boolean)
    .join(' e ');
  return `${aviso}<div class="decisao decisao--${v.classe}">
    <span class="decisao__selo">${v.nome}</span>
    <span class="decisao__texto">${situacao(p)} <button type="button" class="decisao__ver" data-acao="aba-peca" data-aba="travas">${contagem ? `Ver ${contagem}` : 'Ver travas'}</button></span>
  </div>`;
}

function figura(d) {
  const p = d.peca;
  if (!p.arte?.url) {
    return `<figure class="arte"><div class="arte__vazia">A arte aparece aqui quando a imagem e o template ficarem prontos.</div></figure>`;
  }
  const slides = p.slides_arte?.length ? p.slides_arte : null;
  const temFundo = Boolean(p.imagem?.url);
  const fundo = ui.verFundo && temFundo;
  const ehFoto = p.imagem?.origem === 'foto';
  const ehBanco = p.imagem?.origem === 'banco';
  const ehArtigo = p.formato === 'artigo';
  const nomeFundo = !temFundo ? 'Sem imagem de fundo' : ehBanco ? 'Foto do banco da marca' : ehFoto ? 'Foto do banco de imagens' : 'Fundo gerado por IA';
  const indice = Math.min(ui.slideAtual || 0, (slides?.length || 1) - 1);
  const url = fundo ? p.imagem.url : slides ? slides[indice].url : p.arte.url;
  const alt = fundo
    ? ehBanco
      ? `Foto do banco de imagens da marca: ${p.imagem.arquivo}`
      : ehFoto
      ? `Foto real de ${p.imagem.credito?.autor || 'autor não informado'}`
      : `Fundo gerado por IA. Cena pedida: ${p.brief?.cena_visual || ''}`
    : slides
      ? `Slide ${indice + 1} de ${slides.length}`
      : `Arte final. Título: ${p.textos?.titulo || ''}`;
  let legenda;
  if (fundo && ehBanco) {
    legenda = `Foto ${esc(p.imagem.arquivo)}, escolhida no banco de imagens da marca. ${esc(p.imagem.motivo || '')}`;
  } else if (ehArtigo && !fundo) {
    legenda = `Capa do artigo, 1920 × 1080 px, no tamanho que o LinkedIn recomenda. ${ehBanco ? 'Usa uma foto do banco de imagens da marca.' : p.visual === 'ia' && temFundo ? 'Usa uma imagem criada por IA.' : 'Feita só com o design da marca.'}`;
  } else if (fundo && ehFoto) {
    legenda = `Foto de ${esc(p.imagem.credito?.autor || 'autor não informado')} no ${esc(p.imagem.credito?.fonte || 'Pexels')}, buscada por "${esc(p.imagem.consulta || '')}". É esta imagem que o revisor confere: sem texto, marcas ou dinheiro.`;
  } else if (fundo) {
    legenda = `Gerado com ${esc(p.imagem.modelo)} (${esc(PROVEDORES[p.imagem.provedor] || p.imagem.provedor)}) em ${esc(p.imagem.segundos)} s. É esta imagem que o revisor confere: sem texto, marcas, dinheiro ou pessoas deformadas.`;
  } else if (slides) {
    const capa = p.visual === 'design' ? 'o design da marca' : ehFoto ? 'a foto real' : 'a imagem criada por IA';
    legenda = `${slides.length} imagens de 1080 × 1350 px. A capa usa ${capa}; os outros slides usam só o design da marca.`;
  } else if (p.visual === 'design') {
    legenda = 'Peça feita só com o design da marca: nenhuma imagem de IA nem foto.';
  } else {
    legenda = '1080 × 1350 px. Textos, cores e avisos legais entram pelo template oficial, não pela IA de imagem.';
  }
  const navegacao =
    slides && !fundo
      ? `<div class="carrossel">
      <button type="button" class="carrossel__seta" data-acao="slide-anterior" ${indice === 0 ? 'disabled' : ''} aria-label="Slide anterior">‹</button>
      <span class="carrossel__contador">${indice + 1} de ${slides.length}</span>
      <button type="button" class="carrossel__seta" data-acao="slide-proximo" ${indice === slides.length - 1 ? 'disabled' : ''} aria-label="Próximo slide">›</button>
    </div>
    <div class="carrossel__miniaturas">${slides
      .map(
        (sl, i) =>
          `<button type="button" class="carrossel__miniatura" data-acao="ir-slide" data-indice="${i}" aria-label="Ver slide ${i + 1}" ${i === indice ? 'aria-current="true"' : ''}><img src="${esc(sl.url)}" alt="" loading="lazy"></button>`,
      )
      .join('')}</div>`
      : '';
  return `<figure class="arte">
    <div class="arte__alternar" role="group" aria-label="Imagem exibida">
      <button type="button" data-acao="ver-arte" aria-pressed="${!fundo}">${slides ? 'Slides' : 'Arte final'}</button>
      <button type="button" data-acao="ver-fundo" aria-pressed="${Boolean(fundo)}" ${temFundo ? '' : 'disabled'}>${nomeFundo}</button>
    </div>
    <a class="arte__link" href="${esc(url)}" target="_blank" rel="noopener"><img class="arte__imagem ${fundo ? 'arte__imagem--fundo' : ehArtigo ? 'arte__imagem--capa' : ''}" src="${esc(url)}" alt="${esc(alt)}"></a>
    ${navegacao}
    <figcaption class="arte__legenda">${legenda}</figcaption>
  </figure>`;
}

function porQue(d) {
  const o = d.peca.oportunidade;
  if (!o) return '';
  return bloco(
    'Por que este post',
    fatos([
      ['Gatilho', GATILHOS[o.gatilho] || o.gatilho],
      ['Sinal', o.sinal],
      ['Justificativa', o.justificativa],
      ['Urgência', NIVEIS[o.urgencia] || o.urgencia],
      d.peca.orientacao?.texto ? ['Orientação da equipe', d.peca.orientacao.texto] : null,
      o.fatos?.length ? ['Fatos confirmados', { html: `<ul class="lista-simples">${o.fatos.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` }] : null,
      o.fontes?.length ? ['Fontes', { html: fontesHtml(o.fontes) }] : null,
    ]),
  );
}

/** Fontes da notícia, com link. As que não apareceram nos resultados da busca ficam marcadas. */
function fontesHtml(fontes) {
  return `<ul class="lista-simples">${fontes
    .map((f) => {
      const seguro = /^https?:\/\//i.test(f.url || '');
      const nome = `${esc(f.veiculo || 'Fonte')}${f.titulo ? `: ${esc(f.titulo)}` : ''}`;
      const data = f.data_publicacao ? ` (${esc(f.data_publicacao.split('-').reverse().join('/'))})` : '';
      const link = seguro ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${nome}</a>` : nome;
      return `<li>${link}${data}${f.verificada ? '' : ' <strong class="aviso-fonte">não conferida na busca</strong>'}</li>`;
    })
    .join('')}</ul>`;
}

function publico(d) {
  const b = d.peca.brief;
  if (!b) return '';
  return bloco(
    'Público e objetivo',
    fatos([
      ['Público', d.segmento?.nome || b.segmento_id],
      ['Objetivo', b.objetivo],
      ['Insight', b.insight],
      ['Mensagem-chave', b.mensagem_chave],
      ['Chamada para ação', b.cta],
      ['Métrica de sucesso', KPIS[b.kpi] || b.kpi],
      ['Estilo visual', ESTILOS[b.estilo_visual] || b.estilo_visual],
      ['Cena pedida', b.cena_visual],
      d.oferta ? ['Oferta do catálogo', `${d.oferta.produto}: ${d.oferta.destaque}`] : null,
    ]),
  );
}

/** Parágrafos do texto de uma seção (separados por linha em branco). */
const paragrafos = (texto = '') =>
  String(texto)
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);

/** O corpo do artigo em HTML (para colar no editor de artigos do LinkedIn) e em texto simples. */
function corpoDoArtigo(t) {
  const html = [
    t.subtitulo ? `<p><em>${esc(t.subtitulo)}</em></p>` : '',
    ...(t.secoes || []).map((sc) => `<h2>${esc(sc.intertitulo)}</h2>${paragrafos(sc.texto).map((pg) => `<p>${esc(pg)}</p>`).join('')}`),
    t.conclusao ? `<h2>Conclusão</h2>${paragrafos(t.conclusao).map((pg) => `<p>${esc(pg)}</p>`).join('')}` : '',
    t.chamada_final ? `<p><strong>${esc(t.chamada_final)}</strong></p>` : '',
  ].join('');
  const texto = [
    t.subtitulo,
    ...(t.secoes || []).map((sc) => `${sc.intertitulo}\n\n${paragrafos(sc.texto).join('\n\n')}`),
    t.conclusao ? `Conclusão\n\n${t.conclusao}` : '',
    t.chamada_final,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { html, texto };
}

function artigoHtml(p) {
  const t = p.textos;
  const palavras = [t.subtitulo, ...(t.secoes || []).map((sc) => `${sc.intertitulo} ${sc.texto}`), t.conclusao, t.chamada_final].join(' ').split(/\s+/).filter(Boolean).length;
  return bloco(
    'Artigo para o LinkedIn',
    `<article class="artigo">
      <h3 class="artigo__titulo">${esc(t.titulo)}</h3>
      ${t.subtitulo ? `<p class="artigo__fina">${esc(t.subtitulo)}</p>` : ''}
      ${(t.secoes || [])
        .map((sc) => `<h4 class="artigo__intertitulo">${esc(sc.intertitulo)}</h4>${paragrafos(sc.texto).map((pg) => `<p>${esc(pg)}</p>`).join('')}`)
        .join('')}
      ${t.conclusao ? `<h4 class="artigo__intertitulo">Conclusão</h4>${paragrafos(t.conclusao).map((pg) => `<p>${esc(pg)}</p>`).join('')}` : ''}
      ${t.chamada_final ? `<p class="artigo__chamada">${esc(t.chamada_final)}</p>` : ''}
    </article>
    <div class="baixar">
      <button type="button" class="botao botao--secundario" data-acao="copiar-titulo-artigo">Copiar título</button>
      <button type="button" class="botao botao--primario" data-acao="copiar-artigo">Copiar artigo</button>
      ${p.arte?.url ? `<a class="botao botao--secundario" href="${esc(p.arte.url)}" download>Baixar capa</a>` : ''}
    </div>
    <p class="dica">Cerca de ${palavras} palavras. No LinkedIn: clique em “Escrever artigo”, cole o título no campo de título, cole o artigo no corpo e suba a capa.</p>`,
  );
}

function textos(d) {
  const p = d.peca;
  if (!p.textos) return '';
  const editavel = p.status === 'em_revisao' && !d.processando;
  const manual = canalManual();
  const ehArtigo = Array.isArray(p.textos.secoes);
  const baixar =
    d.legenda_final && p.arte
      ? `<div class="baixar">
          <button type="button" class="botao botao--secundario" data-acao="copiar-texto">${ehArtigo ? 'Copiar texto de divulgação' : 'Copiar texto do post'}</button>
          ${ehArtigo ? '' : `<a class="botao botao--secundario" href="/api/pecas/${esc(p.id)}/pdf" download>Baixar PDF${p.slides_arte?.length ? ' (carrossel)' : ''}</a>`}
          ${p.arte?.url ? `<a class="botao botao--texto" href="${esc(p.arte.url)}" target="_blank" rel="noopener">${ehArtigo ? 'Abrir capa' : 'Abrir imagem'}</a>` : ''}
        </div>`
      : '';
  // Primeiro o texto final do post, com copiar e baixar; os textos de cada imagem ficam numa caixa que abre ao clicar.
  const textoFinal = (ehArtigo ? artigoHtml(p) : '') + (d.legenda_final
    ? bloco(
        ehArtigo ? 'Post de divulgação do artigo' : manual ? `Texto do post para o ${esc(manual.nome)}` : 'Legenda como será publicada',
        `<p class="legenda-final">${esc(d.legenda_final)}</p>${baixar}<p class="dica">Rótulo de imagem criada com IA (só quando a imagem é de IA), crédito da foto e hashtags entram automaticamente.${editavel ? ' Atualiza quando você salvar.' : ''}</p>`,
      )
    : '');
  const recolhivel = (resumo, dica, conteudo, aberto) =>
    `<section class="bloco bloco--recolhivel"><details class="editar"${aberto ? ' open' : ''}><summary><span class="bloco__titulo">${resumo}</span><span class="recolhivel__dica">${dica}</span></summary><div class="editar__conteudo">${conteudo}</div></details></section>`;

  if (!editavel) {
    return (
      textoFinal +
      recolhivel(
        'Textos da arte',
        'Ver',
        fatos([
          ['Título', p.textos.titulo],
          ['Subtítulo', p.textos.subtitulo],
          ...(p.textos.slides || []).map((sl, i) => [p.formato === 'flashcards' ? `Cartão ${i + 1}` : `Slide ${i + 2}`, `${sl.titulo}. ${sl.texto}`]),
          ...(p.textos.secoes || []).map((sc, i) => [`Seção ${i + 1}`, sc.intertitulo]),
          ['Fechamento', p.textos.fechamento],
          ['Chamada', p.textos.cta_arte],
        ]),
        Boolean(ui.editarAberto),
      )
    );
  }

  const valores = ui.rascunho || textosParaForm(p.textos);
  const campos = camposDaPeca(p).map((c) => {
    const m = medida(c, valores[c.id] ?? '');
    const controle = c.linhas
      ? `<textarea id="campo-${c.id}" data-campo="${c.id}" rows="${c.linhas}">${esc(valores[c.id])}</textarea>`
      : `<input id="campo-${c.id}" type="text" data-campo="${c.id}" value="${esc(valores[c.id])}">`;
    return `${c.grupo && Array.isArray(p.textos.slides) ? `<h4 class="campos__grupo">${esc(c.grupo)}</h4>` : ''}<div class="campo"><label class="campo__rotulo" for="campo-${c.id}"><span>${c.rotulo}</span><span class="campo__contador ${m.excedido ? 'campo__contador--excedido' : ''}" id="contador-${c.id}">${m.texto}</span></label>${controle}</div>`;
  }).join('');
  return textoFinal + recolhivel('Textos da arte', 'Editar', campos, Boolean(ui.editarAberto || ui.rascunho));
}

function checagem(estado, nome, detalhe) {
  const icone = { ok: '✓', alerta: '!', bloqueio: '×' }[estado] || '?';
  const rotulo = { ok: 'Sem apontamento', alerta: 'Alerta', bloqueio: 'Bloqueio' }[estado] || estado;
  return `<li class="checagem"><span class="checagem__icone checagem__icone--${estado}" role="img" aria-label="${rotulo}">${icone}</span><span><span class="checagem__nome">${esc(nome)}</span><span class="checagem__detalhe">${esc(detalhe)}</span></span></li>`;
}

function travas(d) {
  const g = d.peca.governanca;
  if (!g) return '';
  const rot = ui.estado?.rotulos || { checagens_visuais: {}, severidade_visao: {} };
  const origem = { visao: 'revisor com visão', juiz: 'revisor de IA', regra: 'regra em código' };
  const apontamentos = g.gate.motivos.length
    ? `<ul class="apontamentos">${g.gate.motivos
        .map(
          (m) =>
            `<li class="apontamento apontamento--${m.severidade}"><span class="gravidade gravidade--${m.severidade}">${m.severidade === 'bloqueio' ? 'Bloqueio' : 'Alerta'}</span><span>${esc(m.texto)} <span class="origem">(${origem[m.origem] || m.origem})</span></span></li>`,
        )
        .join('')}</ul>`
    : '<p class="tudo-certo">Nenhuma trava apontou problema.</p>';

  const regras = g.regras.map((r) => checagem(r.ok ? 'ok' : r.severidade, r.nome, r.detalhe)).join('');
  const itensVisuais = Object.entries(rot.checagens_visuais);
  const visao = itensVisuais
    .map(([chave, nome]) => {
      const presente = Boolean(g.juiz?.elementos_no_fundo?.[chave]);
      const severidade = rot.severidade_visao[chave] || 'alerta';
      return checagem(presente ? severidade : 'ok', nome, presente ? `Encontrado no fundo gerado. Na política: ${severidade}.` : 'Não encontrado.');
    })
    .join('');

  return bloco(
    'Travas de governança',
    `${apontamentos}<details class="todas-checagens"><summary>Ver todas as checagens (${g.regras.length} regras em código e ${itensVisuais.length} itens visuais)</summary>
      <h4 class="bloco__subtitulo">Regras em código, sobre textos, público e oferta</h4><ul class="checagens">${regras}</ul>
      <h4 class="bloco__subtitulo">Revisor com visão, sobre o fundo gerado</h4><ul class="checagens">${visao}</ul>
    </details>`,
  );
}

function revisor(d) {
  const j = d.peca.governanca?.juiz;
  if (!j) return '';
  const rot = ui.estado?.rotulos || { notas: {} };
  const minimo = rot.juiz?.nota_minima_item ?? 6;
  const notas = Object.entries(rot.notas)
    .map(([chave, nome]) => {
      const valor = Number(j.notas?.[chave] ?? 0);
      return `<div class="nota ${valor < minimo ? 'nota--baixa' : ''}"><span>${esc(nome)}</span><span class="nota__barra" role="img" aria-label="${esc(nome)}: ${valor} de 10"><span style="width:${valor * 10}%"></span></span><span class="nota__valor">${valor}</span></div>`;
    })
    .join('');
  const sugestoes = j.sugestoes?.length ? { html: `<ul>${j.sugestoes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` } : null;
  return bloco(
    'Revisor de IA',
    `<div class="notas">${notas}</div>${fatos([
      ['Risco reputacional', `${(NIVEIS[j.risco_reputacional] || j.risco_reputacional || '').replace(/^./, (c) => c.toUpperCase())}. ${j.justificativa_risco || ''}`],
      ['Publicaria como está', j.aprovaria_sem_edicao ? 'Sim' : 'Não, editaria antes'],
      ['O que viu na imagem', j.observacoes_visuais],
      sugestoes ? ['Sugestões', sugestoes] : null,
      ['Modelo', j.modelo],
    ])}`,
  );
}

function acoesHtml(d) {
  const p = d.peca;
  if (d.processando || p.status === 'gerando') return '';
  const e = ui.estado;
  const real = e?.config?.publicacao_modo === 'real';
  const pausado = Boolean(e?.controle?.pausado);

  if (p.status === 'em_revisao') {
    const bloqueada = p.governanca?.gate?.veredito === 'bloqueada';
    const alterado = rascunhoAlterado();
    let nota = canalManual()
      ? `Seu nome fica na trilha de auditoria. Ao aprovar, a peça fica pronta para o executivo publicar no ${canalManual().nome}.`
      : `Seu nome fica na trilha de auditoria. Ao aprovar, você escolhe se publica agora ou num horário da programação.${real ? '' : ' Em simulação, nada é enviado ao Instagram.'}`;
    if (pausado) nota = 'Sistema pausado: você pode aprovar, mas a publicação fica aguardando até a retomada.';
    if (bloqueada) nota = 'Peça bloqueada: corrija os textos ou gere nova imagem. Toda alteração passa pelas travas de novo.';
    if (alterado) nota = 'Salve os textos para refazer a arte e passar pelas travas antes de aprovar.';
    return `<div class="acoes" id="acoes">
      <button type="button" class="botao botao--primario" data-acao="aprovar" ${bloqueada || alterado ? 'disabled' : ''}>Aprovar</button>
      <button type="button" class="botao botao--secundario" data-acao="salvar-textos" ${alterado ? '' : 'disabled'}>Salvar textos e reavaliar</button>
      ${alterado ? '<button type="button" class="botao botao--texto" data-acao="descartar">Descartar alterações</button>' : ''}
      <button type="button" class="botao botao--secundario" data-acao="ajustar-textos-ia" ${alterado ? 'disabled' : ''}>Ajustar texto com IA</button>
      <button type="button" class="botao botao--secundario" data-acao="nova-imagem">Novo visual</button>
      <span class="acoes__separador"></span>
      <button type="button" class="botao botao--perigo" data-acao="reprovar">Reprovar</button>
      <p class="acoes__nota" id="acoes-nota">${nota}</p>
    </div>`;
  }
  if (p.status === 'agendada') {
    return `<div class="acoes" id="acoes">
      <button type="button" class="botao botao--primario" data-acao="mudar-horario">Mudar horário</button>
      <button type="button" class="botao botao--secundario" data-acao="publicar-agora" ${pausado ? 'disabled' : ''}>Publicar agora</button>
      <span class="acoes__separador"></span>
      <button type="button" class="botao botao--perigo" data-acao="cancelar-agendamento">Cancelar agendamento</button>
      <p class="acoes__nota">${
        pausado
          ? 'Sistema pausado: o post agendado só sai depois da retomada.'
          : `Sai sozinho em ${dataHora(p.agendamento?.para, { diaSemana: true })}. As travas conferem a peça mais uma vez no envio.`
      }</p>
    </div>`;
  }
  if (p.status === 'aprovada') {
    return `<div class="acoes" id="acoes">
      <button type="button" class="botao botao--primario" data-acao="publicar-agora" ${pausado ? 'disabled' : ''}>Publicar agora</button>
      <button type="button" class="botao botao--secundario" data-acao="mudar-horario">Agendar</button>
      <p class="acoes__nota">${pausado ? 'Sistema pausado. Retome a operação para publicar.' : 'A publicação passa pelas travas mais uma vez no momento do envio.'}</p>
    </div>`;
  }
  if (p.status === 'publicada' && p.publicacao?.permalink) {
    return `<div class="acoes" id="acoes"><a class="botao botao--secundario" href="${esc(p.publicacao.permalink)}" target="_blank" rel="noopener">Abrir no Instagram</a></div>`;
  }
  if (p.status === 'erro') {
    return `<div class="acoes" id="acoes"><button type="button" class="botao botao--primario" data-acao="abrir-gerar">Gerar outra peça</button></div>`;
  }
  return '';
}

function auditoriaHtml(eventos = []) {
  if (!eventos.length) return '';
  const itens = eventos
    .map((ev) => {
      const classes = [ev.ator?.startsWith('humano:') ? 'evento--humano' : '', ev.etapa === 'erro' ? 'evento--erro' : ''].join(' ');
      const detalhe = ev.detalhe
        ? `<details><summary>Ver registro completo</summary><pre>${esc(JSON.stringify(ev.detalhe, null, 2))}</pre></details>`
        : '';
      return `<li class="evento ${classes}"><div class="evento__cabeca"><span>${dataHora(ev.em, { segundos: true })}</span><span class="evento__ator">${esc(ator(ev.ator))}</span></div><p class="evento__resumo">${esc(ev.resumo)}</p>${detalhe}</li>`;
    })
    .join('');
  return `<section class="auditoria"><h3 class="bloco__titulo">Trilha de auditoria</h3><ol class="linha-do-tempo">${itens}</ol></section>`;
}

function boasVindas() {
  const passos = [
    ['Radar', 'Percebe a necessidade: datas do calendário, objetivos do perfil, histórico de posts e orientação da equipe.'],
    ['Brief e público', 'Define objetivo, segmento, mensagem, métrica de sucesso e a cena da imagem.'],
    ['Textos', 'Escreve título, subtítulo, chamada e legenda, sem números financeiros e sem promessas.'],
    ['Imagem', 'Gera só a cena, sem texto, marcas, dinheiro ou pessoas públicas.'],
    ['Arte', 'O template oficial aplica textos, cores e os avisos legais do catálogo.'],
    ['Travas', 'Regras em código e um revisor de IA com visão decidem: bloqueia, pede humano ou libera.'],
  ];
  const n = contagemDaLista();
  const contar = (veredito) => ui.pecas.filter((p) => p.status === 'em_revisao' && p.veredito === veredito).length;
  const resumo =
    ui.aba === 'fila' && n
      ? `<ul class="fila-resumo__numeros">
          <li class="fila-resumo__numero fila-resumo__numero--verde"><b>${contar('publicavel')}</b> publicáveis</li>
          <li class="fila-resumo__numero fila-resumo__numero--ambar"><b>${contar('precisa_humano')}</b> precisam de revisão</li>
          <li class="fila-resumo__numero fila-resumo__numero--vermelho"><b>${contar('bloqueada')}</b> bloqueadas</li>
        </ul>`
      : '';
  const chamada =
    ui.aba === 'fila' && !n
      ? `<p class="fila-resumo__texto">Nada para revisar agora.</p><button type="button" class="botao botao--primario" data-acao="abrir-gerar">Gerar peça agora</button>`
      : `<p class="fila-resumo__texto">${ui.aba === 'fila' ? `${n === 1 ? 'peça esperando' : 'peças esperando'} a sua decisão` : `${n === 1 ? 'peça' : 'peças'} no total`}</p>${botaoFila('botao botao--primario abrir-fila--grande')}`;
  return `<div class="boas-vindas">
    <section class="fila-resumo">
      <p class="fila-resumo__rotulo">${nomeDaLista()}</p>
      ${n ? `<p class="fila-resumo__total">${n}</p>` : ''}
      ${chamada}
      ${resumo}
    </section>
    <h2 class="boas-vindas__titulo">Abra a fila e escolha uma peça para revisar</h2>
    <p class="boas-vindas__texto">Cada peça mostra a arte, o motivo do post, o público escolhido e o que cada trava encontrou. Toda decisão, da IA ou de uma pessoa, fica na trilha de auditoria.</p>
    <h3 class="bloco__titulo">Como uma peça chega até aqui</h3>
    <ol class="percurso">${passos.map(([t, desc]) => `<li class="percurso__passo"><strong>${t}</strong><span>${desc}</span></li>`).join('')}</ol>
  </div>`;
}

function renderDetalhe() {
  const area = $('#area-pecas');
  area.dataset.vista = ui.selecionada ? 'detalhe' : 'lista';
  const el = $('#detalhe');
  if (!ui.selecionada || !ui.detalhe) {
    el.innerHTML = boasVindas();
    return;
  }
  const d = ui.detalhe;
  const p = d.peca;
  const textosHtml = textos(d);
  let post = '';
  if (p.arte) {
    post = `<div class="peca__corpo">${figura(d)}<div class="peca__info">${textosHtml}</div></div>`;
  } else if (p.status === 'erro') {
    // Falhou antes da arte: mostra só o que chegou a ser produzido, sem o espaço vazio da imagem.
    post = textosHtml ? `<div class="peca__corpo peca__corpo--sem-arte"><div class="peca__info">${textosHtml}</div></div>` : '';
  } else if (p.status !== 'gerando') {
    post = `<div class="peca__corpo">${figura(d)}<div class="peca__info">${textosHtml}</div></div>`;
  }
  // Cada parte da peça fica numa aba, para a tela mostrar uma coisa de cada vez.
  const gate = p.governanca?.gate;
  const abas = [
    { id: 'post', nome: 'Post', html: post },
    { id: 'estrategia', nome: 'Estratégia', html: `${porQue(d)}${publico(d)}` },
    {
      id: 'travas',
      nome: 'Travas',
      html: p.governanca ? `${regua(p, { comSituacao: false })}${travas(d)}${revisor(d)}` : '',
      contador: (gate?.bloqueios || 0) + (gate?.alertas || 0),
    },
    { id: 'historico', nome: 'Histórico', html: auditoriaHtml(d.auditoria) },
  ].filter((a) => a.html);
  const atual = abas.some((a) => a.id === ui.abaPeca) ? ui.abaPeca : abas[0]?.id;
  const barra =
    abas.length > 1
      ? `<div class="sub-abas" role="tablist" aria-label="Partes da peça">${abas
          .map(
            (a) =>
              `<button type="button" role="tab" class="sub-aba" id="sub-aba-${a.id}" aria-controls="painel-${a.id}" aria-selected="${a.id === atual}" data-acao="aba-peca" data-aba="${a.id}">${a.nome}${
                a.contador ? `<span class="sub-aba__contador">${a.contador}</span>` : ''
              }</button>`,
          )
          .join('')}</div>`
      : '';
  const paineis = abas
    .map((a) => `<section class="painel-peca" id="painel-${a.id}" role="tabpanel" aria-labelledby="sub-aba-${a.id}" ${a.id === atual ? '' : 'hidden'}>${a.html}</section>`)
    .join('');
  const tema = p.oportunidade?.tema || (p.status === 'erro' ? 'Geração interrompida antes da escolha do tema' : 'Tema em definição pelo radar');
  el.innerHTML = `<article class="peca">
    <div class="peca__navegacao">
      <button type="button" class="voltar" data-acao="voltar">← Voltar ao início</button>
      ${botaoFila()}
    </div>
    <p class="peca__contexto">${contextoDaPeca(p, d.categoria)}</p>
    <h2 class="peca__tema">${esc(tema)}</h2>
    ${faixaSuperior(d)}
    ${barra}
    ${paineis}
    ${acoesHtml(d)}
  </article>`;
}

function atualizarAcoes() {
  const atual = $('#acoes');
  if (atual && ui.detalhe) atual.outerHTML = acoesHtml(ui.detalhe);
}

/* ----------------------------------------------------------------- autonomia */

function medidor(rotulo, valorTexto, fracao, meta) {
  const ok = meta == null ? fracao >= 1 : fracao >= meta;
  return `<div class="medidor">
    <div class="medidor__rotulo"><span>${rotulo}</span><span>${valorTexto}</span></div>
    <div class="medidor__trilho" role="img" aria-label="${rotulo}: ${valorTexto}">
      <span class="medidor__preenchido ${ok ? 'medidor__preenchido--ok' : ''}" style="width:${Math.min(1, fracao) * 100}%"></span>
      ${meta != null ? `<span class="medidor__meta" style="left:${meta * 100}%"></span>` : ''}
    </div>
  </div>`;
}

function categoriaHtml(c) {
  const m = c.metricas;
  const auto = c.modo === 'auto';
  const permitido = c.autonomia_maxima === 'auto';
  const numeros = `${plural(m.total, 'peça', 'peças')}, ${plural(m.publicadas, 'publicada', 'publicadas')}${m.publicadas_sozinhas ? `, ${m.publicadas_sozinhas} sem humano` : ''}${
    m.alertas_ignorados_pelo_humano ? `. ${plural(m.alertas_ignorados_pelo_humano, 'peça com alerta aprovada', 'peças com alerta aprovadas')} sem edição` : ''
  }.`;

  const evidencia = permitido
    ? `${medidor('Revisões com veredito publicável', `${m.revisadas_com_gate_publicavel} de ${m.min_amostras}`, m.revisadas_com_gate_publicavel / m.min_amostras, null)}
       ${medidor('Concordância humana', m.concordancia == null ? 'Sem revisões ainda' : `${pct(m.concordancia)}, meta ${pct(m.meta_concordancia)}`, m.concordancia ?? 0, m.meta_concordancia)}
       <p class="categoria__numeros">${numeros}</p>`
    : `<p class="categoria__numeros">${numeros}</p>`;

  let decisao;
  if (!permitido) {
    decisao = '<p class="categoria__motivo">A política exige aprovação humana em todas as peças desta categoria.</p>';
  } else if (auto) {
    decisao = `<button type="button" class="botao botao--secundario" data-acao="restringir" data-categoria="${esc(c.id)}">Voltar para aprovação humana</button>
      <p class="categoria__motivo">Liberada por ${esc(ator(c.modo_atualizado_por || 'equipe'))}. Volta sozinha para humano se a concordância cair.</p>`;
  } else {
    const revogada =
      c.modo_atualizado_por === 'sistema:autonomia'
        ? ' Esta categoria já teve autonomia e voltou sozinha para aprovação humana quando a concordância caiu.'
        : '';
    decisao = `<button type="button" class="botao botao--primario" data-acao="liberar" data-categoria="${esc(c.id)}" ${m.pode_liberar ? '' : 'disabled'}>Liberar publicação automática</button>
      <p class="categoria__motivo">${m.pode_liberar ? 'A evidência atingiu a meta. A liberação é uma decisão humana.' : esc(m.motivo_bloqueio_liberacao || '')}${revogada}</p>`;
  }

  return `<li class="categoria">
    <div>
      <h3 class="categoria__nome">${esc(c.nome)}</h3>
      <div class="etiquetas">
        <span class="etiqueta etiqueta--${auto ? 'auto' : 'humano'}">${auto ? 'Publica sozinha' : 'Aprovação humana'}</span>
        <span class="etiqueta">Risco ${esc(NIVEIS[c.risco] || c.risco)}</span>
        ${c.disponivel_hoje ? '' : '<span class="etiqueta">Sem oferta ativa no catálogo</span>'}
      </div>
    </div>
    <div>${evidencia}</div>
    <div class="categoria__acao">${decisao}</div>
  </li>`;
}

function renderAutonomia() {
  const e = ui.estado;
  if (!e) return;
  const a = e.config.autonomia;
  const c = e.config;
  const intro = `
    <p>Toda categoria começa com aprovação humana em todas as peças. A publicação automática só pode ser liberada com evidência: pelo menos ${a.min_amostras} peças revisadas em que as travas deram o veredito “publicável” e o humano aprovou sem editar em ${pct(a.meta_concordancia)} delas ou mais.</p>
    <p>Depois da liberação, ${pct(a.amostragem_auditoria)} das peças continuam indo para conferência humana por sorteio. Se a concordância cair abaixo da meta, a categoria volta sozinha para aprovação humana.</p>`;
  const config = fatos([
    ['Marca', c.marca],
    ['Publicação', c.canal?.tipo === 'manual' ? `Manual: o executivo publica no ${c.canal.nome}` : c.publicacao_modo === 'real' ? 'Real, no Instagram' : 'Simulação: o sistema registra o que publicaria, sem enviar nada'],
    ['Radar, brief e textos', c.modelo_ia],
    ['Revisor de IA', c.modelo_revisor],
    ['Imagem', `${c.modelo_imagem} (${PROVEDORES[c.provedor_imagem] || c.provedor_imagem})`],
    ['Armazenamento', c.armazenamento === 'supabase' ? 'Supabase' : 'Local, em arquivos'],
    [
      'Agenda automática',
      e.agenda?.ativa ? `${e.agenda.expressao} (${e.agenda.fuso}). Próxima: ${dataHora(e.agenda.proxima, { diaSemana: true })}` : 'Desligada',
    ],
    [
      'Limites diários',
      e.limites.geracoes_por_dia || e.limites.publicacoes_por_dia
        ? `${e.limites.geracoes_por_dia || 'sem limite de'} gerações e ${e.limites.publicacoes_por_dia || 'sem limite de'} publicações`
        : 'Sem limite. O Instagram aceita até 100 publicações pela API a cada 24 horas.',
    ],
    ['Política', `Versão ${c.politica_versao}, em politica.json`],
  ]);
  pintar(
    $('#area-autonomia'),
    'autonomia',
    `<div class="autonomia">
      <h2 class="autonomia__titulo">Autonomia por categoria</h2>
      <div class="autonomia__intro">${intro}</div>
      <ul class="categorias">${e.categorias.map(categoriaHtml).join('')}</ul>
      <section class="config"><h3 class="config__titulo">Configuração ativa</h3>${config}</section>
    </div>`,
  );
}

/* ----------------------------------------------------------------- diálogos */

function confirmar({ titulo, texto, campo = null, botao, perigo = false }) {
  const dialogo = $('#dlg-confirmar');
  $('#dlg-confirmar-titulo').textContent = titulo;
  $('#dlg-confirmar-texto').textContent = texto;
  const bloco = $('#dlg-confirmar-campo');
  const area = bloco.querySelector('textarea');
  bloco.hidden = !campo;
  area.value = '';
  area.placeholder = campo?.placeholder || '';
  $('#dlg-confirmar-rotulo').textContent = campo?.rotulo || '';
  const confirmacao = $('#dlg-confirmar-botao');
  confirmacao.textContent = botao;
  confirmacao.className = `botao ${perigo ? 'botao--perigo-cheio' : 'botao--primario'}`;
  dialogo.returnValue = '';
  dialogo.showModal();
  if (campo) area.focus();
  return new Promise((resolver) => {
    dialogo.addEventListener(
      'close',
      () => resolver(dialogo.returnValue === 'confirmar' ? { ok: true, valor: area.value.trim() } : { ok: false }),
      { once: true },
    );
  });
}

function abrirGerar() {
  if (ui.estado?.em_geracao) {
    trocarAba('fila');
    selecionar(ui.estado.em_geracao);
    return;
  }
  const categorias = ui.estado?.categorias || [];
  $('#gerar-categoria').innerHTML =
    '<option value="">O radar escolhe</option>' +
    categorias
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.disponivel_hoje ? '' : 'disabled'}>${esc(c.nome)}${c.disponivel_hoje ? '' : ' (sem oferta ativa no catálogo)'}</option>`,
      )
      .join('');
  const slides = $('#gerar-slides');
  if (!slides.options.length) {
    slides.innerHTML = [3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n} imagens</option>`).join('');
  }
  const dialogo = $('#dlg-gerar');
  $('#form-gerar').reset();
  slides.value = '6';
  const opcaoFoto = $('#gerar-visual option[value="foto"]');
  const temFotos = Boolean(ui.estado?.config?.fotos_disponiveis);
  opcaoFoto.disabled = !temFotos;
  const fontesDeFotos = ui.estado?.config?.fontes_de_fotos || [];
  opcaoFoto.textContent = temFotos ? `Foto real (${fontesDeFotos.join(' e ') || 'banco de imagens'})` : 'Foto real (falta a chave PEXELS_API_KEY)';
  opcaoFoto.dataset.base = opcaoFoto.textContent;
  // Formatos do perfil: o artigo do LinkedIn só aparece quando a política libera.
  const formatos = ui.estado?.config?.formatos?.map((f) => f.id);
  for (const opcao of $('#gerar-formato').options) {
    const ok = !formatos || formatos.includes(opcao.value);
    opcao.hidden = !ok;
    opcao.disabled = !ok;
  }
  atualizarDialogoGerar();
  dialogo.returnValue = '';
  dialogo.showModal();
}

function atualizarDialogoGerar() {
  const formato = $('#gerar-formato').value;
  const n = Number($('#gerar-slides').value) || 6;
  $('#gerar-slides-campo').hidden = formato === 'post' || formato === 'artigo';
  const notas = {
    artigo: 'Artigo de 700 a 1.200 palavras, com seções, conclusão e capa no tamanho do LinkedIn. Vem com o post que divulga o artigo no feed.',
    post: 'Uma imagem com título, subtítulo e botão. A legenda aprofunda o assunto.',
    carrossel: `Capa, ${n - 2} slides de conteúdo e um slide final com a chamada. O conteúdo principal vai nos slides, e a legenda fica mais curta.`,
    flashcards: `Capa, ${n - 2} cartões de estudo (termo e explicação) e um slide final. Bom para ensinar conceitos.`,
    pista: `Uma volta contínua que atravessa as ${n} imagens: largada na capa, ${n - 2} trechos com conteúdo e a bandeirada no final. A pista é desenhada pelo sistema.`,
  };
  $('#gerar-nota-formato').textContent = notas[formato];
  // No carrossel em pista, a imagem é a própria pista desenhada.
  const visual = $('#gerar-visual');
  if (formato === 'pista') {
    visual.dataset.antes ??= visual.value;
    visual.value = 'design';
    visual.disabled = true;
  } else if (visual.disabled) {
    visual.disabled = false;
    visual.value = visual.dataset.antes || 'ia';
    delete visual.dataset.antes;
  }
  // Tipos de imagem que a marca permite, e o banco de imagens só quando já tem fotos.
  const permitidos = ui.estado?.config?.visuais_permitidos;
  const fotosNoBanco = ui.estado?.config?.banco_de_imagens || 0;
  for (const opcao of visual.options) {
    opcao.dataset.base ??= opcao.textContent;
    const permitido = !permitidos?.length || permitidos.includes(opcao.value);
    const semFotos = opcao.value === 'banco' && !fotosNoBanco;
    const semChave = opcao.value === 'foto' && !ui.estado?.config?.fotos_disponiveis;
    opcao.disabled = !permitido || semFotos || semChave;
    opcao.textContent =
      opcao.value === 'banco' && fotosNoBanco
        ? `Foto do banco de imagens da marca (${fotosNoBanco} ${fotosNoBanco === 1 ? 'foto' : 'fotos'})`
        : `${opcao.dataset.base}${!permitido ? ' (fora das regras da marca)' : semFotos ? ' (o banco ainda não tem fotos)' : ''}`;
  }
  if (visual.selectedOptions[0]?.disabled) visual.value = [...visual.options].find((o) => !o.disabled)?.value || 'design';
}

$('#dlg-gerar').addEventListener('close', async () => {
  if ($('#dlg-gerar').returnValue !== 'confirmar') return;
  const dados = new FormData($('#form-gerar'));
  try {
    const peca = await acao('/api/pipeline/rodar', {
      texto: dados.get('texto'),
      categoria: dados.get('categoria'),
      formato: dados.get('formato'),
      visual: dados.get('visual'),
      slides: Number(dados.get('slides')) || null,
    });
    avisar('Geração iniciada. Acompanhe as etapas na peça.');
    trocarAba('fila');
    await selecionar(peca.id);
    await atualizarTudo();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
});

/* ---------------------------------------------------------------- interação */

async function executar(botao, rotuloOcupado, tarefa) {
  const original = botao?.textContent;
  if (botao) {
    botao.disabled = true;
    botao.textContent = rotuloOcupado;
  }
  try {
    await tarefa();
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
  try {
    await atualizarTudo();
  } catch {
    /* o ciclo de atualização avisa se a conexão caiu */
  }
  // Botões do detalhe são redesenhados acima. Os fixos (topo) continuam na página e precisam voltar a funcionar.
  if (botao?.isConnected) {
    botao.disabled = false;
    if (botao.textContent === rotuloOcupado) botao.textContent = original;
  }
}

async function selecionar(id) {
  if (ui.selecionada !== id) {
    ui.rascunho = null;
    ui.verFundo = false;
    ui.slideAtual = 0;
    ui.abaPeca = 'post';
  }
  ui.selecionada = id;
  history.replaceState(null, '', id ? `#peca=${id}` : location.pathname);
  renderLista();
  await carregarDetalhe();
  $('#detalhe').scrollTop = 0;
  // No celular a página rola inteira: leva o leitor direto para a peça aberta.
  if (telaEstreita()) $('#principal').scrollIntoView({ block: 'start' });
  agendar();
}

/* ---------------------------------------------------------------- programação */

const ANTECEDENCIAS = [
  [3, '3 horas antes'],
  [12, '12 horas antes'],
  [24, '1 dia antes'],
  [48, '2 dias antes'],
];

function rascunhoDaProgramacao() {
  const r = ui.progRascunho;
  return {
    horarios: r.horarios,
    gerar_automaticamente: r.gerar_automaticamente,
    antecedencia_horas: r.antecedencia_horas,
    formato_padrao: r.formato_padrao,
    visual_padrao: r.visual_padrao,
    slides_padrao: r.slides_padrao,
  };
}

async function carregarProgramacao() {
  ui.programacao = await api('/api/programacao');
  renderProgramacao();
}

function situacaoDoHorario(h) {
  if (h.peca?.status === 'agendada') {
    return `Agendado: <button type="button" class="link" data-acao="abrir-da-programacao" data-id="${esc(h.peca.id)}">${esc(h.peca.titulo || 'peça sem título')}</button>`;
  }
  if (h.peca) {
    return `Peça ${h.peca.status === 'gerando' ? 'sendo gerada' : 'esperando sua aprovação'}: <button type="button" class="link" data-acao="abrir-da-programacao" data-id="${esc(h.peca.id)}">${esc(h.peca.titulo || 'ver peça')}</button>`;
  }
  if (h.gera_em) return `Livre. A peça é gerada em ${esc(dataHora(h.gera_em, { diaSemana: true }))} e espera sua aprovação.`;
  return 'Livre. Aprove uma peça para ocupar este horário.';
}

/* Datas no fuso do sistema, para a prévia e o calendário. */
function partesNoFuso(data, fuso) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(data).map((x) => [x.type, x.value]));
  return { dia: `${o.year}-${o.month}-${o.day}`, hora: `${o.hour}:${o.minute}` };
}
const somarDiasIso = (iso, n) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const diaDaSemanaIso = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay();
};
const NOMES_DOS_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_DO_CALENDARIO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Próximas ocorrências dos horários do rascunho (para a prévia antes de salvar). */
function horariosDoRascunho(horarios, fuso, dias = 62) {
  const agora = partesNoFuso(new Date(), fuso);
  const lista = [];
  for (let k = 0; k < dias; k++) {
    const dia = somarDiasIso(agora.dia, k);
    const semana = diaDaSemanaIso(dia);
    for (const h of horarios) if (h.dia === semana && (k > 0 || h.hora > agora.hora)) lista.push({ dia, hora: h.hora });
  }
  return lista.sort((a, b) => `${a.dia}${a.hora}`.localeCompare(`${b.dia}${b.hora}`));
}

/** Eventos do calendário por dia: horários, agendados, publicados e posts da régua. */
function eventosDoCalendario(p, previa) {
  const porDia = new Map();
  const add = (dia, ev) => {
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(ev);
  };
  const cal = p.calendario || { horarios: [], publicadas: [], regua: [] };
  if (previa) {
    for (const h of horariosDoRascunho(ui.progRascunho.horarios, p.fuso)) add(h.dia, { tipo: 'previa', hora: h.hora, texto: 'horário (prévia)' });
  } else {
    for (const h of cal.horarios) {
      const { dia, hora } = partesNoFuso(new Date(h.para), p.fuso);
      if (h.peca) add(dia, { tipo: h.peca.status === 'agendada' ? 'agendado' : 'aguardando', hora, texto: h.peca.titulo || 'peça', id: h.peca.id });
      else add(dia, { tipo: 'horario', hora, texto: 'horário livre' });
    }
  }
  const nosHorarios = new Set(cal.horarios.filter((h) => h.peca).map((h) => h.peca.id));
  for (const a of p.agendadas) {
    if (!previa && nosHorarios.has(a.id)) continue;
    const { dia, hora } = partesNoFuso(new Date(a.para), p.fuso);
    add(dia, { tipo: 'agendado', hora, texto: a.titulo || 'peça', id: a.id });
  }
  for (const a of cal.publicadas) {
    const { dia, hora } = partesNoFuso(new Date(a.para), p.fuso);
    add(dia, { tipo: 'publicado', hora, texto: a.titulo || 'peça', id: a.id });
  }
  for (const i of cal.regua) {
    add(i.data, { tipo: 'regua', hora: '', texto: i.titulo, id: i.peca_id, regua: i.regua, status: i.status, ja_produzido: i.ja_produzido });
  }
  for (const lista of porDia.values()) lista.sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99'));
  return porDia;
}

function calendarioHtml(p, previa) {
  const hoje = partesNoFuso(new Date(), p.fuso).dia;
  ui.calMes ??= hoje.slice(0, 7);
  const [ano, mes] = ui.calMes.split('-').map(Number);
  const primeiro = `${ui.calMes}-01`;
  const inicio = somarDiasIso(primeiro, -diaDaSemanaIso(primeiro));
  const eventos = eventosDoCalendario(p, previa);
  const ROTULO = { horario: 'Livre', previa: 'Prévia', agendado: 'Agendado', aguardando: 'Esperando aprovação', publicado: 'Publicado', regua: 'Régua' };
  const celulas = [];
  for (let k = 0; k < 42; k++) {
    const dia = somarDiasIso(inicio, k);
    if (k === 35 && dia.slice(0, 7) !== ui.calMes) break;
    const doMes = dia.slice(0, 7) === ui.calMes;
    const lista = eventos.get(dia) || [];
    const itens = lista
      .slice(0, 3)
      .map((ev) => {
        const texto = `${ev.hora ? `${esc(ev.hora)} ` : ''}${esc(ev.texto)}`;
        const titulo = `${ROTULO[ev.tipo]}${ev.regua ? ` · ${ev.regua}` : ''}: ${ev.hora ? `${ev.hora} ` : ''}${ev.texto}`;
        const acao = ev.id ? `data-acao="abrir-da-programacao" data-id="${esc(ev.id)}"` : ev.tipo === 'regua' ? 'data-acao="abrir-regua-do-calendario"' : '';
        return acao
          ? `<button type="button" class="cal__evento cal__evento--${ev.tipo}" ${acao} title="${esc(titulo)}">${texto}</button>`
          : `<span class="cal__evento cal__evento--${ev.tipo}" title="${esc(titulo)}">${texto}</span>`;
      })
      .join('');
    const mais = lista.length > 3 ? `<span class="cal__mais">+${lista.length - 3}</span>` : '';
    celulas.push(
      `<div class="cal__dia${doMes ? '' : ' cal__dia--fora'}${dia === hoje ? ' cal__dia--hoje' : ''}"><span class="cal__numero">${Number(dia.slice(8))}</span>${itens}${mais}</div>`,
    );
  }
  const legenda = ['horario', 'agendado', 'aguardando', 'publicado', 'regua']
    .map((t) => `<span class="cal__legenda-item"><span class="cal__marca cal__evento--${t}"></span>${ROTULO[t]}</span>`)
    .join('');
  return `<section class="config cal">
      <div class="cal__topo">
        <h3 class="config__titulo">Calendário</h3>
        <div class="cal__navegar">
          <button type="button" class="botao botao--texto" data-acao="cal-mes" data-passo="-1" aria-label="Mês anterior">‹</button>
          <span class="cal__mes">${NOMES_DOS_MESES[mes - 1].replace(/^./, (l) => l.toUpperCase())} de ${ano}</span>
          <button type="button" class="botao botao--texto" data-acao="cal-mes" data-passo="1" aria-label="Próximo mês">›</button>
          <button type="button" class="botao botao--texto" data-acao="cal-mes" data-passo="0">Hoje</button>
        </div>
      </div>
      ${previa ? '<p class="programacao__nota">Mostrando a prévia dos horários que você ainda não salvou.</p>' : ''}
      <div class="cal__grade">${DIAS_DO_CALENDARIO.map((d) => `<span class="cal__semana">${d}</span>`).join('')}${celulas.join('')}</div>
      <div class="cal__legenda">${legenda}</div>
    </section>`;
}

function renderProgramacao() {
  const p = ui.programacao;
  const alvo = $('#area-programacao');
  if (!p) {
    pintar(alvo, 'programacao', '<div class="autonomia"><p>Carregando a programação…</p></div>');
    return;
  }
  ui.progRascunho ??= {
    horarios: [...p.horarios],
    gerar_automaticamente: p.gerar_automaticamente,
    antecedencia_horas: p.antecedencia_horas,
    formato_padrao: p.formato_padrao,
    visual_padrao: p.visual_padrao,
    slides_padrao: p.slides_padrao,
  };
  const r = ui.progRascunho;
  const dias = p.dias_da_semana;
  const alterado =
    JSON.stringify(rascunhoDaProgramacao()) !==
    JSON.stringify({
      horarios: p.horarios,
      gerar_automaticamente: p.gerar_automaticamente,
      antecedencia_horas: p.antecedencia_horas,
      formato_padrao: p.formato_padrao,
      visual_padrao: p.visual_padrao,
      slides_padrao: p.slides_padrao,
    });

  const lista = r.horarios.length
    ? `<ul class="horarios">${r.horarios
        .map(
          (h, i) => `<li class="horarios__item"><span><strong>${esc(dias[h.dia])}</strong>, ${esc(h.hora)}</span>
            <button type="button" class="botao botao--texto" data-acao="prog-remover" data-indice="${i}">Remover</button></li>`,
        )
        .join('')}</ul>`
    : '<p class="programacao__vazio">Nenhum horário ainda. Adicione o primeiro abaixo.</p>';

  ui.progNovo ??= { dia: 1, hora: '12:00', tocado: false };
  const novo = `<div class="horarios__novo">
      <label class="campo"><span class="campo__rotulo">Dia</span>
        <select id="prog-dia">${dias.map((d, i) => `<option value="${i}" ${i === ui.progNovo.dia ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      <label class="campo"><span class="campo__rotulo">Horário</span><input type="time" id="prog-hora" value="${esc(ui.progNovo.hora)}" step="300"></label>
      <button type="button" class="botao botao--secundario" data-acao="prog-adicionar">Adicionar horário</button>
    </div>`;

  const automatico = `<div class="programacao__auto">
      <label class="interruptor"><input type="checkbox" id="prog-auto" ${r.gerar_automaticamente ? 'checked' : ''}>
        <span>Gerar as peças sozinho antes de cada horário</span></label>
      <label class="campo"><span class="campo__rotulo">Com quanto tempo de antecedência</span>
        <select id="prog-antecedencia" ${r.gerar_automaticamente ? '' : 'disabled'}>${ANTECEDENCIAS.map(
          ([v, t]) => `<option value="${v}" ${v === r.antecedencia_horas ? 'selected' : ''}>${t}</option>`,
        ).join('')}</select></label>
      <div class="campos-linha campos-linha--tres">
        <label class="campo"><span class="campo__rotulo">Formato</span>
          <select id="prog-formato" ${r.gerar_automaticamente ? '' : 'disabled'}>${(ui.estado?.config?.formatos || Object.entries(FORMATOS).map(([id, nome]) => ({ id, nome })))
            .map((f) => `<option value="${f.id}" ${f.id === r.formato_padrao ? 'selected' : ''}>${esc(f.nome)}</option>`)
            .join('')}</select></label>
        <label class="campo"><span class="campo__rotulo">Imagens</span>
          <select id="prog-slides" ${r.gerar_automaticamente && r.formato_padrao !== 'post' && r.formato_padrao !== 'artigo' ? '' : 'disabled'}>${[3, 4, 5, 6, 7, 8, 9, 10]
            .map((n) => `<option value="${n}" ${n === r.slides_padrao ? 'selected' : ''}>${n}</option>`)
            .join('')}</select></label>
        <label class="campo"><span class="campo__rotulo">Tipo de imagem</span>
          <select id="prog-visual" ${r.gerar_automaticamente ? '' : 'disabled'}>${[
            ['ia', 'Criada por IA'],
            ['foto', 'Foto real'],
            ['banco', 'Banco de imagens'],
            ['design', 'Só design'],
          ]
            .map(([v, t]) => {
              const permitidos = ui.estado?.config?.visuais_permitidos;
              const bloqueado =
                (permitidos?.length && !permitidos.includes(v)) ||
                (v === 'banco' && !ui.estado?.config?.banco_de_imagens) ||
                (v === 'foto' && !ui.estado?.config?.fotos_disponiveis);
              return `<option value="${v}" ${v === r.visual_padrao ? 'selected' : ''} ${bloqueado ? 'disabled' : ''}>${t}</option>`;
            })
            .join('')}</select></label>
      </div>
      <p class="programacao__nota">A peça gerada entra na fila de revisão. Enquanto a categoria estiver em aprovação humana, nada sai sem você aprovar.</p>
    </div>`;

  const previa = alterado && JSON.stringify(r.horarios) !== JSON.stringify(p.horarios);
  const proximos = previa
    ? r.horarios.length
      ? `<p class="programacao__nota">Prévia: estes horários passam a valer quando você clicar em “Salvar programação”.</p><ul class="proximos">${horariosDoRascunho(r.horarios, p.fuso)
          .slice(0, 10)
          .map((h) => {
            const [a, m, d] = h.dia.split('-');
            return `<li class="proximos__item proximos__item--previa"><span class="proximos__quando">${DIAS_DO_CALENDARIO[diaDaSemanaIso(h.dia)]}, ${d}/${m}/${a} às ${esc(h.hora)}</span><span>Ainda não salvo</span></li>`;
          })
          .join('')}</ul>`
      : '<p class="programacao__vazio">Sem horários. Adicione um e salve a programação.</p>'
    : p.proximos.length
    ? `<ul class="proximos">${p.proximos
        .map((h) => `<li class="proximos__item"><span class="proximos__quando">${esc(dataHora(h.para, { diaSemana: true }))}</span><span>${situacaoDoHorario(h)}</span></li>`)
        .join('')}</ul>`
    : '<p class="programacao__vazio">Salve pelo menos um horário para ver a agenda.</p>';

  const avulsas = p.agendadas.filter((a) => !p.proximos.some((h) => h.para === a.para));
  const outros = avulsas.length
    ? `<h3 class="config__titulo programacao__subtitulo">Outros posts agendados</h3><ul class="proximos">${avulsas
        .map(
          (a) => `<li class="proximos__item"><span class="proximos__quando">${esc(dataHora(a.para, { diaSemana: true }))}</span>
            <span><button type="button" class="link" data-acao="abrir-da-programacao" data-id="${esc(a.id)}">${esc(a.titulo || 'ver peça')}</button></span></li>`,
        )
        .join('')}</ul>`
    : '';

  pintar(
    alvo,
    'programacao',
    `<div class="autonomia programacao">
      <h2 class="autonomia__titulo">Programação de posts</h2>
      <div class="autonomia__intro">
        <p>Escolha os dias e horários em que os posts saem. Ao aprovar uma peça, ela entra no próximo horário livre, ou no horário que você escolher.</p>
        <p>Os horários seguem ${p.fuso === 'America/Sao_Paulo' ? 'o horário de Brasília' : `o fuso ${esc(p.fuso)}`}. Para os posts saírem na hora, o servidor precisa estar ligado. Se ele estiver dormindo no horário, o post sai assim que ele acordar.</p>
      </div>
      ${p.indisponivel ? `<p class="programacao__alerta">${esc(p.indisponivel)}</p>` : ''}
      <div class="programacao__grade">
        <section class="config">
          <h3 class="config__titulo">Horários da semana</h3>
          ${lista}
          ${novo}
          ${automatico}
          <div class="programacao__salvar">
            <button type="button" class="botao botao--primario" data-acao="prog-salvar" ${(alterado || ui.progNovo.tocado || !r.horarios.length) && !p.indisponivel ? '' : 'disabled'}>Salvar programação</button>
            <span class="programacao__nota">${alterado ? 'Há alterações não salvas.' : ui.progNovo.tocado ? 'Clique em “Adicionar horário” ou salve para incluir o horário escolhido.' : p.atualizado_em ? `Salva por ${esc(ator(`humano:${p.atualizado_por || 'equipe'}`))} em ${esc(dataHora(p.atualizado_em))}.` : ''}</span>
          </div>
        </section>
        <section class="config">
          <h3 class="config__titulo">Próximos horários</h3>
          ${proximos}
          ${outros}
        </section>
      </div>
      ${calendarioHtml(p, previa)}
    </div>`,
  );
}

/** Data e hora no fuso do sistema, no formato do campo datetime-local (AAAA-MM-DDTHH:MM). */
function paraCampoDeData(iso) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

/** Pergunta quando publicar: no próximo horário da programação, agora ou numa data escolhida. */
function escolherQuando({ titulo, texto, botao, sugestao }) {
  const dialogo = $('#dlg-quando');
  $('#dlg-quando-titulo').textContent = titulo;
  $('#dlg-quando-texto').textContent = texto;
  $('#dlg-quando-botao').textContent = botao;
  const opcaoProximo = $('#quando-opcao-proximo');
  const radioProximo = opcaoProximo.querySelector('input');
  radioProximo.disabled = !sugestao;
  opcaoProximo.classList.toggle('quando__opcao--inativa', !sugestao);
  $('#quando-proximo').textContent = sugestao
    ? dataHora(sugestao, { diaSemana: true })
    : 'Sem horários cadastrados. Crie na aba Programação.';
  // Sem sugestão, propõe daqui a uma hora, arredondado para os próximos 5 minutos (o campo anda de 5 em 5).
  const daquiAUmaHora = Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000;
  $('#quando-data').value = paraCampoDeData(sugestao || new Date(daquiAUmaHora).toISOString());
  const escolha = sugestao ? 'proximo' : 'agora';
  for (const radio of $$('#form-quando input[name="quando"]')) radio.checked = radio.value === escolha;
  dialogo.returnValue = '';
  dialogo.showModal();
  return new Promise((resolver) => {
    dialogo.addEventListener(
      'close',
      () => {
        if (dialogo.returnValue !== 'confirmar') return resolver({ ok: false });
        const valor = $('#form-quando input[name="quando"]:checked')?.value || 'agora';
        if (valor !== 'data') return resolver({ ok: true, quando: valor });
        const data = $('#quando-data').value;
        if (!data) {
          avisar('Escolha a data e a hora.', 'erro');
          return resolver({ ok: false });
        }
        resolver({ ok: true, quando: data }); // o servidor interpreta no fuso do sistema
      },
      { once: true },
    );
  });
}

$('#quando-data').addEventListener('focus', () => {
  const radio = $('#form-quando input[value="data"]');
  radio.checked = true;
});

function trocarAba(aba) {
  ui.aba = aba;
  ui.gaveta = false;
  aplicarGaveta();
  for (const b of $$('.aba')) {
    b.setAttribute('aria-selected', String(b.dataset.aba === aba));
    b.tabIndex = b.dataset.aba === aba ? 0 : -1;
  }
  $('#area-pecas').hidden = aba === 'autonomia' || aba === 'programacao' || aba === 'regua' || aba === 'banco' || aba === 'geo';
  $('#area-geo').hidden = aba !== 'geo';
  $('#area-autonomia').hidden = aba !== 'autonomia';
  $('#area-programacao').hidden = aba !== 'programacao';
  $('#area-regua').hidden = aba !== 'regua';
  $('#area-banco').hidden = aba !== 'banco';
  if (aba === 'autonomia') renderAutonomia();
  else if (aba === 'banco') carregarBanco().catch((erro) => avisar(erro.message, 'erro'));
  else if (aba === 'geo') carregarGeo().catch((erro) => avisar(erro.message, 'erro'));
  else if (aba === 'programacao') carregarProgramacao().catch((erro) => avisar(erro.message, 'erro'));
  else if (aba === 'regua') carregarRegua().catch((erro) => avisar(erro.message, 'erro'));
  else carregarLista().catch((erro) => avisar(erro.message, 'erro'));
}

/* ---------------------------------------------------------- banco de imagens */

async function carregarBanco() {
  if (!ui.banco) pintar($('#area-banco'), 'banco', '<div class="autonomia"><p>Carregando o banco de imagens…</p></div>');
  ui.banco = await api('/api/banco');
  renderBanco();
}

function renderBanco() {
  const fotos = ui.banco || [];
  const semDescricao = fotos.filter((f) => !f.descricao).length;
  const pelaIa = fotos.filter((f) => f.descrita_pela_ia).length;
  const grade = fotos.length
    ? `<ul class="banco__grade">${fotos
        .map(
          (f) => `<li class="banco__item">
            <img src="${esc(f.url)}" alt="${esc(f.descricao || f.arquivo)}" loading="lazy">
            <span class="banco__nome">${esc(f.arquivo.replace(/^banco-imagens\//, ''))}</span>
            <span class="banco__descricao">${f.descricao ? esc(f.descricao) : 'Ainda sem descrição.'}</span>
            ${f.tags.length ? `<span class="banco__temas">${f.tags.map(esc).join(' · ')}</span>` : ''}
            ${f.descrita_pela_ia ? '<span class="banco__credito">Descrita pela IA</span>' : ''}
            ${f.credito ? `<span class="banco__credito">Crédito: ${esc(f.credito)}</span>` : ''}
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="programacao__vazio">O banco ainda não tem fotos. Siga os passos ao lado para colocar as primeiras.</p>';
  const acoes = fotos.length
    ? `<div class="banco__acoes">
        ${semDescricao ? `<button type="button" class="botao botao--primario" data-acao="banco-descrever">Descrever as fotos com IA (${semDescricao} sem descrição)</button>` : '<span class="programacao__nota">Todas as fotos têm descrição.</span>'}
        ${pelaIa ? `<a class="botao botao--secundario" href="/api/banco/catalogo" download="banco-imagens.json">Baixar catálogo (banco-imagens.json)</a>` : ''}
      </div>
      ${pelaIa ? `<p class="programacao__nota">${pelaIa} ${pelaIa === 1 ? 'foto foi descrita' : 'fotos foram descritas'} pela IA. Para não precisar descrever de novo quando o servidor reiniciar, baixe o catálogo e suba esse arquivo no GitHub (passo 7).</p>` : ''}`
    : '';
  pintar(
    $('#area-banco'),
    'banco',
    `<div class="autonomia banco">
      <h2 class="autonomia__titulo">Banco de imagens da marca</h2>
      <div class="autonomia__intro">
        <p>Fotos já autorizadas para uso. Ao gerar uma peça com “Foto do banco de imagens”, a IA olha as fotos e escolhe a que mais combina com o post. Se nenhuma combinar, a peça sai só com o design da marca. Pedir “Novo visual” troca por outra foto do banco.</p>
      </div>
      <div class="programacao__grade">
        <section class="config">
          <h3 class="config__titulo">${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'} no banco</h3>
          ${acoes}
          ${grade}
        </section>
        <section class="config">
          <h3 class="config__titulo">Como colocar fotos no banco</h3>
          <ol class="banco__passos">
            <li>No seu computador, crie uma pasta chamada <strong>banco-imagens</strong> e coloque nela as fotos autorizadas. Não precisa renomear nem descrever.</li>
            <li>No GitHub, abra o projeto, clique em “Add file” e depois em “Upload files”.</li>
            <li>Arraste a pasta <strong>banco-imagens</strong> inteira para a página. Cabem até 100 fotos por vez; se tiver mais, repita em partes.</li>
            <li>Clique em “Commit changes” e espere uns 5 minutos.</li>
            <li>Volte aqui, atualize a página e clique em “Descrever as fotos com IA”. Ela olha cada foto e escreve a descrição e os temas.</li>
            <li>Quando terminar, clique em “Baixar catálogo”.</li>
            <li>No GitHub, suba o arquivo <strong>banco-imagens.json</strong> que baixou (“Add file”, “Upload files”, “Commit changes”). Ele substitui o que já existe.</li>
          </ol>
          <p class="programacao__nota">Se quiser corrigir uma descrição ou colocar o crédito de uma foto, abra o banco-imagens.json no GitHub e edite.</p>
        </section>
      </div>
    </div>`,
  );
}

/* ------------------------------------------------------- visibilidade em IA */

const geoDif = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : Math.round((a - b) * 10) / 10);

function geoComparar(atual, anterior) {
  if (!atual || !anterior) return null;
  const perguntas = new Map(anterior.por_pergunta.map((p) => [p.pergunta.trim().toLowerCase(), p]));
  const motores = new Map(anterior.por_motor.map((m) => [m.id, m]));
  return {
    score: geoDif(atual.score, anterior.score),
    taxa_mencao: geoDif(atual.taxa_mencao, anterior.taxa_mencao),
    taxa_citacao: geoDif(atual.taxa_citacao, anterior.taxa_citacao),
    presenca: geoDif(atual.presenca, anterior.presenca),
    por_pergunta: atual.por_pergunta.map((p) => geoDif(p.score, perguntas.get(p.pergunta.trim().toLowerCase())?.score)),
    por_motor: atual.por_motor.map((m) => geoDif(m.score, motores.get(m.id)?.score)),
  };
}

/** Seta de variação: verde quando sobe, vermelha quando desce. */
function geoSeta(d, sufixo = '') {
  if (d === null || d === undefined) return '<span class="geo__var geo__var--nula">sem comparação</span>';
  if (Math.abs(d) < 0.05) return `<span class="geo__var">= 0${sufixo}</span>`;
  const sobe = d > 0;
  return `<span class="geo__var ${sobe ? 'geo__var--sobe' : 'geo__var--desce'}">${sobe ? '▲' : '▼'} ${sobe ? '+' : ''}${String(d).replace('.', ',')}${sufixo}</span>`;
}
const geoNum = (x, sufixo = '') => (x === null || x === undefined ? '—' : `${String(x).replace('.', ',')}${sufixo}`);

async function carregarGeo() {
  if (!ui.geo) pintar($('#area-geo'), 'geo', '<div class="autonomia"><p>Carregando o radar de visibilidade…</p></div>');
  const dados = await api('/api/geo');
  ui.geo = { ...(ui.geo || {}), dados };
  const ids = dados.rodadas.map((r) => r.id);
  if (!ids.includes(ui.geo.atualId)) ui.geo.atualId = ids[0] || null;
  if (!ids.includes(ui.geo.comparaId) || ui.geo.comparaId === ui.geo.atualId) ui.geo.comparaId = ids[ids.indexOf(ui.geo.atualId) + 1] || null;
  renderGeo();
  const id = ui.geo.atualId;
  if (id && (!ui.geo.detalhes?.[id] || ui.geo.recarregarDetalhe)) {
    ui.geo.recarregarDetalhe = false;
    const rodada = await api(`/api/geo/rodadas/${encodeURIComponent(id)}`);
    ui.geo.detalhes = { ...(ui.geo.detalhes || {}), [id]: rodada };
    renderGeo();
  }
  clearTimeout(ui.geoEspera);
  if (dados.situacao.rodando && ui.aba === 'geo') {
    ui.geo.recarregarDetalhe = true;
    ui.geoEspera = setTimeout(() => carregarGeo().catch(() => {}), 3000);
  }
}

const CANAIS_GEO = {
  site: 'Site da marca',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  imprensa: 'Imprensa',
  parceiros: 'Parceiros e marketplaces',
  avaliacoes: 'Avaliações e diretórios',
  analistas: 'Analistas de mercado',
  eventos: 'Eventos e palestras',
  tecnico: 'Ajuste técnico do site',
};

/** Fragilidades (sinais dos números e diagnóstico da IA) e o plano de ação por canal. */
function geoDiagnosticoHtml(atual, detalhe, rodando) {
  const sinais = atual.resumo.sinais || [];
  const listaSinais = sinais.length
    ? `<ul class="geo__sinais">${sinais
        .map((x) => `<li><strong>${esc(x.titulo)}</strong>${x.detalhe?.length ? `<span class="geo__meta">${x.detalhe.map(esc).join(' · ')}</span>` : ''}</li>`)
        .join('')}</ul>`
    : '<p class="geo__meta">Nenhum sinal de fragilidade nos números desta rodada.</p>';
  const d = detalhe?.diagnostico;
  let corpo;
  if (!detalhe) corpo = '<p class="geo__meta">Carregando o diagnóstico…</p>';
  else if (!d) {
    corpo = `${detalhe.diagnostico_erro ? `<p class="geo__progresso geo__progresso--erro">O diagnóstico falhou: ${esc(detalhe.diagnostico_erro)}</p>` : ''}
      <div class="geo__acoes"><button type="button" class="botao botao--primario" data-acao="geo-diagnosticar" ${rodando ? 'disabled' : ''}>Gerar diagnóstico e plano</button></div>`;
  } else {
    const fragilidades = d.fragilidades
      .map((f) => `<li class="geo__fragilidade"><span class="geo__chip geo__chip--${esc(f.impacto)}">Impacto ${esc(f.impacto === 'medio' ? 'médio' : f.impacto)}</span><strong>${esc(f.titulo)}</strong><span class="geo__meta">${esc(f.evidencia)}</span></li>`)
      .join('');
    const porCanal = Object.entries(CANAIS_GEO)
      .map(([canal, nome]) => {
        const acoes = d.acoes.filter((a) => a.canal === canal);
        if (!acoes.length) return '';
        return `<div class="geo__canal"><h4 class="geo__subtitulo">${esc(nome)}</h4>${acoes
          .map(
            (a) => `<div class="geo__acao">
              <div class="geo__acao-topo"><strong>${esc(a.titulo)}</strong>
                <span class="geo__chip geo__chip--${esc(a.prioridade)}">Prioridade ${esc(a.prioridade === 'media' ? 'média' : a.prioridade)}</span>
                <span class="geo__chip">Esforço ${esc(a.esforco === 'medio' ? 'médio' : a.esforco)}</span>
                <span class="geo__chip">${esc(a.prazo)}</span></div>
              <p>${esc(a.o_que_fazer)}</p>
              <p class="geo__meta">Por quê: ${esc(a.por_que)}</p>
              ${a.o_motor_faz && a.orientacao_para_o_motor ? `<button type="button" class="botao botao--secundario" data-acao="geo-gerar-no-motor" data-orientacao="${esc(a.orientacao_para_o_motor)}" data-formato="${esc(a.formato === 'nenhum' ? 'post' : a.formato)}">Gerar no Motor</button>` : ''}
            </div>`,
          )
          .join('')}</div>`;
      })
      .join('');
    corpo = `<p class="geo__explica">${esc(d.resumo)}</p>
      <h4 class="geo__subtitulo">Fragilidades</h4><ul class="geo__fragilidades">${fragilidades}</ul>
      <h4 class="geo__subtitulo">Vitórias rápidas, para as próximas duas semanas</h4><ul class="geo__rapidas">${d.vitorias_rapidas.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>
      <h4 class="geo__subtitulo">Plano de ação por canal</h4>${porCanal}
      <h4 class="geo__subtitulo">Como medir</h4><p class="geo__explica">${esc(d.como_medir)}</p>
      <div class="geo__acoes">
        <a class="botao botao--secundario" href="/api/geo/rodadas/${encodeURIComponent(atual.id)}/plano" download>Baixar plano</a>
        <button type="button" class="botao botao--texto" data-acao="geo-diagnosticar" ${rodando ? 'disabled' : ''}>Gerar de novo</button>
      </div>
      <p class="geo__meta">Diagnóstico gerado em ${esc(dataHora(d.gerado_em))}. As ações dependem dos dados desta rodada; confira antes de executar.</p>`;
  }
  return `<section class="config geo__diagnostico"><h3 class="config__titulo">Fragilidades e plano de ação</h3>
      <h4 class="geo__subtitulo">Sinais nos números</h4>${listaSinais}${corpo}</section>`;
}

function renderGeo() {
  const { dados, atualId, comparaId, aberta } = ui.geo;
  const { config, motores, situacao, rodadas } = dados;
  const atual = rodadas.find((r) => r.id === atualId);
  const compara = rodadas.find((r) => r.id === comparaId);
  const d = atual && compara ? geoComparar(atual.resumo, compara.resumo) : null;
  const ligados = motores.filter((m) => m.ligado);
  const opcoes = (selecionada, excluir) =>
    rodadas
      .filter((r) => r.id !== excluir)
      .map((r) => `<option value="${esc(r.id)}" ${r.id === selecionada ? 'selected' : ''}>${esc(dataHora(r.criada_em))} · score ${geoNum(r.resumo?.score)}</option>`)
      .join('');
  const rodando = situacao.rodando
    ? `<p class="geo__progresso">${situacao.etapa === 'diagnostico' ? 'Respostas prontas. Gerando o diagnóstico e o plano de ação…' : `Rodando: ${situacao.feitas} de ${situacao.total || '…'} respostas. Pode sair desta aba; a rodada continua.`}</p>`
    : situacao.erro
      ? `<p class="geo__progresso geo__progresso--erro">A última rodada falhou: ${esc(situacao.erro)}</p>`
      : '';
  const botaoRodar = `<button type="button" class="botao botao--primario" data-acao="geo-rodar" ${situacao.rodando || !ligados.length || !config.perguntas.length ? 'disabled' : ''}>${situacao.rodando ? 'Rodando…' : 'Rodar agora'}</button>`;

  let painel;
  if (!atual) {
    painel = `<section class="config geo__vazio">
        <h3 class="config__titulo">Nenhuma rodada ainda</h3>
        <p>Cada rodada faz as ${config.perguntas.length} perguntas da configuração ${config.repeticoes} ${config.repeticoes === 1 ? 'vez' : 'vezes'} em cada IA conectada (${ligados.map((m) => esc(m.nome)).join(' e ') || 'nenhuma'}). Leva alguns minutos.</p>
        <div class="geo__acoes">${botaoRodar}</div>${rodando}
      </section>`;
  } else {
    const r = atual.resumo;
    const motoresDaRodada = atual.motores.map((m) => m.nome).join(' e ');
    const detalhe = ui.geo.detalhes?.[atual.id];
    const linhas = r.por_pergunta
      .map((p, i) => {
        const aberto = aberta === i;
        const respostas = aberto && detalhe ? detalhe.respostas.filter((x) => x.pergunta === i) : [];
        const lista = aberto
          ? detalhe
            ? `<div class="geo__respostas">${respostas
                .map((x) => {
                  const nome = atual.motores.find((m) => m.id === x.motor)?.nome || x.motor;
                  if (x.erro) return `<div class="geo__resposta"><strong>${esc(nome)}</strong><span class="geo__chip geo__chip--erro">Erro</span><p>${esc(x.erro)}</p></div>`;
                  const a = x.analise;
                  return `<div class="geo__resposta">
                    <div class="geo__resposta-topo"><strong>${esc(nome)}</strong>
                      <span class="geo__chip ${a.mencionada ? 'geo__chip--ok' : ''}">${a.mencionada ? `Mencionada em ${a.posicao}º` : 'Não mencionada'}</span>
                      <span class="geo__chip ${a.citada ? 'geo__chip--ok' : ''}">${a.citada ? 'Site da marca citado' : 'Sem site da marca'}</span>
                      <span class="geo__pontos">${a.pontos} pontos</span></div>
                    <p class="geo__trecho">${esc(x.texto.slice(0, 700))}${x.texto.length > 700 ? '…' : ''}</p>
                    ${a.concorrentes.length ? `<p class="geo__meta">Concorrentes na resposta: ${a.concorrentes.map(esc).join(', ')}</p>` : ''}
                    ${a.dominios.length ? `<p class="geo__meta">Fontes: ${a.dominios.slice(0, 8).map(esc).join(', ')}</p>` : ''}
                  </div>`;
                })
                .join('')}</div>`
            : '<p class="geo__meta">Carregando as respostas…</p>'
          : '';
        return `<li class="geo__pergunta">
            <div class="geo__pergunta-linha">
              <span class="geo__pergunta-texto">${esc(p.pergunta)}</span>
              <span class="geo__barra" title="Score ${geoNum(p.score)}"><span style="width:${p.score || 0}%"></span></span>
              <span class="geo__nota">${geoNum(p.score)}</span>
              ${d ? geoSeta(d.por_pergunta[i]) : ''}
              <span class="geo__meta">${p.mencoes} de ${p.respostas} com menção</span>
              <button type="button" class="botao botao--texto" data-acao="geo-abrir" data-indice="${i}">${aberto ? 'Fechar' : 'Ver respostas'}</button>
            </div>${lista}
          </li>`;
      })
      .join('');
    const porMotor = r.por_motor
      .map(
        (m, i) => `<div class="geo__motor"><span class="geo__motor-nome">${esc(m.nome)}</span><span class="geo__motor-nota">${geoNum(m.score)}</span>${d ? geoSeta(d.por_motor[i]) : ''}
          <span class="geo__meta">Menção ${geoNum(m.taxa_mencao, '%')} · Citação ${geoNum(m.taxa_citacao, '%')}${m.erros ? ` · ${m.erros} com erro` : ''}</span></div>`,
      )
      .join('');
    const topo = (itens, vazio) =>
      itens.length ? `<ol class="geo__top">${itens.map((x) => `<li><span>${esc(x.nome)}</span><span class="geo__meta">${x.vezes}×</span></li>`).join('')}</ol>` : `<p class="geo__meta">${vazio}</p>`;
    const evolucao = rodadas
      .slice(0, 12)
      .slice()
      .reverse()
      .map((x) => `<div class="geo__evo" title="${esc(dataHora(x.criada_em))}"><span class="geo__evo-barra"><span style="height:${x.resumo?.score || 0}%"></span></span><span class="geo__evo-nota">${geoNum(x.resumo?.score)}</span><span class="geo__evo-data">${esc(dataHora(x.criada_em).slice(0, 5))}</span></div>`)
      .join('');
    painel = `<section class="config geo__placar">
        <div class="geo__score">
          <span class="geo__rotulo">Score de visibilidade</span>
          <span class="geo__numero">${geoNum(r.score)}</span>
          ${geoSeta(d?.score)}
        </div>
        <div class="geo__metricas">
          <div><span class="geo__rotulo">Menção</span><strong>${geoNum(r.taxa_mencao, '%')}</strong>${geoSeta(d?.taxa_mencao, ' p.p.')}<span class="geo__meta">das respostas citam a marca</span></div>
          <div><span class="geo__rotulo">Citação</span><strong>${geoNum(r.taxa_citacao, '%')}</strong>${geoSeta(d?.taxa_citacao, ' p.p.')}<span class="geo__meta">usam um site da marca como fonte</span></div>
          <div><span class="geo__rotulo">Presença</span><strong>${geoNum(r.presenca, '%')}</strong>${geoSeta(d?.presenca, ' p.p.')}<span class="geo__meta">das menções, contando os concorrentes</span></div>
        </div>
        <div class="geo__controles">
          <label class="campo"><span class="campo__rotulo">Rodada</span><select id="geo-atual">${opcoes(atualId)}</select></label>
          <label class="campo"><span class="campo__rotulo">Comparar com</span><select id="geo-compara"><option value="">Sem comparação</option>${opcoes(comparaId, atualId)}</select></label>
          <div class="geo__acoes">${botaoRodar}</div>
        </div>
        <p class="geo__meta">Rodada de ${esc(dataHora(atual.criada_em))} por ${esc(atual.por || 'equipe')} · ${esc(motoresDaRodada)} · ${r.respostas_validas} respostas${r.respostas_com_erro ? `, ${r.respostas_com_erro} com erro` : ''}${compara ? ` · comparando com ${esc(dataHora(compara.criada_em))}` : ''}</p>
        ${rodando}
      </section>
      <section class="config"><h3 class="config__titulo">Por IA</h3><div class="geo__motores">${porMotor}</div></section>
      <section class="config"><h3 class="config__titulo">Por pergunta</h3><ul class="geo__perguntas">${linhas}</ul></section>
      <div class="programacao__grade">
        <section class="config"><h3 class="config__titulo">Concorrentes que mais aparecem</h3>${topo(r.concorrentes_top, 'Nenhum concorrente da lista apareceu.')}</section>
        <section class="config"><h3 class="config__titulo">Fontes que as IAs mais usaram</h3>${topo(r.fontes_top, 'As respostas não trouxeram fontes.')}</section>
      </div>
      ${geoDiagnosticoHtml(atual, detalhe, situacao.rodando)}
      <section class="config"><h3 class="config__titulo">Evolução do score</h3><div class="geo__evolucao">${evolucao}</div></section>`;
  }

  const situacaoIas = motores
    .map((m) => `<li><span class="geo__chip ${m.ligado ? 'geo__chip--ok' : ''}">${m.ligado ? 'Conectada' : 'Sem chave'}</span> ${esc(m.nome)}${m.ligado ? '' : ` <span class="geo__meta">(falta ${esc(m.chave)} no Render)</span>`}</li>`)
    .join('');
  pintar(
    $('#area-geo'),
    'geo',
    `<div class="autonomia geo">
      <h2 class="autonomia__titulo">Visibilidade em IA <span class="geo__teste">teste</span></h2>
      <div class="autonomia__intro">
        <p>O radar faz às IAs as perguntas que os clientes fariam e mede se a marca aparece, em que posição frente aos concorrentes e se um site da marca é citado como fonte. O score vai de 0 a 100 e serve para comparar uma rodada com outra.</p>
      </div>
      ${painel}
      <section class="config">
        <h3 class="config__titulo">Como o score é calculado</h3>
        <p class="geo__explica">Cada resposta vale até 100 pontos: 50 se a marca é mencionada, mais 20 se ela aparece antes dos concorrentes (10 se em segundo, 5 depois), mais 30 se a IA usa um site da marca como fonte. O score de cada pergunta é a média das suas respostas, e o da rodada é a média das perguntas. As IAs não respondem sempre igual: variações de até 5 pontos entre rodadas podem ser só oscilação.</p>
      </section>
      <section class="config">
        <h3 class="config__titulo">Configuração</h3>
        <div class="geo__config">
          <label class="campo geo__config-largo"><span class="campo__rotulo">Perguntas, uma por linha (as que um cliente faria, sem citar a marca)</span><textarea id="geo-perguntas" rows="8">${esc(config.perguntas.join('\n'))}</textarea></label>
          <label class="campo"><span class="campo__rotulo">Nomes da marca, um por linha</span><textarea id="geo-nomes" rows="3">${esc(config.nomes_da_marca.join('\n'))}</textarea></label>
          <label class="campo"><span class="campo__rotulo">Sites da marca, um por linha</span><textarea id="geo-dominios" rows="3">${esc(config.dominios.join('\n'))}</textarea></label>
          <label class="campo geo__config-largo"><span class="campo__rotulo">Concorrentes, um por linha</span><textarea id="geo-concorrentes" rows="4">${esc(config.concorrentes.join('\n'))}</textarea></label>
          <label class="campo"><span class="campo__rotulo">Vezes que cada pergunta é feita em cada IA</span><select id="geo-repeticoes">${[1, 2, 3].map((n) => `<option value="${n}" ${n === config.repeticoes ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="interruptor"><input type="checkbox" id="geo-semanal" ${config.semanal ? 'checked' : ''}><span>Rodar sozinho uma vez por semana</span></label>
        </div>
        <div class="geo__acoes"><button type="button" class="botao botao--primario" data-acao="geo-salvar">Salvar configuração</button></div>
        <h4 class="geo__subtitulo">IAs consultadas</h4>
        <ul class="geo__ias">${situacaoIas}</ul>
      </section>
      <section class="config">
        <h3 class="config__titulo">Guardar o histórico</h3>
        <p class="geo__explica">O servidor pode perder as rodadas quando o site é atualizado. Baixe o histórico de vez em quando e, se ele sumir, restaure aqui.</p>
        <div class="geo__acoes">
          <a class="botao botao--secundario" href="/api/geo/exportar" download>Baixar histórico</a>
          <label class="botao botao--secundario geo__importar">Restaurar histórico<input type="file" id="geo-importar" accept="application/json,.json" hidden></label>
        </div>
      </section>
    </div>`,
  );
}

/* -------------------------------------------------------------------- régua */

const ETAPAS_DO_FUNIL = { atrair: 'Atrair atenção', engajar: 'Gerar conversa', converter: 'Convidar para conversa' };
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
let atualizacaoDaRegua = null;

function diaDaRegua(iso) {
  if (!iso) return { dia: 'A definir', semana: '' };
  const [a, m, d] = iso.split('-').map(Number);
  return { dia: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`, semana: DIAS_CURTOS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()] };
}

async function carregarRegua() {
  ui.reguas = await api('/api/reguas');
  if (!ui.reguas.some((r) => r.id === ui.reguaAtual)) ui.reguaAtual = ui.reguas[0]?.id || null;
  ui.regua = ui.reguaAtual ? await api(`/api/reguas/${ui.reguaAtual}`) : null;
  renderRegua();
  // Enquanto algum post da régua está sendo gerado, a tela se atualiza sozinha.
  clearTimeout(atualizacaoDaRegua);
  if (ui.aba === 'regua' && ui.regua?.itens?.some((i) => i.peca?.status === 'gerando')) {
    atualizacaoDaRegua = setTimeout(() => carregarRegua().catch(() => {}), 8000);
  }
}

function seloDoPostDaRegua(item) {
  if (item.peca) {
    const s = seloDoItem(item.peca);
    return `<span class="selo selo--${s.classe}">${esc(s.texto)}</span>`;
  }
  if (item.ja_produzido) return '<span class="selo selo--publicavel">Já produzido</span>';
  return '<span class="selo selo--neutro">Planejado</span>';
}

function itemDaRegua(item, i) {
  const categorias = ui.estado?.categorias || [];
  const publicos = ui.estado?.segmentos || [];
  const nomeCategoria = categorias.find((c) => c.id === item.categoria)?.nome || item.categoria;
  const nomePublico = publicos.find((s) => s.id === item.segmento)?.nome || item.segmento;
  const d = diaDaRegua(item.data);
  const acaoPrincipal = item.peca
    ? `<button type="button" class="botao botao--secundario" data-acao="regua-abrir-peca" data-peca="${esc(item.peca.id)}">Abrir post</button>`
    : item.ja_produzido
      ? ''
      : `<button type="button" class="botao botao--primario" data-acao="regua-gerar" data-item="${esc(item.id)}">Gerar post</button>`;
  const marcar = item.peca
    ? ''
    : `<button type="button" class="botao botao--texto" data-acao="regua-produzido" data-item="${esc(item.id)}">${item.ja_produzido ? 'Desmarcar já produzido' : 'Marcar como já produzido'}</button>`;
  return `<li class="regua__item">
    <div class="regua__data">
      <span class="regua__numero">${String(i + 1).padStart(2, '0')}</span>
      <b>${d.dia}</b><span>${d.semana}</span>
      <label class="regua__mudar-data">Mudar data<input type="date" value="${esc(item.data || '')}" data-regua-data="${esc(item.id)}"></label>
    </div>
    <div class="regua__conteudo">
      <div class="regua__chips">
        ${seloDoPostDaRegua(item)}
        <span class="etiqueta">${esc(nomeCategoria)}</span>
        <span class="etiqueta">${esc(FORMATOS[item.formato] || item.formato)}</span>
        <span class="etiqueta">${esc(ETAPAS_DO_FUNIL[item.etapa_funil] || item.etapa_funil)}</span>
        <span class="etiqueta">${esc(nomePublico)}</span>
      </div>
      <h3 class="regua__titulo">${esc(item.titulo)}</h3>
      <p class="regua__gancho">“${esc(item.gancho)}”</p>
      <p class="regua__mensagem">${esc(item.mensagem)}</p>
      ${
        item.provas?.length
          ? `<details class="regua__provas"><summary>Provas da base (${item.provas.length})</summary><ul>${item.provas.map((pv) => `<li>${esc(pv)}</li>`).join('')}</ul></details>`
          : ''
      }
      <p class="regua__cta"><b>Chamada final:</b> ${esc(item.cta)}</p>
      ${item.observacoes ? `<p class="regua__obs"><b>Para a aprovação:</b> ${esc(item.observacoes)}</p>` : ''}
    </div>
    <div class="regua__acoes-item">${acaoPrincipal}${marcar}</div>
  </li>`;
}

function renderRegua() {
  const area = $('#area-regua');
  const r = ui.regua;
  if (!r) {
    area.innerHTML = `<div class="regua">
      <section class="fila-resumo">
        <p class="fila-resumo__rotulo">Régua de comunicação</p>
        <h2 class="regua__nome">Nenhuma régua ainda</h2>
        <p class="fila-resumo__texto">O motor monta a série de posts com calendário, a partir da base de conhecimento. Depois você baixa em PDF para aprovação e gera cada post com um clique.</p>
        <div class="regua__botoes">
          <button type="button" class="botao botao--primario" data-acao="regua-sugerida">Carregar a régua sugerida</button>
          <button type="button" class="botao botao--secundario" data-acao="nova-regua">Montar régua com IA</button>
        </div>
      </section>
    </div>`;
    return;
  }
  const datas = r.itens.map((i) => i.data).filter(Boolean).sort();
  const periodo = datas.length ? `${diaDaRegua(datas[0]).dia} a ${diaDaRegua(datas.at(-1)).dia}` : 'datas a definir';
  const pulados = r.cadencia?.feriados_pulados || [];
  const outras =
    ui.reguas.length > 1
      ? `<label class="regua__escolher">Régua<select data-regua-escolher>${ui.reguas
          .map((x) => `<option value="${esc(x.id)}" ${x.id === r.id ? 'selected' : ''}>${esc(x.nome)}</option>`)
          .join('')}</select></label>`
      : '';
  area.innerHTML = `<div class="regua">
    <section class="fila-resumo regua__topo">
      <p class="fila-resumo__rotulo">Régua de comunicação</p>
      <h2 class="regua__nome">${esc(r.nome)}</h2>
      <p class="fila-resumo__texto">${r.itens.length} posts · ${periodo}${r.cadencia?.texto ? ` · ${esc(r.cadencia.texto)}` : ''}</p>
      <div class="regua__botoes">
        <a class="botao botao--primario" href="/api/reguas/${esc(r.id)}/pdf" download>Baixar PDF para aprovação</a>
        <button type="button" class="botao botao--secundario" data-acao="nova-regua">Montar outra régua</button>
        <button type="button" class="botao botao--texto" data-acao="regua-excluir">Excluir esta régua</button>
        ${outras}
      </div>
    </section>
    <section class="bloco regua__resumo">
      ${fatos([
        ['Objetivo', r.objetivo],
        ['Narrativa', r.narrativa],
        pulados.length ? ['Feriados pulados', pulados.map((p) => `${diaDaRegua(p.data).dia} (${p.motivo})`).join(', ')] : null,
      ])}
    </section>
    <ol class="regua__linha">${r.itens.map(itemDaRegua).join('')}</ol>
  </div>`;
}

function abrirMontarRegua() {
  const dlg = $('#dlg-regua');
  const publicos = ui.estado?.segmentos || [];
  $('#regua-publico').innerHTML = `<option value="">Variado</option>${publicos.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('')}`;
  // Sugere começar na próxima terça.
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() !== 2);
  $('#regua-inicio').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  dlg.showModal();
}

const acoesPorNome = {
  abrir: (alvo) => {
    ui.gaveta = false;
    aplicarGaveta();
    return selecionar(alvo.dataset.id);
  },

  'abrir-fila': () => {
    ui.gaveta = !ui.gaveta;
    aplicarGaveta();
    if (ui.gaveta) $('.gaveta__fechar')?.focus({ preventScroll: true });
  },

  'fechar-fila': () => {
    ui.gaveta = false;
    aplicarGaveta();
  },

  voltar: () => {
    ui.selecionada = null;
    ui.detalhe = null;
    history.replaceState(null, '', location.pathname);
    renderLista();
    renderDetalhe();
    $('#detalhe').scrollTop = 0;
    if (telaEstreita()) $('#principal').scrollIntoView({ block: 'start' });
  },

  'abrir-gerar': () => abrirGerar(),

  'ver-todas': () => trocarAba('todas'),

  'ver-arte': () => {
    ui.verFundo = false;
    renderDetalhe();
  },

  'ver-fundo': () => {
    ui.verFundo = true;
    renderDetalhe();
  },

  aprovar: async (alvo) => {
    if (!exigirNome()) return;
    const real = ui.estado?.config?.publicacao_modo === 'real';
    const r = await escolherQuando({
      titulo: 'Aprovar e publicar quando?',
      texto: real
        ? 'A peça sai no Instagram no momento escolhido. Seu nome fica na trilha de auditoria.'
        : canalManual()
          ? `A peça fica marcada como pronta para o executivo publicar no ${canalManual().nome}, no momento escolhido.`
          : 'Em simulação, nada é enviado ao Instagram: o sistema só registra o que publicaria.',
      botao: 'Aprovar',
      sugestao: ui.detalhe?.sugestao_agendamento,
    });
    if (!r.ok) return;
    await executar(alvo, r.quando === 'agora' ? 'Publicando…' : 'Agendando…', async () => {
      const p = await acao(`/api/pecas/${ui.selecionada}/aprovar`, { quando: r.quando });
      ui.programacao = null;
      if (p.status === 'agendada') {
        avisar(`Aprovada e agendada para ${dataHora(p.agendamento?.para, { diaSemana: true })}.`, 'sucesso');
      } else if (p.status === 'publicada') {
        avisar(p.publicacao?.modo === 'real' ? 'Aprovada e publicada no Instagram.' : 'Aprovada. Publicação simulada registrada na auditoria.', 'sucesso');
      } else {
        avisar(`Aprovada. A publicação ficou pendente: ${p.publicacao?.motivo || 'aguardando'}.`);
      }
    });
  },

  reprovar: async (alvo) => {
    if (!exigirNome()) return;
    const r = await confirmar({
      titulo: 'Reprovar esta peça?',
      texto: 'Ela não será publicada. A reprovação entra na métrica de concordância da categoria.',
      campo: { rotulo: 'Motivo (fica na auditoria e ajuda a calibrar as travas)', placeholder: 'Ex.: a cena não conversa com o público escolhido' },
      botao: 'Reprovar peça',
      perigo: true,
    });
    if (!r.ok) return;
    await executar(alvo, 'Reprovando…', async () => {
      await acao(`/api/pecas/${ui.selecionada}/reprovar`, { motivo: r.valor });
      avisar('Peça reprovada.');
    });
  },

  'salvar-textos': async (alvo) => {
    if (!exigirNome()) return;
    const campos = formParaTextos(ui.rascunho, ui.detalhe.peca.textos);
    await executar(alvo, 'Salvando…', async () => {
      await acao(`/api/pecas/${ui.selecionada}/editar`, { campos });
      ui.rascunho = null;
      avisar('Textos salvos. Refazendo a arte e reavaliando nas travas.');
    });
  },

  descartar: () => {
    ui.rascunho = null;
    renderDetalhe();
  },

  'aba-peca': (alvo) => {
    ui.abaPeca = alvo.dataset.aba;
    for (const b of $$('.sub-aba')) b.setAttribute('aria-selected', String(b.dataset.aba === ui.abaPeca));
    for (const painel of $$('.painel-peca')) painel.hidden = painel.id !== `painel-${ui.abaPeca}`;
    if (!alvo.classList.contains('sub-aba')) $('.sub-abas')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  'topo-detalhes': () => {
    ui.topoDetalhes = !ui.topoDetalhes;
    renderTopo();
  },

  'nova-regua': () => abrirMontarRegua(),

  'regua-sugerida': async (alvo) => {
    await executar(alvo, 'Carregando…', async () => {
      const r = await acao('/api/reguas/sugerida');
      ui.reguaAtual = r.id;
      avisar('Régua sugerida carregada. Revise as datas e baixe o PDF para aprovação.', 'sucesso');
    });
    await carregarRegua();
  },

  'regua-gerar': async (alvo) => {
    if (!exigirNome()) return;
    await executar(alvo, 'Gerando…', async () => {
      await acao(`/api/reguas/${ui.regua.id}/itens/${alvo.dataset.item}/gerar`);
      avisar('Gerando o post. Ele aparece na fila de revisão em 1 a 2 minutos.', 'sucesso');
    });
    await carregarRegua();
  },

  'regua-produzido': async (alvo) => {
    const item = ui.regua.itens.find((i) => i.id === alvo.dataset.item);
    ui.regua = await api(`/api/reguas/${ui.regua.id}/itens/${item.id}`, { metodo: 'PATCH', corpo: { ja_produzido: !item.ja_produzido } });
    renderRegua();
  },

  'regua-abrir-peca': async (alvo) => {
    trocarAba('fila');
    await selecionar(alvo.dataset.peca);
  },

  'regua-excluir': async () => {
    const r = await confirmar({ titulo: 'Excluir esta régua?', texto: 'Os posts já gerados continuam na fila. Só o planejamento da série é apagado.', botao: 'Excluir', perigo: true });
    if (!r.ok) return;
    await api(`/api/reguas/${ui.regua.id}`, { metodo: 'DELETE' });
    ui.reguaAtual = null;
    await carregarRegua();
  },

  'copiar-titulo-artigo': async () => {
    try {
      await navigator.clipboard.writeText(ui.detalhe?.peca?.textos?.titulo || '');
      avisar('Título copiado. Cole no campo de título do artigo.', 'sucesso');
    } catch {
      avisar('Não consegui copiar. Selecione o título e use Ctrl+C.', 'erro');
    }
  },

  'copiar-artigo': async () => {
    const { html, texto } = corpoDoArtigo(ui.detalhe?.peca?.textos || {});
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([texto], { type: 'text/plain' }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(texto);
      }
      avisar('Artigo copiado, com os intertítulos. Cole no corpo do artigo no LinkedIn.', 'sucesso');
    } catch {
      avisar('Não consegui copiar. Selecione o texto do artigo e use Ctrl+C.', 'erro');
    }
  },

  'copiar-texto': async () => {
    try {
      await navigator.clipboard.writeText(ui.detalhe?.legenda_final || '');
      avisar('Texto do post copiado. É só colar no LinkedIn.', 'sucesso');
    } catch {
      avisar('Não consegui copiar. Selecione o texto e use Ctrl+C.', 'erro');
    }
  },

  'ajustar-textos-ia': async (alvo) => {
    if (!exigirNome()) return;
    const emSlides = Boolean(ui.detalhe?.peca?.textos?.slides);
    const r = await confirmar({
      titulo: 'Ajustar texto com IA',
      texto:
        'Diga o que mudar. A IA reescreve só o necessário, segue as regras da marca e a peça passa pelas travas de novo. Para mudar a imagem ou o layout, use "Novo visual".',
      campo: {
        rotulo: 'O que mudar nos textos',
        placeholder: emSlides
          ? 'Ex.: tira a numeração dos títulos, deixa o slide 3 mais simples e a legenda mais curta'
          : 'Ex.: título mais direto, subtítulo mais curto e legenda mais descontraída',
      },
      botao: 'Ajustar texto',
    });
    if (!r.ok) return;
    if (!r.valor) {
      avisar('Escreva o que a IA deve mudar nos textos.', 'erro');
      return;
    }
    await executar(alvo, 'Enviando…', async () => {
      await acao(`/api/pecas/${ui.selecionada}/ajustar-textos`, { pedido: r.valor });
      avisar('A IA está ajustando os textos. O que mudou fica na trilha de auditoria.');
    });
  },

  'nova-imagem': async (alvo) => {
    if (!exigirNome()) return;
    const visual = ui.detalhe?.peca?.visual || 'ia';
    const rotulo = 'O que está errado e como deve ficar (opcional)';
    const nota = 'Pode falar da imagem e do layout: fundo, formas, números, tamanho do texto. Para trocar palavras, use "Ajustar texto com IA".';
    const opcoes = {
      ia: {
        titulo: 'Novo visual',
        texto: `Sem pedido, gera outra imagem com o mesmo brief. Com pedido, a IA ajusta o que você descrever. ${nota}`,
        campo: { rotulo, placeholder: 'Ex.: cena ao ar livre com uma jovem, fundo escuro nos slides, tirar os números grandes' },
        botao: 'Gerar novo visual',
      },
      foto: {
        titulo: 'Novo visual',
        texto: `Sem pedido, busca outra foto com as mesmas palavras. Com pedido, a IA ajusta o que você descrever. ${nota}`,
        campo: { rotulo, placeholder: 'Ex.: foto de um jovem estudando em casa, mais clara, texto maior' },
        botao: 'Gerar novo visual',
      },
      design: {
        titulo: 'Novo visual',
        texto: `Sem pedido, refaz as formas e a composição. Com pedido, a IA ajusta o que você descrever. ${nota}`,
        campo: { rotulo, placeholder: 'Ex.: menos círculos, fundo escuro, tirar os números grandes e o contador' },
        botao: 'Gerar novo visual',
      },
    };
    const r = await confirmar(opcoes[visual]);
    if (!r.ok) return;
    await executar(alvo, 'Enviando…', async () => {
      await acao(`/api/pecas/${ui.selecionada}/regenerar-imagem`, { direcao: r.valor });
      avisar(r.valor ? 'Ajustando o visual conforme o seu pedido. O que mudou fica na trilha de auditoria.' : 'Gerando novo visual.');
    });
  },

  'mudar-horario': async (alvo) => {
    if (!exigirNome()) return;
    const r = await escolherQuando({
      titulo: 'Quando este post deve sair?',
      texto: 'O novo horário fica registrado na trilha de auditoria.',
      botao: 'Salvar horário',
      sugestao: ui.detalhe?.sugestao_agendamento,
    });
    if (!r.ok) return;
    await executar(alvo, 'Salvando…', async () => {
      const p = await acao(`/api/pecas/${ui.selecionada}/reagendar`, { quando: r.quando });
      ui.programacao = null;
      if (p.status === 'agendada') avisar(`Agendada para ${dataHora(p.agendamento?.para, { diaSemana: true })}.`, 'sucesso');
      else avisar(p.status === 'publicada' ? 'Peça publicada.' : `Ainda pendente: ${p.publicacao?.motivo || 'aguardando'}.`);
    });
  },

  'cancelar-agendamento': async (alvo) => {
    if (!exigirNome()) return;
    const r = await confirmar({
      titulo: 'Cancelar o agendamento?',
      texto: 'O post não sai no horário marcado. A peça volta para a fila de revisão, e você pode aprovar de novo quando quiser.',
      botao: 'Cancelar agendamento',
      perigo: true,
    });
    if (!r.ok) return;
    await executar(alvo, 'Cancelando…', async () => {
      await acao(`/api/pecas/${ui.selecionada}/cancelar-agendamento`);
      ui.programacao = null;
      avisar('Agendamento cancelado. A peça voltou para a revisão.');
    });
  },

  'abrir-da-programacao': async (alvo) => {
    trocarAba('fila');
    await selecionar(alvo.dataset.id);
  },

  'prog-adicionar': () => {
    const dia = Number($('#prog-dia').value);
    const hora = $('#prog-hora').value;
    if (!hora) {
      avisar('Escolha um horário antes de adicionar.', 'erro');
      return;
    }
    const r = ui.progRascunho;
    ui.progNovo = { dia, hora, tocado: false };
    if (r.horarios.some((h) => h.dia === dia && h.hora === hora)) {
      avisar('Esse horário já está na lista.');
      return;
    }
    r.horarios = [...r.horarios, { dia, hora }].sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora));
    avisar(`${ui.programacao.dias_da_semana[dia]}, ${hora} entrou na lista. Clique em “Salvar programação” para valer.`);
    renderProgramacao();
  },

  'cal-mes': (alvo) => {
    const passo = Number(alvo.dataset.passo);
    if (!passo) ui.calMes = null;
    else {
      const [a, m] = (ui.calMes || new Date().toISOString().slice(0, 7)).split('-').map(Number);
      const data = new Date(Date.UTC(a, m - 1 + passo, 1));
      ui.calMes = data.toISOString().slice(0, 7);
    }
    renderProgramacao();
  },

  'abrir-regua-do-calendario': () => trocarAba('regua'),

  'geo-rodar': async (alvo) => {
    if (!exigirNome()) return;
    await executar(alvo, 'Começando…', async () => {
      await api('/api/geo/rodar', { metodo: 'POST', corpo: { usuario: nomeRevisor() } });
      avisar('Rodada começou. Leva alguns minutos; o placar atualiza sozinho.', 'sucesso');
      await carregarGeo();
    });
  },

  'geo-salvar': async (alvo) => {
    await executar(alvo, 'Salvando…', async () => {
      await api('/api/geo/config', {
        metodo: 'PUT',
        corpo: {
          perguntas: $('#geo-perguntas').value,
          nomes_da_marca: $('#geo-nomes').value,
          dominios: $('#geo-dominios').value,
          concorrentes: $('#geo-concorrentes').value,
          repeticoes: Number($('#geo-repeticoes').value),
          semanal: $('#geo-semanal').checked,
        },
      });
      avisar('Configuração do radar salva.', 'sucesso');
      await carregarGeo();
    });
  },

  'geo-diagnosticar': async (alvo) => {
    const id = ui.geo.atualId;
    await executar(alvo, 'Gerando o diagnóstico…', async () => {
      const rodada = await api(`/api/geo/rodadas/${encodeURIComponent(id)}/diagnostico`, { metodo: 'POST', corpo: {} });
      ui.geo.detalhes = { ...(ui.geo.detalhes || {}), [id]: rodada };
      renderGeo();
      avisar('Diagnóstico e plano de ação prontos.', 'sucesso');
    });
  },

  'geo-gerar-no-motor': (alvo) => {
    abrirGerar();
    const campo = $('#form-gerar textarea');
    if (campo) campo.value = alvo.dataset.orientacao || '';
    const formato = $('#gerar-formato');
    const pedido = alvo.dataset.formato || 'post';
    if (formato && [...formato.options].some((o) => o.value === pedido && !o.disabled)) formato.value = pedido;
    atualizarDialogoGerar();
  },

  'geo-abrir': async (alvo) => {
    const i = Number(alvo.dataset.indice);
    ui.geo.aberta = ui.geo.aberta === i ? null : i;
    renderGeo();
    const id = ui.geo.atualId;
    if (ui.geo.aberta !== null && !ui.geo.detalhes?.[id]) {
      const rodada = await api(`/api/geo/rodadas/${encodeURIComponent(id)}`);
      ui.geo.detalhes = { ...(ui.geo.detalhes || {}), [id]: rodada };
      renderGeo();
    }
  },

  'banco-descrever': async (alvo) => {
    await executar(alvo, 'Descrevendo as fotos…', async () => {
      let r = { faltam: 1 };
      let total = 0;
      // Descreve em partes, para não estourar o tempo de uma chamada.
      for (let volta = 0; volta < 30 && r.faltam > 0; volta++) {
        r = await api('/api/banco/descrever', { metodo: 'POST', corpo: {} });
        total += r.descritas;
        alvo.textContent = `Descrevendo as fotos… (${total} prontas, ${r.faltam} faltam)`;
        if (!r.descritas) break;
      }
      ui.banco = await api('/api/banco');
      renderBanco();
      avisar(r.faltam ? `${total} fotos descritas. Clique de novo para continuar.` : `${total} fotos descritas. Agora baixe o catálogo e suba no GitHub.`, 'sucesso');
    });
  },

  'prog-remover': (alvo) => {
    const i = Number(alvo.dataset.indice);
    ui.progRascunho.horarios = ui.progRascunho.horarios.filter((_, j) => j !== i);
    renderProgramacao();
  },

  'prog-salvar': async (alvo) => {
    if (!exigirNome()) return;
    // Se a pessoa escolheu dia e horário mas não clicou em "Adicionar horário", o horário entra junto.
    const r = ui.progRascunho;
    let incluido = null;
    const dia = Number($('#prog-dia')?.value);
    const hora = $('#prog-hora')?.value;
    if (hora && (ui.progNovo?.tocado || !r.horarios.length) && !r.horarios.some((h) => h.dia === dia && h.hora === hora)) {
      r.horarios = [...r.horarios, { dia, hora }].sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora));
      incluido = `${ui.programacao.dias_da_semana[dia]}, ${hora}`;
    }
    await executar(alvo, 'Salvando…', async () => {
      ui.programacao = await api('/api/programacao', { metodo: 'PUT', corpo: rascunhoDaProgramacao() });
      ui.progRascunho = null;
      ui.progNovo = { dia, hora: hora || '12:00', tocado: false };
      avisar(incluido ? `Programação salva, com ${incluido}.` : 'Programação salva.', 'sucesso');
      renderProgramacao();
    });
  },

  'slide-anterior': () => {
    ui.slideAtual = Math.max(0, (ui.slideAtual || 0) - 1);
    renderDetalhe();
  },

  'slide-proximo': () => {
    ui.slideAtual = (ui.slideAtual || 0) + 1;
    renderDetalhe();
  },

  'ir-slide': (alvo) => {
    ui.slideAtual = Number(alvo.dataset.indice);
    ui.verFundo = false;
    renderDetalhe();
  },

  'publicar-agora': async (alvo) => {
    if (!exigirNome()) return;
    await executar(alvo, 'Publicando…', async () => {
      const p = await acao(`/api/pecas/${ui.selecionada}/publicar`);
      avisar(p.status === 'publicada' ? 'Peça publicada.' : `Ainda pendente: ${p.publicacao?.motivo || 'aguardando'}.`, p.status === 'publicada' ? 'sucesso' : 'info');
    });
  },

  liberar: async (alvo) => {
    if (!exigirNome()) return;
    const categoria = ui.estado.categorias.find((c) => c.id === alvo.dataset.categoria);
    const r = await confirmar({
      titulo: `Liberar publicação automática em ${categoria.nome}?`,
      texto: `Peças desta categoria que passarem em todas as travas vão ao ar sem revisão humana. ${pct(ui.estado.config.autonomia.amostragem_auditoria)} continuam indo para conferência por sorteio, e a categoria volta sozinha para aprovação humana se a concordância cair. A liberação fica registrada com seu nome.`,
      botao: 'Liberar',
    });
    if (!r.ok) return;
    await executar(alvo, 'Liberando…', async () => {
      await acao(`/api/categorias/${alvo.dataset.categoria}/modo`, { modo: 'auto' });
      avisar(`${categoria.nome}: publicação automática liberada.`, 'sucesso');
    });
  },

  restringir: async (alvo) => {
    const categoria = ui.estado.categorias.find((c) => c.id === alvo.dataset.categoria);
    await executar(alvo, 'Aplicando…', async () => {
      await acao(`/api/categorias/${alvo.dataset.categoria}/modo`, { modo: 'humano' });
      avisar(`${categoria.nome}: todas as peças voltam a passar por aprovação humana.`);
    });
  },
};

document.addEventListener('click', async (evento) => {
  const alvo = evento.target.closest('[data-acao]');
  if (!alvo || alvo.disabled) return;
  const tarefa = acoesPorNome[alvo.dataset.acao];
  if (!tarefa) return;
  evento.preventDefault();
  try {
    await tarefa(alvo);
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
});

document.addEventListener('input', (evento) => {
  const campo = evento.target.closest('[data-campo]');
  if (!campo || !ui.detalhe?.peca?.textos) return;
  ui.rascunho ??= textosParaForm(ui.detalhe.peca.textos);
  ui.rascunho[campo.dataset.campo] = campo.value;
  const definicao = camposDaPeca(ui.detalhe.peca).find((c) => c.id === campo.dataset.campo);
  const m = medida(definicao, campo.value);
  const contador = $(`#contador-${definicao.id}`);
  contador.textContent = m.texto;
  contador.classList.toggle('campo__contador--excedido', m.excedido);
  atualizarAcoes();
});

document.addEventListener('change', (evento) => {
  if (evento.target.id === 'gerar-formato' || evento.target.id === 'gerar-slides') {
    atualizarDialogoGerar();
    return;
  }
  if (evento.target.id === 'geo-atual' || evento.target.id === 'geo-compara') {
    if (evento.target.id === 'geo-atual') {
      ui.geo.atualId = evento.target.value;
      const ids = ui.geo.dados.rodadas.map((r) => r.id);
      if (ui.geo.comparaId === ui.geo.atualId) ui.geo.comparaId = ids[ids.indexOf(ui.geo.atualId) + 1] || null;
      ui.geo.aberta = null;
    } else ui.geo.comparaId = evento.target.value || null;
    renderGeo();
    return;
  }
  if (evento.target.id === 'geo-importar' && evento.target.files?.[0]) {
    evento.target.files[0]
      .text()
      .then((t) => api('/api/geo/importar', { metodo: 'POST', corpo: JSON.parse(t) }))
      .then((r) => {
        avisar(r.novas ? `${r.novas} rodadas restauradas.` : 'Nenhuma rodada nova no arquivo.', 'sucesso');
        return carregarGeo();
      })
      .catch((erro) => avisar(erro.message || 'Não consegui ler o arquivo.', 'erro'));
    return;
  }
  if (evento.target.id === 'prog-dia' || evento.target.id === 'prog-hora') {
    ui.progNovo = { dia: Number($('#prog-dia').value), hora: $('#prog-hora').value || '12:00', tocado: true };
    renderProgramacao();
    return;
  }
  if (['prog-auto', 'prog-antecedencia', 'prog-formato', 'prog-visual', 'prog-slides'].includes(evento.target.id)) {
    const r = ui.progRascunho;
    r.gerar_automaticamente = $('#prog-auto').checked;
    r.antecedencia_horas = Number($('#prog-antecedencia').value);
    r.formato_padrao = $('#prog-formato').value;
    r.visual_padrao = $('#prog-visual').value;
    r.slides_padrao = Number($('#prog-slides').value);
    renderProgramacao();
    return;
  }
  if (evento.target.id !== 'filtro-status') return;
  ui.filtro = evento.target.value;
  carregarLista().catch((erro) => avisar(erro.message, 'erro'));
});

$('#revisor').addEventListener('input', (evento) => {
  try {
    localStorage.setItem(CHAVE_REVISOR, evento.target.value.trim());
  } catch {
    /* navegador sem armazenamento local: o nome vale só nesta sessão */
  }
});

$('#btn-gerar').addEventListener('click', () => abrirGerar());

$('#btn-pausa').addEventListener('click', async (evento) => {
  const botao = evento.currentTarget;
  if (ui.estado?.controle?.pausado) {
    const n = ui.estado.contagens.aguardando_publicacao;
    if (n) {
      const r = await confirmar({
        titulo: 'Retomar a operação?',
        texto: `${n === 1 ? 'Há 1 peça aprovada aguardando' : `Há ${n} peças aprovadas aguardando`} publicação. Ao retomar, elas são publicadas na hora.`,
        botao: 'Retomar e publicar',
      });
      if (!r.ok) return;
    }
    await executar(botao, 'Retomando…', async () => {
      await acao('/api/controle/retomar');
      avisar('Operação retomada.', 'sucesso');
    });
    return;
  }
  const r = await confirmar({
    titulo: 'Pausar tudo?',
    texto: 'Enquanto estiver pausado, nada é publicado, nem com aprovação humana, e a agenda não gera peças novas. Peças aprovadas ficam aguardando e saem quando você retomar.',
    campo: { rotulo: 'Motivo (fica na auditoria)', placeholder: 'Ex.: crise de imagem em andamento' },
    botao: 'Pausar tudo',
    perigo: true,
  });
  if (!r.ok) return;
  await executar(botao, 'Pausando…', async () => {
    await acao('/api/controle/pausar', { motivo: r.valor });
    avisar('Operação pausada. Nada será publicado até a retomada.');
  });
});

/** Volta à tela inicial: aba da fila, sem peça aberta. */
function irParaInicio() {
  if (ui.aba !== 'fila') trocarAba('fila');
  acoesPorNome.voltar();
}

$('#btn-inicio').addEventListener('click', irParaInicio);

$('#dlg-regua').addEventListener('close', async () => {
  const dlg = $('#dlg-regua');
  if (dlg.returnValue !== 'confirmar') return;
  const form = new FormData($('#form-regua'));
  const corpo = {
    objetivo: form.get('objetivo'),
    total: Number(form.get('total')),
    inicio: form.get('inicio'),
    publico: form.get('publico'),
    obrigatorios: form.get('obrigatorios'),
    ja_produzido: form.get('ja_produzido'),
    dias_semana: form.getAll('dia').map(Number),
  };
  if (!corpo.dias_semana.length) return avisar('Escolha pelo menos um dia de publicação.', 'erro');
  avisar('Montando a régua. Isso leva até 1 minuto.');
  try {
    const r = await acao('/api/reguas', corpo);
    ui.reguaAtual = r.id;
    await carregarRegua();
    avisar('Régua pronta. Revise e baixe o PDF para aprovação.', 'sucesso');
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
});

document.addEventListener('change', async (evento) => {
  const campoData = evento.target.closest?.('[data-regua-data]');
  if (campoData && ui.regua) {
    try {
      ui.regua = await api(`/api/reguas/${ui.regua.id}/itens/${campoData.dataset.reguaData}`, { metodo: 'PATCH', corpo: { data: campoData.value } });
      renderRegua();
      avisar('Data atualizada. A régua foi reordenada.', 'sucesso');
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
    return;
  }
  const escolha = evento.target.closest?.('[data-regua-escolher]');
  if (escolha) {
    ui.reguaAtual = escolha.value;
    carregarRegua().catch((erro) => avisar(erro.message, 'erro'));
  }
});

// Esc fecha a peça aberta e volta ao início, quando não há janela aberta por cima.
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && ui.gaveta && !document.querySelector('dialog[open]')) {
    ui.gaveta = false;
    aplicarGaveta();
    return;
  }
  if (evento.key !== 'Escape' || !ui.selecionada || document.querySelector('dialog[open]')) return;
  if (evento.target.closest('input, textarea, select')) return;
  acoesPorNome.voltar();
});

// O evento "toggle" não sobe pela página: é ouvido na captura.
document.addEventListener(
  'toggle',
  (evento) => {
    if (evento.target.matches?.('details.editar')) ui.editarAberto = evento.target.open;
  },
  true,
);

for (const aba of $$('.aba')) {
  // Clicar de novo na aba em que você já está fecha a peça aberta.
  aba.addEventListener('click', () => {
    if (ui.aba === aba.dataset.aba && ui.selecionada) acoesPorNome.voltar();
    else trocarAba(aba.dataset.aba);
  });
  aba.addEventListener('keydown', (evento) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(evento.key)) return;
    const abas = $$('.aba');
    const i = abas.indexOf(aba);
    const proxima = abas[(i + (evento.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
    proxima.focus();
    trocarAba(proxima.dataset.aba);
  });
}

/* -------------------------------------------------------------------- início */

async function iniciar() {
  $('#revisor').value = lerRevisorSalvo();
  const doEndereco = new URLSearchParams(location.hash.slice(1)).get('peca');
  if (doEndereco) ui.selecionada = doEndereco;
  trocarAba('fila');
  try {
    await carregarEstado();
    await carregarLista();
    await carregarDetalhe();
  } catch (erro) {
    ui.semConexao = true;
    avisar(`Não foi possível carregar o painel: ${erro.message}`, 'erro');
  }
  agendar();
}

iniciar();
