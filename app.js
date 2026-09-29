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
const NOME_ETAPA = Object.fromEntries(ETAPAS);

const GATILHOS = {
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
  if (ui.aba === 'autonomia') return;
  const status = ui.aba === 'fila' ? 'gerando,em_revisao,aprovada' : ui.filtro;
  ui.pecas = await api(`/api/pecas${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  renderLista();
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
    <span class="modo-chip ${real ? 'modo-chip--real' : ''}">${real ? `Publicação real no Instagram${ui.estado?.instagram?.usuario ? `: @${esc(ui.estado.instagram.usuario)}` : ''}` : 'Simulação: nada é publicado'}</span>
    <span>${pausado ? `Pausado por ${esc(e.controle.atualizado_por || 'equipe')}${e.controle.motivo ? `: ${esc(e.controle.motivo)}` : ''}` : esc(agenda)}</span>
    <span>Hoje: ${e.contagens.geradas_hoje} de ${e.limites.geracoes_por_dia} gerações, ${e.contagens.publicadas_hoje} de ${e.limites.publicacoes_por_dia} publicações</span>`;
  pintar($('#topo-situacao'), 'topo', html);

  const gerar = $('#btn-gerar');
  gerar.textContent = e.em_geracao ? 'Acompanhar geração' : 'Gerar peça agora';
  const pausa = $('#btn-pausa');
  pausa.textContent = pausado ? 'Retomar' : 'Pausar tudo';
  pausa.className = `botao ${pausado ? 'botao--retomar' : 'botao--alerta'}`;
  if (e.sessao?.usuario) $('#revisor').placeholder = e.sessao.usuario;
}

const telaEstreita = () => matchMedia('(max-width: 760px)').matches;

function renderPendencias() {
  const lista = ui.estado?.pendencias || [];
  const el = $('#pendencias');
  el.hidden = !lista.length;
  pintar(
    el,
    'pendencias',
    lista.length
      ? `<details ${telaEstreita() ? '' : 'open'}><summary>Configuração pendente (${lista.length})</summary><ul>${lista.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>`
      : '',
  );
}

/* -------------------------------------------------------------------- lista */

function seloDoItem(p) {
  if (p.status === 'gerando') return { classe: 'gerando', texto: `Gerando: ${NOME_ETAPA[p.etapa] || 'preparando'}` };
  if (p.status === 'erro') return { classe: 'bloqueada', texto: 'Falhou na geração' };
  if (p.status === 'reprovada') return { classe: 'neutro', texto: 'Reprovada' };
  if (p.status === 'aprovada') return { classe: 'aguardando', texto: 'Aprovada, aguardando publicação' };
  if (p.status === 'publicada') {
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
      <span class="item__meta"><span>${esc(p.categoria_nome || 'Categoria em definição')}</span><span>${dataHora(p.criada_em)}</span></span>
      <span class="selo selo--${selo.classe}">${esc(selo.texto)}</span>
    </span>
  </button>`;
}

function renderLista() {
  let html = '';
  if (ui.aba === 'todas') {
    const opcoes = [
      ['', 'Todas'],
      ['em_revisao', 'Em revisão'],
      ['aprovada', 'Aprovadas aguardando publicação'],
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
    ];
    for (const [status, titulo] of grupos) {
      const itens = ui.pecas.filter((p) => p.status === status);
      if (itens.length) html += `<h2 class="lista__grupo">${titulo} (${itens.length})</h2>${itens.map(itemHtml).join('')}`;
    }
  } else {
    html += ui.pecas.map(itemHtml).join('');
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
});

function rascunhoAlterado() {
  if (!ui.rascunho || !ui.detalhe?.peca?.textos) return false;
  const original = textosParaForm(ui.detalhe.peca.textos);
  return CAMPOS.some((c) => (ui.rascunho[c.id] ?? '') !== original[c.id]);
}

function medida(campo, valor) {
  const max = ui.estado?.limites?.[campo.limite];
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
  return `${esc(categoria?.nome || 'Categoria em definição')}, criada em ${dataHora(p.criada_em)} ${quem}`;
}

function progresso(p, reprocessando) {
  const indice = Math.max(0, ETAPAS.findIndex(([id]) => id === p.etapa));
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
  if (p.status === 'publicada') {
    const base =
      p.decisao?.tipo === 'automatica'
        ? `Publicada sozinha em ${dataHora(p.publicacao?.em)}, sem revisão humana.`
        : `Aprovada por ${esc(r?.usuario || 'equipe')} e publicada em ${dataHora(p.publicacao?.em)}.`;
    return `${base}${modoSimulacao ? ' Simulação: nada foi enviado ao Instagram.' : ''}`;
  }
  if (p.status === 'reprovada') return `Reprovada por ${esc(r?.usuario || 'equipe')} em ${dataHora(r?.em)}${r?.motivo ? `. Motivo: ${esc(r.motivo)}` : ''}.`;
  return '';
}

function regua(p) {
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
  return `<section class="regua" aria-label="Veredito das travas de governança"><ol class="regua__trilho">${passos}</ol><p class="regua__situacao">${situacao(p)}</p>${inicial}</section>`;
}

function faixaSuperior(d) {
  const p = d.peca;
  if (p.status === 'gerando' || d.processando) return progresso(p, Boolean(p.governanca));
  if (p.status === 'erro') {
    return `<section class="falha" role="alert"><strong>A geração parou na etapa ${esc(NOME_ETAPA[p.etapa] || p.etapa || 'inicial')}</strong>${esc(p.erro || 'Motivo não informado.')}</section>`;
  }
  const aviso = p.erro ? `<section class="falha" role="alert"><strong>A última ação falhou</strong>${esc(p.erro)}</section>` : '';
  return `${aviso}${p.governanca ? regua(p) : ''}`;
}

function figura(d) {
  const p = d.peca;
  if (!p.arte?.url) {
    return `<figure class="arte"><div class="arte__vazia">A arte aparece aqui quando a imagem e o template ficarem prontos.</div></figure>`;
  }
  const fundo = ui.verFundo && p.imagem?.url;
  const url = fundo ? p.imagem.url : p.arte.url;
  const alt = fundo ? `Fundo gerado por IA. Cena pedida: ${p.brief?.cena_visual || ''}` : `Arte final. Título: ${p.textos?.titulo || ''}`;
  const legenda = fundo
    ? `Gerado com ${esc(p.imagem.modelo)} (${esc(PROVEDORES[p.imagem.provedor] || p.imagem.provedor)}) em ${esc(p.imagem.segundos)} s. É esta imagem que o revisor confere: sem texto, marcas, dinheiro ou pessoas deformadas.`
    : '1080 × 1350 px. Textos, cores e avisos legais entram pelo template oficial, não pela IA de imagem.';
  return `<figure class="arte">
    <div class="arte__alternar" role="group" aria-label="Imagem exibida">
      <button type="button" data-acao="ver-arte" aria-pressed="${!fundo}">Arte final</button>
      <button type="button" data-acao="ver-fundo" aria-pressed="${Boolean(fundo)}" ${p.imagem?.url ? '' : 'disabled'}>Fundo gerado por IA</button>
    </div>
    <a class="arte__link" href="${esc(url)}" target="_blank" rel="noopener"><img class="arte__imagem ${fundo ? 'arte__imagem--fundo' : ''}" src="${esc(url)}" alt="${esc(alt)}"></a>
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
    ]),
  );
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

function textos(d) {
  const p = d.peca;
  if (!p.textos) return '';
  const editavel = p.status === 'em_revisao' && !d.processando;
  const legendaFinal = d.legenda_final
    ? `<h4 class="bloco__subtitulo">Legenda como será publicada</h4><p class="legenda-final">${esc(d.legenda_final)}</p><p class="dica">Texto legal da oferta, rótulo de imagem criada com IA e hashtags entram automaticamente.${editavel ? ' Atualiza quando você salvar.' : ''}</p>`
    : '';

  if (!editavel) {
    return bloco(
      'Textos',
      fatos([
        ['Título', p.textos.titulo],
        ['Subtítulo', p.textos.subtitulo],
        ['Chamada', p.textos.cta_arte],
      ]) + legendaFinal,
    );
  }

  const valores = ui.rascunho || textosParaForm(p.textos);
  const campos = CAMPOS.map((c) => {
    const m = medida(c, valores[c.id]);
    const controle = c.linhas
      ? `<textarea id="campo-${c.id}" data-campo="${c.id}" rows="${c.linhas}">${esc(valores[c.id])}</textarea>`
      : `<input id="campo-${c.id}" type="text" data-campo="${c.id}" value="${esc(valores[c.id])}">`;
    return `<div class="campo"><label class="campo__rotulo" for="campo-${c.id}"><span>${c.rotulo}</span><span class="campo__contador ${m.excedido ? 'campo__contador--excedido' : ''}" id="contador-${c.id}">${m.texto}</span></label>${controle}</div>`;
  }).join('');
  return bloco('Textos', `${campos}${legendaFinal}`);
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
    let nota = `Seu nome fica na trilha de auditoria. ${real ? 'A aprovação publica no Instagram na hora.' : 'Em simulação, nada é enviado ao Instagram.'}`;
    if (pausado) nota = 'Sistema pausado: você pode aprovar, mas a publicação fica aguardando até a retomada.';
    if (bloqueada) nota = 'Peça bloqueada: corrija os textos ou gere nova imagem. Toda alteração passa pelas travas de novo.';
    if (alterado) nota = 'Salve os textos para refazer a arte e passar pelas travas antes de aprovar.';
    return `<div class="acoes" id="acoes">
      <button type="button" class="botao botao--primario" data-acao="aprovar" ${bloqueada || alterado ? 'disabled' : ''}>${real ? 'Aprovar e publicar no Instagram' : 'Aprovar e publicar'}</button>
      <button type="button" class="botao botao--secundario" data-acao="salvar-textos" ${alterado ? '' : 'disabled'}>Salvar textos e reavaliar</button>
      ${alterado ? '<button type="button" class="botao botao--texto" data-acao="descartar">Descartar alterações</button>' : ''}
      <button type="button" class="botao botao--secundario" data-acao="nova-imagem">Gerar nova imagem</button>
      <span class="acoes__separador"></span>
      <button type="button" class="botao botao--perigo" data-acao="reprovar">Reprovar</button>
      <p class="acoes__nota" id="acoes-nota">${nota}</p>
    </div>`;
  }
  if (p.status === 'aprovada') {
    return `<div class="acoes" id="acoes">
      <button type="button" class="botao botao--primario" data-acao="publicar-agora" ${pausado ? 'disabled' : ''}>Publicar agora</button>
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
  return `<div class="boas-vindas">
    <h2 class="boas-vindas__titulo">Selecione uma peça para revisar</h2>
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
  const info = `${porQue(d)}${publico(d)}${textos(d)}${travas(d)}${revisor(d)}`;
  let corpo = '';
  if (p.arte) {
    corpo = `<div class="peca__corpo">${figura(d)}<div class="peca__info">${info}</div></div>`;
  } else if (p.status === 'erro') {
    // Falhou antes da arte: mostra só o que chegou a ser produzido, sem o espaço vazio da imagem.
    corpo = info ? `<div class="peca__corpo peca__corpo--sem-arte"><div class="peca__info">${info}</div></div>` : '';
  } else if (p.status !== 'gerando') {
    corpo = `<div class="peca__corpo">${figura(d)}<div class="peca__info">${info}</div></div>`;
  }
  const tema = p.oportunidade?.tema || (p.status === 'erro' ? 'Geração interrompida antes da escolha do tema' : 'Tema em definição pelo radar');
  el.innerHTML = `<article class="peca">
    <button type="button" class="voltar" data-acao="voltar">Voltar para a lista</button>
    <p class="peca__contexto">${contextoDaPeca(p, d.categoria)}</p>
    <h2 class="peca__tema">${esc(tema)}</h2>
    ${faixaSuperior(d)}
    ${corpo}
    ${acoesHtml(d)}
    ${auditoriaHtml(d.auditoria)}
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
    ['Publicação', c.publicacao_modo === 'real' ? 'Real, no Instagram' : 'Simulação: o sistema registra o que publicaria, sem enviar nada'],
    ['Radar, brief e textos', c.modelo_ia],
    ['Revisor de IA', c.modelo_revisor],
    ['Imagem', `${c.modelo_imagem} (${PROVEDORES[c.provedor_imagem] || c.provedor_imagem})`],
    ['Armazenamento', c.armazenamento === 'supabase' ? 'Supabase' : 'Local, em arquivos'],
    [
      'Agenda automática',
      e.agenda?.ativa ? `${e.agenda.expressao} (${e.agenda.fuso}). Próxima: ${dataHora(e.agenda.proxima, { diaSemana: true })}` : 'Desligada',
    ],
    ['Limites diários', `${e.limites.geracoes_por_dia} gerações e ${e.limites.publicacoes_por_dia} publicações`],
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
  const dialogo = $('#dlg-gerar');
  $('#form-gerar').reset();
  dialogo.returnValue = '';
  dialogo.showModal();
}

$('#dlg-gerar').addEventListener('close', async () => {
  if ($('#dlg-gerar').returnValue !== 'confirmar') return;
  const dados = new FormData($('#form-gerar'));
  try {
    const peca = await acao('/api/pipeline/rodar', { texto: dados.get('texto'), categoria: dados.get('categoria') });
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

function trocarAba(aba) {
  ui.aba = aba;
  for (const b of $$('.aba')) {
    b.setAttribute('aria-selected', String(b.dataset.aba === aba));
    b.tabIndex = b.dataset.aba === aba ? 0 : -1;
  }
  $('#area-pecas').hidden = aba === 'autonomia';
  $('#area-autonomia').hidden = aba !== 'autonomia';
  if (aba === 'autonomia') renderAutonomia();
  else carregarLista().catch((erro) => avisar(erro.message, 'erro'));
}

const acoesPorNome = {
  abrir: (alvo) => selecionar(alvo.dataset.id),

  voltar: () => {
    ui.selecionada = null;
    ui.detalhe = null;
    history.replaceState(null, '', location.pathname);
    renderLista();
    renderDetalhe();
    if (telaEstreita()) $('#principal').scrollIntoView({ block: 'start' });
  },

  'abrir-gerar': () => abrirGerar(),

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
    if (ui.estado?.config?.publicacao_modo === 'real') {
      const r = await confirmar({
        titulo: 'Publicar no Instagram agora?',
        texto: 'A peça sai na conta configurada assim que você confirmar. Seu nome fica na trilha de auditoria.',
        botao: 'Aprovar e publicar',
      });
      if (!r.ok) return;
    }
    await executar(alvo, 'Publicando…', async () => {
      const p = await acao(`/api/pecas/${ui.selecionada}/aprovar`);
      if (p.status === 'publicada') {
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
    const campos = { ...ui.rascunho };
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

  'nova-imagem': async (alvo) => {
    if (!exigirNome()) return;
    const r = await confirmar({
      titulo: 'Gerar nova imagem',
      texto: 'O fundo é gerado de novo a partir do mesmo brief. A arte é refeita e passa pelas travas outra vez.',
      campo: { rotulo: 'O que mudar na imagem (opcional)', placeholder: 'Ex.: cena ao ar livre, pessoa mais velha, menos objetos na mesa' },
      botao: 'Gerar nova imagem',
    });
    if (!r.ok) return;
    await executar(alvo, 'Enviando…', async () => {
      await acao(`/api/pecas/${ui.selecionada}/regenerar-imagem`, { direcao: r.valor });
      avisar('Gerando nova imagem.');
    });
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
  const definicao = CAMPOS.find((c) => c.id === campo.dataset.campo);
  const m = medida(definicao, campo.value);
  const contador = $(`#contador-${definicao.id}`);
  contador.textContent = m.texto;
  contador.classList.toggle('campo__contador--excedido', m.excedido);
  atualizarAcoes();
});

document.addEventListener('change', (evento) => {
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
        texto: `${n === 1 ? 'Há 1 peça aprovada aguardando' : `Há ${n} peças aprovadas aguardando`} publicação. Ao retomar, elas são publicadas na hora, dentro do limite diário.`,
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

for (const aba of $$('.aba')) {
  aba.addEventListener('click', () => trocarAba(aba.dataset.aba));
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
