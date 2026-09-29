import Anthropic from '@anthropic-ai/sdk';
import { env } from './config.js';

let cliente = null;

function obterCliente() {
  if (!env.anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada no .env.');
  }
  cliente ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 120_000 });
  return cliente;
}

/** Modelos que recusaram tool_choice forçado nesta execução. Para eles, a ferramenta é pedida por instrução. */
const semEscolhaForcada = new Set();

const recusouEscolhaForcada = (erro) => erro?.status === 400 && /tool_choice/i.test(String(erro?.message || ''));

function extrair(resposta, ferramenta) {
  return resposta.content.find((b) => b.type === 'tool_use' && b.name === ferramenta.name) || null;
}

/**
 * Chama o Claude e devolve a resposta estruturada pelo schema da ferramenta: { dados, modelo, uso }.
 * Primeiro tenta obrigar o uso da ferramenta (tool_choice). Modelos mais novos não aceitam isso; nesses,
 * a ferramenta é pedida por instrução com tool_choice automático, com uma segunda tentativa se o modelo
 * responder em texto.
 */
export async function chamarFerramenta({ modelo, sistema, conteudo, ferramenta, maxTokens = 2000 }) {
  const api = obterCliente();
  const base = { model: modelo, tools: [ferramenta], messages: [{ role: 'user', content: conteudo }] };

  if (!semEscolhaForcada.has(modelo)) {
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
      return { dados: bloco.input, modelo: resposta.model, uso: resposta.usage };
    } catch (erro) {
      if (!recusouEscolhaForcada(erro)) throw erro;
      semEscolhaForcada.add(modelo);
    }
  }

  const sistemaComInstrucao = `${sistema}

Formato da resposta: chame a ferramenta "${ferramenta.name}" exatamente uma vez, com todos os campos obrigatórios. Não escreva nada fora da ferramenta.`;
  const pedido = {
    ...base,
    max_tokens: maxTokens + 2000,
    system: sistemaComInstrucao,
    tool_choice: { type: 'auto' },
  };

  let resposta = await api.messages.create(pedido);
  let bloco = extrair(resposta, ferramenta);
  if (!bloco) {
    resposta = await api.messages.create({
      ...pedido,
      messages: [
        ...base.messages,
        { role: 'assistant', content: resposta.content },
        { role: 'user', content: `Responda agora chamando a ferramenta "${ferramenta.name}", sem texto fora dela.` },
      ],
    });
    bloco = extrair(resposta, ferramenta);
  }
  if (!bloco) {
    throw new Error(`O modelo não devolveu a estrutura "${ferramenta.name}" (stop_reason: ${resposta.stop_reason}).`);
  }
  return { dados: bloco.input, modelo: resposta.model, uso: resposta.usage };
}
