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
import { env, raiz, marca, conhecimento } from './config.js';
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

/* --------------------------------------------------------------- fragilidades e plano */

/** Sinais de fragilidade calculados direto dos números da rodada (sem IA). */
export function sinaisDeFragilidade(resumo, config) {
  const sinais = [];
  const comRespostas = resumo.por_pergunta.filter((p) => p.respostas);
  const ausentes = comRespostas.filter((p) => p.mencoes === 0);
  if (ausentes.length) {
    sinais.push({ tipo: 'ausente', titulo: `A marca não aparece em ${ausentes.length} de ${comRespostas.length} perguntas`, detalhe: ausentes.map((p) => p.pergunta) });
  }
  const fracas = comRespostas.filter((p) => p.mencoes > 0 && p.score !== null && p.score < 40);
  if (fracas.length) {
    sinais.push({ tipo: 'fraca', titulo: `Aparece pouco ou atrás dos concorrentes em ${fracas.length} ${fracas.length === 1 ? 'pergunta' : 'perguntas'}`, detalhe: fracas.map((p) => `${p.pergunta} (score ${p.score})`) });
  }
  if (resumo.respostas_validas && !resumo.taxa_citacao) {
    sinais.push({ tipo: 'sem_citacao', titulo: `Nenhuma IA usou ${config.dominios.join(' ou ') || 'um site da marca'} como fonte`, detalhe: [] });
  }
  const respostasComMarca = Math.round(((resumo.taxa_mencao || 0) * resumo.respostas_validas) / 100);
  const fortes = resumo.concorrentes_top.filter((c) => c.vezes > respostasComMarca);
  if (fortes.length) {
    sinais.push({
      tipo: 'concorrentes',
      titulo: `Concorrentes que aparecem em mais respostas que a marca: ${fortes.map((c) => c.nome).join(', ')}`,
      detalhe: [`${marca.nome}: ${respostasComMarca} respostas`, ...fortes.map((c) => `${c.nome}: ${c.vezes} respostas`)],
    });
  }
  const motoresSemMarca = resumo.por_motor.filter((m) => m.respostas && !m.taxa_mencao);
  if (motoresSemMarca.length) {
    sinais.push({ tipo: 'motor', titulo: `A marca não aparece em nenhuma resposta do ${motoresSemMarca.map((m) => m.nome).join(' nem do ')}`, detalhe: [] });
  }
  const daMarca = (d) => config.dominios.some((m) => d === m || d.endsWith(`.${m}`));
  const fontes = resumo.fontes_top.filter((f) => !daMarca(f.nome)).slice(0, 6);
  if (fontes.length) {
    sinais.push({ tipo: 'fontes', titulo: 'Sites que as IAs mais usaram como fonte: vale a marca estar presente neles', detalhe: fontes.map((f) => `${f.nome} (${f.vezes}×)`) });
  }
  return sinais;
}

export const CANAIS = {
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
const PRAZOS = ['esta semana', 'este mês', 'este trimestre'];

function ferramentaDiagnostico() {
  return {
    name: 'diagnosticar_geo',
    description: 'Registra o diagnóstico de visibilidade em IA e o plano de ação.',
    input_schema: {
      type: 'object',
      properties: {
        resumo: { type: 'string', description: 'Duas ou três frases com a situação da marca nas respostas das IAs.' },
        fragilidades: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'A fragilidade, em uma frase curta.' },
              evidencia: { type: 'string', description: 'O dado da rodada que mostra a fragilidade (pergunta, score, concorrente ou fonte).' },
              impacto: { type: 'string', enum: ['alto', 'medio', 'baixo'] },
              perguntas: { type: 'array', items: { type: 'integer' }, description: 'Números das perguntas ligadas (1 = primeira).' },
            },
            required: ['titulo', 'evidencia', 'impacto', 'perguntas'],
          },
        },
        acoes: {
          type: 'array',
          minItems: 4,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              canal: { type: 'string', enum: Object.keys(CANAIS) },
              titulo: { type: 'string', description: 'A ação, em uma frase curta.' },
              o_que_fazer: { type: 'string', description: 'O que fazer, de forma concreta, em até três frases.' },
              por_que: { type: 'string', description: 'Qual fragilidade a ação ataca, com o dado.' },
              prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
              esforco: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
              prazo: { type: 'string', enum: PRAZOS },
              o_motor_faz: { type: 'boolean', description: 'Verdadeiro só se o Motor de campanhas executa a ação (post, carrossel ou artigo de LinkedIn).' },
              formato: { type: 'string', enum: ['post', 'carrossel', 'artigo', 'nenhum'] },
              orientacao_para_o_motor: { type: 'string', description: 'Se o Motor faz: pedido curto ao Motor, com o tema e a pergunta que o conteúdo responde. Senão, vazio.' },
            },
            required: ['canal', 'titulo', 'o_que_fazer', 'por_que', 'prioridade', 'esforco', 'prazo', 'o_motor_faz', 'formato', 'orientacao_para_o_motor'],
          },
        },
        vitorias_rapidas: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' }, description: 'Ações de baixo esforço para as próximas duas semanas.' },
        como_medir: { type: 'string', description: 'Como saber, nas próximas rodadas, se o plano funcionou.' },
      },
      required: ['resumo', 'fragilidades', 'acoes', 'vitorias_rapidas', 'como_medir'],
    },
  };
}

/** A IA lê a rodada (números, respostas e fontes) e devolve fragilidades e um plano de ação por canal. */
export async function gerarDiagnostico({ ia, modelo, rodada }) {
  const { resumo, config, respostas, motores } = rodada;
  const nomeMotor = (id) => motores.find((m) => m.id === id)?.nome || id;
  const sinais = resumo.sinais || sinaisDeFragilidade(resumo, config);
  const perguntas = resumo.por_pergunta
    .map((p, i) => {
      const rs = respostas.filter((r) => r.pergunta === i && !r.erro).slice(0, 4);
      return `Pergunta ${i + 1}: "${p.pergunta}". Score ${p.score ?? 'sem respostas'}; marca em ${p.mencoes} de ${p.respostas} respostas; site da marca citado em ${p.citacoes}.
${rs
  .map(
    (r) =>
      `  - ${nomeMotor(r.motor)}: ${r.analise.mencionada ? `marca em ${r.analise.posicao}º lugar` : 'marca ausente'}; concorrentes: ${r.analise.concorrentes.join(', ') || 'nenhum'}; fontes: ${r.analise.dominios.slice(0, 6).join(', ') || 'nenhuma'}. Trecho: ${r.texto.slice(0, 280).replace(/\s+/g, ' ')}`,
  )
  .join('\n')}`;
    })
    .join('\n\n');
  const ofertas = (conhecimento?.ofertas || []).map((o) => o.nome).filter(Boolean);
  const reconhecimentos = (conhecimento?.reconhecimentos || []).map((r) => r.nome || r.titulo).filter(Boolean);
  const conteudo = `Marca: ${marca.nome} (nomes considerados: ${config.nomes_da_marca.join(', ')}). Sites da marca: ${config.dominios.join(', ') || 'não informado'}.
Concorrentes acompanhados: ${config.concorrentes.join(', ')}.
${ofertas.length ? `Ofertas da marca (base aprovada): ${ofertas.join('; ')}.` : ''}
${reconhecimentos.length ? `Reconhecimentos na base aprovada: ${reconhecimentos.join('; ')}.` : ''}

Resultado da rodada: score ${resumo.score}; menção em ${resumo.taxa_mencao}% das respostas; site da marca citado em ${resumo.taxa_citacao}%; presença frente aos concorrentes ${resumo.presenca}%.
Por IA: ${resumo.por_motor.map((m) => `${m.nome} score ${m.score}, menção ${m.taxa_mencao}%, citação ${m.taxa_citacao}%`).join('; ')}.
Concorrentes que mais apareceram: ${resumo.concorrentes_top.map((c) => `${c.nome} (${c.vezes})`).join(', ') || 'nenhum'}.
Fontes que as IAs mais usaram: ${resumo.fontes_top.map((f) => `${f.nome} (${f.vezes})`).join(', ') || 'nenhuma'}.
Sinais já calculados: ${sinais.map((x) => x.titulo).join('; ') || 'nenhum'}.

Detalhe por pergunta:
${perguntas}`;
  const sistema = `Você é especialista em GEO (otimização para aparecer nas respostas de IAs como ChatGPT, Claude, Gemini e Perplexity) e analisa o radar de visibilidade da marca ${marca.nome}.
Regras:
1. Cada fragilidade cita a evidência dos dados: a pergunta, o score, o concorrente ou a fonte.
2. As ações são concretas e próprias de cada canal. Referências do que costuma funcionar:
   - site da marca: páginas que respondem direto às perguntas em que a marca não aparece, guias de "como escolher", comparações, casos com resultados aprovados e perguntas frequentes, com o nome da marca e das ofertas sempre escrito igual;
   - ajuste técnico: conferir se os robôs das IAs conseguem acessar o site e se as páginas têm estrutura clara; é a base, não o principal;
   - LinkedIn: artigos com intertítulos que respondem às perguntas, publicados por executivos;
   - YouTube: vídeos curtos que respondem às perguntas, com título e descrição claros;
   - imprensa, parceiros, avaliações e analistas: presença nas fontes que as IAs mais citaram nesta rodada.
3. Nada de táticas enganosas: avaliações falsas, perfis falsos, conteúdo escondido ou manipulação de fóruns.
4. Não invente fatos sobre a marca. Se uma ação depende de um caso, número ou prêmio, use só o que está na base aprovada ou diga que precisa ser levantado.
5. Marque o_motor_faz como verdadeiro só para ações que o Motor de campanhas executa: posts, carrosséis e artigos de LinkedIn. Nelas, escreva orientacao_para_o_motor como um pedido curto (tema e pergunta que o conteúdo responde) e escolha o formato.
6. Priorize o que fecha as maiores lacunas com menos esforço. Escreva em português do Brasil, frases diretas, sem jargão.`;
  const r = await ia({ modelo, sistema, conteudo, ferramenta: ferramentaDiagnostico(), maxTokens: 4000 });
  const d = r.dados || {};
  return {
    gerado_em: new Date().toISOString(),
    modelo: r.modelo || modelo,
    resumo: String(d.resumo || '').trim(),
    fragilidades: (d.fragilidades || []).map((f) => ({ ...f, perguntas: (f.perguntas || []).filter((n) => Number.isInteger(n)) })),
    acoes: (d.acoes || [])
      .filter((a) => CANAIS[a.canal])
      .map((a) => ({ ...a, orientacao_para_o_motor: a.o_motor_faz ? String(a.orientacao_para_o_motor || '').trim() : '' }))
      .sort((a, b) => ['alta', 'media', 'baixa'].indexOf(a.prioridade) - ['alta', 'media', 'baixa'].indexOf(b.prioridade)),
    vitorias_rapidas: (d.vitorias_rapidas || []).map(String),
    como_medir: String(d.como_medir || '').trim(),
  };
}

/** O plano em texto simples, para mandar ao time do site e a outras áreas. */
export function planoEmTexto(rodada) {
  const { resumo, diagnostico: d, criada_em } = rodada;
  const data = new Date(criada_em).toLocaleDateString('pt-BR');
  const linhas = [
    `PLANO DE VISIBILIDADE EM IA · ${marca.nome} · rodada de ${data}`,
    '',
    `Score: ${resumo.score} · Menção: ${resumo.taxa_mencao}% · Citação do site: ${resumo.taxa_citacao}% · Presença frente aos concorrentes: ${resumo.presenca}%`,
    '',
  ];
  if (d?.resumo) linhas.push('SITUAÇÃO', d.resumo, '');
  const sinais = resumo.sinais || [];
  if (sinais.length) {
    linhas.push('SINAIS NOS NÚMEROS');
    for (const s of sinais) linhas.push(`- ${s.titulo}${s.detalhe?.length ? `: ${s.detalhe.join('; ')}` : ''}`);
    linhas.push('');
  }
  if (d?.fragilidades?.length) {
    linhas.push('FRAGILIDADES');
    for (const f of d.fragilidades) linhas.push(`- [impacto ${f.impacto}] ${f.titulo}. Evidência: ${f.evidencia}`);
    linhas.push('');
  }
  if (d?.acoes?.length) {
    linhas.push('PLANO DE AÇÃO');
    for (const [canal, nome] of Object.entries(CANAIS)) {
      const doCanal = d.acoes.filter((a) => a.canal === canal);
      if (!doCanal.length) continue;
      linhas.push('', nome.toUpperCase());
      for (const a of doCanal) {
        linhas.push(`- ${a.titulo} (prioridade ${a.prioridade}, esforço ${a.esforco}, ${a.prazo})`, `  O que fazer: ${a.o_que_fazer}`, `  Por quê: ${a.por_que}`);
        if (a.o_motor_faz && a.orientacao_para_o_motor) linhas.push(`  No Motor: ${a.orientacao_para_o_motor}`);
      }
    }
    linhas.push('');
  }
  if (d?.vitorias_rapidas?.length) {
    linhas.push('VITÓRIAS RÁPIDAS (PRÓXIMAS DUAS SEMANAS)');
    for (const v of d.vitorias_rapidas) linhas.push(`- ${v}`);
    linhas.push('');
  }
  if (d?.como_medir) linhas.push('COMO MEDIR', d.como_medir, '');
  return linhas.join('\n');
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
export function criarGeo({ db, motores, ia = null, modelo = env.modeloIa, agora = () => new Date() }) {
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
    resumo.sinais = sinaisDeFragilidade(resumo, cfg);
    let rodada = await db.salvarRodadaGeo({
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
    // Diagnóstico e plano de ação pela IA, logo depois da rodada (se falhar, dá para gerar de novo no painel).
    if (ia && resumo.respostas_validas) {
      execucao.etapa = 'diagnostico';
      try {
        rodada = await db.salvarRodadaGeo({ ...rodada, diagnostico: await gerarDiagnostico({ ia, modelo, rodada }) });
      } catch (erro) {
        rodada = await db.salvarRodadaGeo({ ...rodada, diagnostico_erro: String(erro.message).slice(0, 300) });
      }
    }
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

    /** Gera de novo o diagnóstico e o plano de uma rodada. */
    async diagnosticar(id) {
      if (!ia) throw Object.assign(new Error('Falta a chave da IA para gerar o diagnóstico.'), { status: 400 });
      const rodada = await db.obterRodadaGeo(id);
      if (!rodada) throw Object.assign(new Error('Rodada não encontrada.'), { status: 404 });
      const resumo = { ...rodada.resumo, sinais: rodada.resumo.sinais || sinaisDeFragilidade(rodada.resumo, rodada.config) };
      const { diagnostico_erro, ...resto } = rodada;
      return db.salvarRodadaGeo({ ...resto, resumo, diagnostico: await gerarDiagnostico({ ia, modelo, rodada: { ...rodada, resumo } }) });
    },

    async plano(id) {
      const rodada = await db.obterRodadaGeo(id);
      if (!rodada) throw Object.assign(new Error('Rodada não encontrada.'), { status: 404 });
      return planoEmTexto(rodada);
    },

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
