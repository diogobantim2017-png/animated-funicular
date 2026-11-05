/**
 * Radar de visibilidade em IA (GEO), em teste.
 *
 * Faz às IAs as perguntas que os clientes da marca fariam e mede, em cada resposta, se a marca aparece,
 * em que posição em relação aos concorrentes e se um site da marca é citado como fonte.
 * Cada rodada gera um score de 0 a 100, que pode ser comparado com qualquer rodada anterior.
 *
 * Pontos de cada resposta (máximo 100):
 *   50 se a marca é mencionada
 *   + 20 se aparece antes de todos os concorrentes (10 se em segundo, 5 depois)
 *   + 30 se a IA cita um site da marca como fonte
 * O score da rodada é a média das perguntas; o de cada pergunta, a média das suas respostas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, raiz, marca } from './config.js';
import { normalizar } from './util.js';

export const PONTOS = { mencao: 50, primeiro: 20, segundo: 10, depois: 5, citacao: 30 };
const MAX_RODADAS = 60;

/* --------------------------------------------------------------- configuração */

export function configPadrao() {
  let arquivo = {};
  try {
    arquivo = JSON.parse(fs.readFileSync(path.join(raiz, 'geo.json'), 'utf8'));
  } catch {
    /* sem geo.json: usa só o nome da marca */
  }
  return limparConfig({
    nomes_da_marca: arquivo.nomes_da_marca || [marca.nome],
    dominios: arquivo.dominios || [],
    concorrentes: arquivo.concorrentes || [],
    perguntas: arquivo.perguntas || [],
    repeticoes: arquivo.repeticoes || 2,
    semanal: arquivo.semanal ?? false,
  });
}

const lista = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim()).filter(Boolean))];

export function limparConfig(c = {}) {
  return {
    nomes_da_marca: lista(c.nomes_da_marca).slice(0, 10),
    dominios: lista(c.dominios)
      .map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
      .slice(0, 10),
    concorrentes: lista(c.concorrentes).slice(0, 40),
    perguntas: lista(c.perguntas).slice(0, 30),
    repeticoes: Math.min(3, Math.max(1, Number(c.repeticoes) || 2)),
    semanal: Boolean(c.semanal),
  };
}

/* --------------------------------------------------------------- análise */

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Posição da primeira ocorrência do nome como palavra inteira (sem acento e sem caixa), ou -1. */
function posicaoDe(textoNormal, nome) {
  const n = normalizar(nome).trim();
  if (!n) return -1;
  const m = new RegExp(`(^|[^a-z0-9])${escapar(n)}(?=[^a-z0-9]|$)`).exec(textoNormal);
  return m ? m.index + m[1].length : -1;
}

export function dominioDe(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url || '').toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '') || null;
  }
}

/** Analisa uma resposta: menção, posição frente aos concorrentes, citação de site da marca e pontos. */
export function analisarResposta({ texto = '', fontes = [] }, config) {
  const t = normalizar(texto);
  const posicoes = config.nomes_da_marca.map((n) => posicaoDe(t, n)).filter((i) => i >= 0);
  const posMarca = posicoes.length ? Math.min(...posicoes) : -1;
  const mencionada = posMarca >= 0;
  const concorrentes = config.concorrentes
    .map((nome) => ({ nome, pos: posicaoDe(t, nome) }))
    .filter((c) => c.pos >= 0)
    .sort((a, b) => a.pos - b.pos);
  const posicao = mencionada ? 1 + concorrentes.filter((c) => c.pos < posMarca).length : null;
  const dominios = [...new Set(fontes.map(dominioDe).filter(Boolean))];
  const citada = dominios.some((d) => config.dominios.some((m) => d === m || d.endsWith(`.${m}`)));
  const bonus = posicao === 1 ? PONTOS.primeiro : posicao === 2 ? PONTOS.segundo : PONTOS.depois;
  const pontos = (mencionada ? PONTOS.mencao + bonus : 0) + (citada ? PONTOS.citacao : 0);
  return { mencionada, posicao, citada, concorrentes: concorrentes.map((c) => c.nome), dominios, pontos };
}

const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const uma = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (parte, total) => (total ? uma((100 * parte) / total) : null);

/** Resumo da rodada: score geral, taxas, score por pergunta e por IA, concorrentes e fontes mais citados. */
export function calcularResumo(respostas, config, motores = []) {
  const validas = respostas.filter((r) => !r.erro && r.analise);
  const porPergunta = config.perguntas.map((pergunta, i) => {
    const rs = validas.filter((r) => r.pergunta === i);
    return {
      pergunta,
      score: uma(media(rs.map((r) => r.analise.pontos))),
      mencoes: rs.filter((r) => r.analise.mencionada).length,
      citacoes: rs.filter((r) => r.analise.citada).length,
      respostas: rs.length,
    };
  });
  const porMotor = motores.map((m) => {
    const rs = validas.filter((r) => r.motor === m.id);
    const notas = config.perguntas.map((_, i) => media(rs.filter((r) => r.pergunta === i).map((r) => r.analise.pontos))).filter((x) => x !== null);
    return {
      id: m.id,
      nome: m.nome,
      score: uma(media(notas)),
      taxa_mencao: pct(rs.filter((r) => r.analise.mencionada).length, rs.length),
      taxa_citacao: pct(rs.filter((r) => r.analise.citada).length, rs.length),
      respostas: rs.length,
      erros: respostas.filter((r) => r.motor === m.id && r.erro).length,
    };
  });
  const contar = (itens) => {
    const mapa = new Map();
    for (const x of itens) mapa.set(x, (mapa.get(x) || 0) + 1);
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([nome, vezes]) => ({ nome, vezes }));
  };
  const mencoesMarca = validas.filter((r) => r.analise.mencionada).length;
  const mencoesConcorrentes = validas.reduce((s, r) => s + r.analise.concorrentes.length, 0);
  return {
    score: uma(media(porPergunta.map((p) => p.score).filter((x) => x !== null))),
    taxa_mencao: pct(mencoesMarca, validas.length),
    taxa_citacao: pct(validas.filter((r) => r.analise.citada).length, validas.length),
    presenca: pct(mencoesMarca, mencoesMarca + mencoesConcorrentes),
    por_pergunta: porPergunta,
    por_motor: porMotor,
    concorrentes_top: contar(validas.flatMap((r) => r.analise.concorrentes)).slice(0, 10),
    fontes_top: contar(validas.flatMap((r) => r.analise.dominios)).slice(0, 12),
    respostas_validas: validas.length,
    respostas_com_erro: respostas.length - validas.length,
  };
}

const diferenca = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : uma(a - b));

/** Diferenças entre duas rodadas (atual menos anterior), no geral, por pergunta e por IA. */
export function compararResumos(atual, anterior) {
  if (!atual || !anterior) return null;
  const perguntas = new Map(anterior.por_pergunta.map((p) => [normalizar(p.pergunta), p]));
  const motores = new Map(anterior.por_motor.map((m) => [m.id, m]));
  return {
    score: diferenca(atual.score, anterior.score),
    taxa_mencao: diferenca(atual.taxa_mencao, anterior.taxa_mencao),
    taxa_citacao: diferenca(atual.taxa_citacao, anterior.taxa_citacao),
    presenca: diferenca(atual.presenca, anterior.presenca),
    por_pergunta: atual.por_pergunta.map((p) => diferenca(p.score, perguntas.get(normalizar(p.pergunta))?.score)),
    por_motor: atual.por_motor.map((m) => diferenca(m.score, motores.get(m.id)?.score)),
  };
}

/* --------------------------------------------------------------- IAs consultadas */

async function lerJson(resposta, nome) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`${nome}: ${corpo?.error?.message || corpo?.message || `erro ${resposta.status}`}`);
  return corpo;
}

/** IAs com chave configurada. Cada uma responde { texto, fontes, modelo } para uma pergunta. */
export function motoresDisponiveis({ perguntarClaude } = {}) {
  const motores = [];
  if (env.anthropicKey && perguntarClaude) {
    motores.push({ id: 'claude', nome: 'Claude', perguntar: (pergunta) => perguntarClaude({ modelo: env.geoModeloClaude, pergunta }) });
  }
  if (env.openaiKey) {
    motores.push({
      id: 'chatgpt',
      nome: 'ChatGPT',
      perguntar: async (pergunta) => {
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.openaiKey}` },
          body: JSON.stringify({ model: env.geoModeloOpenai, input: pergunta, tools: [{ type: 'web_search' }] }),
          signal: AbortSignal.timeout(180_000),
        });
        const j = await lerJson(r, 'ChatGPT');
        const partes = (j.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).filter((c) => c.type === 'output_text');
        return {
          texto: j.output_text || partes.map((c) => c.text).join('\n'),
          fontes: partes.flatMap((c) => (c.annotations || []).filter((a) => a.type === 'url_citation').map((a) => a.url)),
          modelo: j.model || env.geoModeloOpenai,
        };
      },
    });
  }
  if (env.perplexityKey) {
    motores.push({
      id: 'perplexity',
      nome: 'Perplexity',
      perguntar: async (pergunta) => {
        const r = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.perplexityKey}` },
          body: JSON.stringify({ model: env.geoModeloPerplexity, messages: [{ role: 'user', content: pergunta }] }),
          signal: AbortSignal.timeout(180_000),
        });
        const j = await lerJson(r, 'Perplexity');
        return {
          texto: j.choices?.[0]?.message?.content || '',
          fontes: j.citations || (j.search_results || []).map((s) => s.url),
          modelo: j.model || env.geoModeloPerplexity,
        };
      },
    });
  }
  if (env.geminiKey) {
    motores.push({
      id: 'gemini',
      nome: 'Gemini',
      perguntar: async (pergunta) => {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.geoModeloGemini}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: pergunta }] }], tools: [{ google_search: {} }] }),
          signal: AbortSignal.timeout(180_000),
        });
        const j = await lerJson(r, 'Gemini');
        const candidato = j.candidates?.[0] || {};
        // As fontes do Gemini vêm por um endereço de redirecionamento; o título traz o domínio de origem.
        const fontes = (candidato.groundingMetadata?.groundingChunks || []).map((c) =>
          /vertexaisearch|grounding-api-redirect/.test(c.web?.uri || '') && c.web?.title ? `https://${c.web.title}` : c.web?.uri,
        );
        return { texto: (candidato.content?.parts || []).map((p) => p.text || '').join(''), fontes: fontes.filter(Boolean), modelo: env.geoModeloGemini };
      },
    });
  }
  return motores;
}

/** IAs que o radar conhece, com a situação de cada chave (para o painel). */
export function situacaoDosMotores(motores) {
  const ligados = new Set(motores.map((m) => m.id));
  return [
    { id: 'claude', nome: 'Claude', chave: 'ANTHROPIC_API_KEY' },
    { id: 'chatgpt', nome: 'ChatGPT', chave: 'OPENAI_API_KEY' },
    { id: 'perplexity', nome: 'Perplexity', chave: 'PERPLEXITY_API_KEY' },
    { id: 'gemini', nome: 'Gemini', chave: 'GEMINI_API_KEY' },
  ].map((m) => ({ ...m, ligado: ligados.has(m.id) }));
}

/* --------------------------------------------------------------- rodadas */

/**
 * Radar de visibilidade: guarda a configuração e as rodadas no armazenamento do motor
 * e roda as perguntas em segundo plano, três de cada vez.
 */
export function criarGeo({ db, motores, agora = () => new Date() }) {
  let execucao = { rodando: false, feitas: 0, total: 0, erro: null, iniciada_em: null, por: null };

  async function config() {
    const salva = await db.obterGeoConfig();
    return salva ? limparConfig(salva) : configPadrao();
  }

  async function executar(cfg, por) {
    const tarefas = [];
    cfg.perguntas.forEach((_, i) => motores.forEach((m) => {
      for (let k = 0; k < cfg.repeticoes; k++) tarefas.push({ pergunta: i, motor: m, repeticao: k });
    }));
    execucao = { rodando: true, feitas: 0, total: tarefas.length, erro: null, iniciada_em: agora().toISOString(), por };
    const respostas = [];
    const fila = [...tarefas];
    const trabalhador = async () => {
      while (fila.length) {
        const t = fila.shift();
        const inicio = Date.now();
        try {
          const r = await t.motor.perguntar(cfg.perguntas[t.pergunta]);
          const fontes = [...new Set((r.fontes || []).filter(Boolean))].slice(0, 30);
          respostas.push({
            pergunta: t.pergunta,
            motor: t.motor.id,
            repeticao: t.repeticao,
            modelo: r.modelo || null,
            texto: String(r.texto || '').slice(0, 6000),
            fontes,
            segundos: Math.round((Date.now() - inicio) / 1000),
            analise: analisarResposta({ texto: r.texto, fontes }, cfg),
          });
        } catch (erro) {
          respostas.push({ pergunta: t.pergunta, motor: t.motor.id, repeticao: t.repeticao, erro: String(erro?.message || erro).slice(0, 300) });
        }
        execucao.feitas++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, tarefas.length) }, trabalhador));
    respostas.sort((a, b) => a.pergunta - b.pergunta || a.motor.localeCompare(b.motor) || a.repeticao - b.repeticao);
    const resumo = calcularResumo(respostas, cfg, motores);
    const rodada = await db.salvarRodadaGeo({
      id: `rodada-${agora().getTime()}`,
      criada_em: agora().toISOString(),
      por,
      config: cfg,
      motores: motores.map((m) => ({ id: m.id, nome: m.nome })),
      respostas,
      resumo,
    });
    const todas = await db.listarRodadasGeo();
    for (const velha of todas.slice(MAX_RODADAS)) await db.excluirRodadaGeo(velha.id);
    return rodada;
  }

  return {
    config,
    situacao: () => ({ ...execucao }),
    motores: () => situacaoDosMotores(motores),

    async salvarConfig(dados) {
      const atual = await config();
      return db.salvarGeoConfig(limparConfig({ ...atual, ...dados }));
    },

    /** Começa uma rodada em segundo plano. Com aguardar, espera terminar (usado nos testes). */
    async rodar(por = 'equipe', { aguardar = false } = {}) {
      if (execucao.rodando) throw Object.assign(new Error('Já existe uma rodada em andamento.'), { status: 409 });
      if (!motores.length) throw Object.assign(new Error('Nenhuma IA configurada para o radar.'), { status: 400 });
      const cfg = await config();
      if (!cfg.perguntas.length) throw Object.assign(new Error('Cadastre pelo menos uma pergunta antes de rodar.'), { status: 400 });
      if (!cfg.nomes_da_marca.length) throw Object.assign(new Error('Informe pelo menos um nome da marca.'), { status: 400 });
      execucao = { rodando: true, feitas: 0, total: 0, erro: null, iniciada_em: agora().toISOString(), por };
      const tarefa = executar(cfg, por)
        .catch((erro) => {
          execucao.erro = erro.message;
          throw erro;
        })
        .finally(() => {
          execucao.rodando = false;
        });
      if (aguardar) return tarefa;
      tarefa.catch((erro) => console.error('Falha na rodada de visibilidade em IA:', erro.message));
      return { iniciada: true };
    },

    /** Lista das rodadas (sem os textos das respostas), da mais nova para a mais antiga. */
    async listar() {
      return (await db.listarRodadasGeo()).map((r) => ({ id: r.id, criada_em: r.criada_em, por: r.por, resumo: r.resumo, motores: r.motores }));
    },

    obter: (id) => db.obterRodadaGeo(id),

    async comparar(idAtual, idAnterior) {
      const [a, b] = await Promise.all([db.obterRodadaGeo(idAtual), db.obterRodadaGeo(idAnterior)]);
      return compararResumos(a?.resumo, b?.resumo);
    },

    /** Roda sozinho uma vez por semana, se estiver ligado. */
    async verificarSemanal() {
      const cfg = await config();
      if (!cfg.semanal || execucao.rodando || !motores.length || !cfg.perguntas.length) return false;
      const [ultima] = await db.listarRodadasGeo();
      const seteDias = 7 * 24 * 3600 * 1000 - 3600 * 1000;
      if (ultima && agora().getTime() - new Date(ultima.criada_em).getTime() < seteDias) return false;
      await this.rodar('agenda semanal', { aguardar: true });
      return true;
    },

    async exportar() {
      const rodadas = [];
      for (const r of await db.listarRodadasGeo()) rodadas.push(await db.obterRodadaGeo(r.id));
      return { tipo: 'historico-visibilidade-ia', exportado_em: agora().toISOString(), config: await config(), rodadas };
    },

    /** Restaura um histórico baixado antes (útil quando o servidor perde os dados numa atualização). */
    async importar(dados) {
      if (dados?.tipo !== 'historico-visibilidade-ia' || !Array.isArray(dados.rodadas)) {
        throw Object.assign(new Error('Arquivo inválido. Use o histórico baixado nesta aba.'), { status: 400 });
      }
      const existentes = new Set((await db.listarRodadasGeo()).map((r) => r.id));
      let novas = 0;
      for (const r of dados.rodadas) {
        if (!r?.id || !r.resumo || existentes.has(r.id)) continue;
        await db.salvarRodadaGeo(r);
        novas++;
      }
      if (dados.config && !(await db.obterGeoConfig())) await db.salvarGeoConfig(limparConfig(dados.config));
      return { novas };
    },
  };
}
