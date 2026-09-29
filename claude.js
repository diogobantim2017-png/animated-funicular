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

/**
 * Chama o Claude obrigando o uso de uma ferramenta, o que garante resposta em JSON
 * validado pelo schema. Retorna { dados, modelo, uso }.
 */
export async function chamarFerramenta({ modelo, sistema, conteudo, ferramenta, maxTokens = 2000 }) {
  const resposta = await obterCliente().messages.create({
    model: modelo,
    max_tokens: maxTokens,
    system: sistema,
    tools: [ferramenta],
    tool_choice: { type: 'tool', name: ferramenta.name },
    messages: [{ role: 'user', content: conteudo }],
  });
  const bloco = resposta.content.find((b) => b.type === 'tool_use');
  if (!bloco) {
    throw new Error(`O modelo não devolveu a estrutura "${ferramenta.name}" (stop_reason: ${resposta.stop_reason}).`);
  }
  return { dados: bloco.input, modelo: resposta.model, uso: resposta.usage };
}
