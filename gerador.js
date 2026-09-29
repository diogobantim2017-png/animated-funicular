import { env, modeloImagemPadrao } from './config.js';

async function lerJson(resposta) {
  try {
    return await resposta.json();
  } catch {
    return {};
  }
}

async function gerarOpenAI(prompt, modelo) {
  if (!env.openaiKey) throw new Error('OPENAI_API_KEY não configurada no .env.');
  const resposta = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.openaiKey}` },
    body: JSON.stringify({ model: modelo, prompt, size: env.imagemTamanho, quality: env.imagemQualidade, n: 1 }),
    signal: AbortSignal.timeout(240_000),
  });
  const json = await lerJson(resposta);
  if (!resposta.ok) {
    throw new Error(`OpenAI respondeu ${resposta.status}: ${json?.error?.message || 'erro sem detalhe'}`);
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('A OpenAI não devolveu imagem.');
  return { buffer: Buffer.from(b64, 'base64'), mime: 'image/png' };
}

async function gerarGoogle(prompt, modelo) {
  if (!env.googleKey) throw new Error('GOOGLE_API_KEY não configurada no .env.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.googleKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const json = await lerJson(resposta);
  if (!resposta.ok) {
    throw new Error(`Google respondeu ${resposta.status}: ${json?.error?.message || 'erro sem detalhe'}`);
  }
  const parte = json?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
  if (!parte) {
    const motivo = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || 'sem motivo informado';
    throw new Error(`O Google não devolveu imagem (${motivo}).`);
  }
  return { buffer: Buffer.from(parte.inlineData.data, 'base64'), mime: parte.inlineData.mimeType || 'image/png' };
}

/** Provedor configurado no .env. Para outro provedor (ex.: Adobe Firefly), basta seguir a mesma interface. */
export function criarGeradorImagem() {
  const modelo = modeloImagemPadrao();
  const provedor = env.imagemProvedor;
  return {
    provedor,
    modelo,
    async gerar(prompt) {
      if (provedor === 'google') return gerarGoogle(prompt, modelo);
      if (provedor === 'openai') return gerarOpenAI(prompt, modelo);
      throw new Error(`IMAGEM_PROVEDOR "${provedor}" não é suportado. Use openai ou google.`);
    },
  };
}
