/*
 * Aba reservada: radar de visibilidade em IA (GEO).
 * Este arquivo não é servido como os outros arquivos do painel. O servidor só entrega em
 * /api/reservado/painel.js para quem entrou com a senha GEO_SENHA (abrindo o site com #geo).
 * Sem a senha, nem a aba, nem este código, nem as rotas /api/geo aparecem no site.
 */

let ui, $, esc, api, pintar, avisar, dataHora, executar, exigirNome, nomeRevisor, abrirGerar, atualizarDialogoGerar, sair;

const CSS = `

/* ------------------------------------------------------------ visibilidade em IA */
.geo__teste {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.1rem 0.55rem;
  border: 1px solid var(--ciano);
  border-radius: 999px;
  color: var(--ciano);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: middle;
}

.geo__placar {
  display: grid;
  grid-template-columns: minmax(12rem, auto) 1fr;
  gap: 1rem 2rem;
  align-items: start;
}

.geo__placar > .geo__controles,
.geo__placar > .geo__meta,
.geo__placar > .geo__progresso {
  grid-column: 1 / -1;
}

.geo__score {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.geo__rotulo {
  color: var(--texto-3);
  font-size: var(--t-1);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.geo__numero {
  color: var(--texto);
  font-size: 4.5rem;
  font-weight: 600;
  line-height: 1;
}

.geo__metricas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
}

.geo__metricas > div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--linha);
  border-radius: 10px;
  background: var(--superficie-2);
}

.geo__metricas strong {
  color: var(--texto);
  font-size: 1.6rem;
  font-weight: 600;
}

.geo__var {
  color: var(--texto-2);
  font-size: var(--t-1);
  font-weight: 500;
}

.geo__var--sobe {
  color: var(--verde);
}

.geo__var--desce {
  color: #ff8a8a;
}

.geo__var--nula {
  color: var(--texto-3);
  font-weight: 400;
}

.geo__controles {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
}

.geo__controles .campo {
  min-width: 15rem;
}

.geo__acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.geo__meta {
  color: var(--texto-3);
  font-size: 0.8rem;
}

.geo__progresso {
  margin: 0;
  color: var(--azul-escuro);
}

.geo__progresso--erro {
  color: #ff8a8a;
}

.geo__motores {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.75rem;
}

.geo__motor {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.2rem 0.75rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--linha);
  border-radius: 10px;
  background: var(--superficie-2);
}

.geo__motor-nome {
  color: var(--texto);
  font-weight: 500;
}

.geo__motor-nota {
  color: var(--texto);
  font-size: 1.4rem;
  font-weight: 600;
  text-align: right;
}

.geo__motor .geo__var,
.geo__motor .geo__meta {
  grid-column: 1 / -1;
}

.geo__perguntas {
  margin: 0;
  padding: 0;
  list-style: none;
}

.geo__pergunta + .geo__pergunta {
  border-top: 1px solid var(--linha);
}

.geo__pergunta-linha {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7rem 2.5rem 6.5rem 9rem auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0;
}

.geo__pergunta-texto {
  color: var(--texto);
}

.geo__nota {
  color: var(--texto);
  font-weight: 600;
  text-align: right;
}

.geo__barra {
  display: block;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.geo__barra > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--azul), var(--ciano));
}

.geo__respostas {
  display: grid;
  gap: 0.6rem;
  padding: 0 0 0.9rem;
}

.geo__resposta {
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--linha);
  border-radius: 10px;
  background: var(--superficie-2);
}

.geo__resposta-topo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.geo__pontos {
  margin-left: auto;
  color: var(--texto-2);
  font-size: var(--t-1);
}

.geo__trecho {
  margin: 0.5rem 0 0.35rem;
  color: var(--texto-2);
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-line;
}

.geo__chip {
  display: inline-block;
  padding: 0.1rem 0.55rem;
  border: 1px solid var(--linha-forte);
  border-radius: 999px;
  color: var(--texto-2);
  font-size: 0.75rem;
}

.geo__chip--ok {
  border-color: var(--verde);
  background: var(--verde-fundo);
  color: var(--texto);
}

.geo__chip--erro {
  border-color: #ff8a8a;
  color: #ff8a8a;
}

.geo__top {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--texto);
}

.geo__top li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.2rem 0;
}

.geo__evolucao {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
  min-height: 9rem;
  overflow-x: auto;
}

.geo__evo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  min-width: 3rem;
}

.geo__evo-barra {
  display: flex;
  align-items: flex-end;
  width: 1.6rem;
  height: 6rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.geo__evo-barra > span {
  display: block;
  width: 100%;
  background: linear-gradient(0deg, var(--azul), var(--ciano));
}

.geo__evo-nota {
  color: var(--texto);
  font-size: var(--t-1);
  font-weight: 600;
}

.geo__evo-data {
  color: var(--texto-3);
  font-size: 0.72rem;
}

.geo__explica {
  margin: 0 0 0.5rem;
  color: var(--texto-2);
  line-height: 1.55;
}

.geo__config {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem 1rem;
  margin-bottom: 0.9rem;
}

.geo__config-largo {
  grid-column: 1 / -1;
}

.geo__config textarea {
  width: 100%;
  resize: vertical;
}

.geo__subtitulo {
  margin: 1rem 0 0.4rem;
  color: var(--texto);
  font-size: 0.95rem;
}

.geo__ias {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--texto);
}

.geo__importar {
  cursor: pointer;
}

@media (max-width: 860px) {
  .geo__placar {
    grid-template-columns: 1fr;
  }

  .geo__pergunta-linha {
    grid-template-columns: 1fr auto;
  }

  .geo__pergunta-texto {
    grid-column: 1 / -1;
  }

  .geo__config {
    grid-template-columns: 1fr;
  }
}

.geo__sinais,
.geo__fragilidades,
.geo__rapidas {
  display: grid;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;
}

.geo__sinais li,
.geo__fragilidade {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.6rem 0.8rem;
  border-left: 3px solid var(--ambar);
  border-radius: 6px;
  background: var(--superficie-2);
  color: var(--texto);
}

.geo__fragilidade .geo__chip {
  align-self: flex-start;
}

.geo__rapidas li {
  padding-left: 1.1rem;
  position: relative;
  color: var(--texto);
}

.geo__rapidas li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 2px;
  background: var(--ciano);
}

.geo__canal + .geo__canal {
  margin-top: 0.5rem;
}

.geo__acao {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.6rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--linha);
  border-radius: 10px;
  background: var(--superficie-2);
}

.geo__acao p {
  margin: 0;
  color: var(--texto-2);
  line-height: 1.5;
}

.geo__acao .botao {
  align-self: flex-start;
}

.geo__acao-topo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.5rem;
  color: var(--texto);
}

.geo__chip--alto,
.geo__chip--alta {
  border-color: #ff8a8a;
  color: #ffb3b3;
}

.geo__chip--medio,
.geo__chip--media {
  border-color: var(--ambar);
  color: var(--texto);
}

.geo__chip--baixo,
.geo__chip--baixa {
  border-color: var(--linha-forte);
}
.geo__cabeca {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

`;

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
      <div class="geo__cabeca">
        <h2 class="autonomia__titulo">Visibilidade em IA <span class="geo__teste">teste</span></h2>
        <button type="button" class="botao botao--texto" data-acao="geo-ocultar">Ocultar esta aba</button>
      </div>
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

const acoes = {
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
  'geo-ocultar': async () => {
    await sair();
  },
};

function aoMudar(evento) {
  if (evento.target.id === 'geo-atual' || evento.target.id === 'geo-compara') {
    if (evento.target.id === 'geo-atual') {
      ui.geo.atualId = evento.target.value;
      const ids = ui.geo.dados.rodadas.map((r) => r.id);
      if (ui.geo.comparaId === ui.geo.atualId) ui.geo.comparaId = ids[ids.indexOf(ui.geo.atualId) + 1] || null;
      ui.geo.aberta = null;
    } else ui.geo.comparaId = evento.target.value || null;
    renderGeo();
    return true;
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
    return true;
  }
  return false;
}

export function iniciar(ctx) {
  ({ ui, $, esc, api, pintar, avisar, dataHora, executar, exigirNome, nomeRevisor, abrirGerar, atualizarDialogoGerar, sair } = ctx);
  if (!document.getElementById('estilo-reservado')) {
    const estilo = document.createElement('style');
    estilo.id = 'estilo-reservado';
    estilo.textContent = CSS;
    document.head.append(estilo);
  }
  const botao = document.createElement('button');
  botao.className = 'aba';
  botao.type = 'button';
  botao.id = 'aba-geo';
  botao.dataset.aba = 'geo';
  botao.setAttribute('role', 'tab');
  botao.setAttribute('aria-selected', 'false');
  botao.tabIndex = -1;
  botao.innerHTML = '<span>Visibilidade<span class="aba__extra"> em IA</span></span>';
  const lista = document.querySelector('.abas__lista');
  const depois = document.querySelector('#aba-banco');
  if (depois) depois.after(botao);
  else lista.append(botao);
  const area = document.createElement('div');
  area.className = 'area-autonomia';
  area.id = 'area-geo';
  area.hidden = true;
  document.querySelector('#principal').append(area);
  ctx.registrar({ id: 'geo', botao, area, carregar: carregarGeo, acoes, aoMudar });
}
