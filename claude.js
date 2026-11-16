import Anthropic from '@anthropic-ai/sdk';
import { env } from './config.js';

let cliente = null;

function obterCliente() {
  if (!env.anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada no .env.');
  }
  cliente ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 180_000 });
  return cliente;
}

/** Modelos que recusaram tool_choice forçado nesta execução. Para eles, a ferramenta é pedida por instrução. */
const semEscolhaForcada = new Set();

const recusouEscolhaForcada = (erro) => erro?.status === 400 && /tool_choice/i.test(String(erro?.message || ''));

function extrair(resposta, ferramenta) {
  return resposta.content.find((b) => b.type === 'tool_use' && b.name === ferramenta.name) || null;
}

/** Resultados de busca na web devolvidos pela API (ferramenta de servidor web_search). */
function resultadosDeBusca(conteudo) {
  const achados = [];
  for (const bloco of conteudo || []) {
    if (bloco.type !== 'web_search_tool_result' || !Array.isArray(bloco.content)) continue;
    for (const r of bloco.content) {
      if (r.type === 'web_search_result' && r.url) achados.push({ url: r.url, titulo: r.title || '', idade: r.page_age || null });
    }
  }
  return achados;
}

/**
 * Chama o Claude e devolve a resposta estruturada pelo schema da ferramenta: { dados, modelo, uso, buscas }.
 *
 * Sem ferramentas de servidor, tenta primeiro obrigar o uso da ferramenta (tool_choice). Modelos mais novos
 * não aceitam isso; nesses, a ferramenta é pedida por instrução, com uma segunda tentativa se vier texto.
 *
 * Com ferramentas de servidor (ex.: busca na web), o modelo precisa de liberdade para pesquisar antes de
 * responder: vai direto no modo automático e continua o turno quando a API pausa (stop_reason pause_turn).
 */
export async function chamarFerramenta({ modelo, sistema, conteudo, ferramenta, maxTokens = 2000, ferramentasServidor = [] }) {
  const api = obterCliente();
  const base = { model: modelo, tools: [...ferramentasServidor, ferramenta], messages: [{ role: 'user', content: conteudo }] };

  if (!ferramentasServidor.length && !semEscolhaForcada.has(modelo)) {
    try {
      const resposta = await api.messages.create({
        ...base,
        max_tokens: maxTokens,
        system: sistema,
        tool_choice: { type: 'tool', name: ferramenta.name },
      });
      const bloco = extrair(resposta, ferramenta);
      if (!bloco) {
        throw new Error(`O modelo não devolveu a estrutura "${ferramenta.name}" (stop_reason: ${resposta.stop_reason}).`);
      }
      return { dados: bloco.input, modelo: resposta.model, uso: resposta.usage, buscas: [] };
    } catch (erro) {
      if (!recusouEscolhaForcada(erro)) throw erro;
      semEscolhaForcada.add(modelo);
    }
  }

  const sistemaComInstrucao = `${sistema}

Formato da resposta: ${ferramentasServidor.length ? 'faça as pesquisas necessárias e depois ' : ''}chame a ferramenta "${ferramenta.name}" exatamente uma vez, com todos os campos obrigatórios. Não escreva nada fora da ferramenta.`;
  const pedido = { ...base, max_tokens: maxTokens + 2000, system: sistemaComInstrucao, tool_choice: { type: 'auto' } };

  let resposta = await api.messages.create({ ...pedido, messages: base.messages });
  let turno = [...resposta.content];
  const buscas = resultadosDeBusca(resposta.content);
  // A API pausa turnos longos de busca: devolve-se o turno acumulado para ela continuar de onde parou.
  for (let i = 0; i < 5 && resposta.stop_reason === 'pause_turn'; i++) {
    resposta = await api.messages.create({ ...pedido, messages: [...base.messages, { role: 'assistant', content: turno }] });
    turno = [...turno, ...resposta.content];
    buscas.push(...resultadosDeBusca(resposta.content));
  }

  let bloco = extrair({ content: turno }, ferramenta);
  if (!bloco) {
    resposta = await api.messages.create({
      ...pedido,
      messages: [
        ...base.messages,
        { role: 'assistant', content: turno },
        { role: 'user', content: `Responda agora chamando a ferramenta "${ferramenta.name}", sem texto fora dela.` },
      ],
    });
    buscas.push(...resultadosDeBusca(resposta.content));
    bloco = extrair(resposta, ferramenta);
  }
  if (!bloco) {
    throw new Error(`O modelo não devolveu a estrutura "${ferramenta.name}" (stop_reason: ${resposta.stop_reason}).`);
  }
  return { dados: bloco.input, modelo: resposta.model, uso: resposta.usage, buscas };
}

/**
 * Faz uma pergunta livre ao Claude com busca na web, como uma pessoa faria, e devolve o texto da resposta
 * e as fontes citadas. Usado pelo radar de visibilidade em IA.
 */
export async function perguntarComBusca({ modelo, pergunta, maxTokens = 1600, maxBuscas = 3 }) {
  const api = obterCliente();
  const pedido = {
    model: modelo,
    max_tokens: maxTokens,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxBuscas }],
    messages: [{ role: 'user', content: pergunta }],
  };
  let resposta = await api.messages.create(pedido);
  let turno = [...resposta.content];
  for (let i = 0; i < 5 && resposta.stop_reason === 'pause_turn'; i++) {
    resposta = await api.messages.create({ ...pedido, messages: [...pedido.messages, { role: 'assistant', content: turno }] });
    turno = [...turno, ...resposta.content];
  }
  const textos = turno.filter((b) => b.type === 'text');
  const citadas = textos.flatMap((b) => (b.citations || []).map((c) => c.url)).filter(Boolean);
  const vistas = resultadosDeBusca(turno).map((r) => r.url);
  return { texto: textos.map((b) => b.text).join(''), fontes: [...new Set(citadas.length ? citadas : vistas)], modelo: resposta.model };
}
