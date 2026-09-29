import { env } from './config.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function graph(metodo, url, corpo) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${env.igToken}`,
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  let json = {};
  try {
    json = await resposta.json();
  } catch {
    json = {};
  }
  if (!resposta.ok || json.error) {
    throw new Error(`Instagram API (${resposta.status}): ${json.error?.message || 'erro sem detalhe'}`);
  }
  return json;
}

async function aguardarContainer(base, containerId) {
  for (let tentativa = 0; tentativa < 12; tentativa++) {
    const { status_code: status } = await graph('GET', `${base}/${containerId}?fields=status_code`);
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`O Instagram recusou a mídia (status ${status}).`);
    await esperar(3000);
  }
  throw new Error('O Instagram demorou demais para processar a mídia.');
}

export function criarCanalInstagram() {
  return {
    nome: 'instagram',
    modo: env.publicacaoModo,
    async publicar({ urlImagem, legenda }) {
      if (env.publicacaoModo !== 'real') {
        return {
          modo: 'simulacao',
          id: null,
          permalink: null,
          observacao: 'Publicação simulada. Nada foi enviado ao Instagram. Use PUBLICACAO_MODO=real para publicar.',
        };
      }
      if (!env.igUserId || !env.igToken) throw new Error('Configure IG_USER_ID e IG_ACCESS_TOKEN para publicar.');
      if (!/^https:\/\//.test(urlImagem || '')) {
        throw new Error('A imagem precisa de uma URL pública em https para o Instagram baixar. Veja PUBLIC_BASE_URL ou ARMAZENAMENTO=supabase.');
      }
      const base = `https://${env.metaHost}/${env.metaVersao}`;
      const container = await graph('POST', `${base}/${env.igUserId}/media`, { image_url: urlImagem, caption: legenda });
      await aguardarContainer(base, container.id);
      const publicado = await graph('POST', `${base}/${env.igUserId}/media_publish`, { creation_id: container.id });
      let permalink = null;
      try {
        permalink = (await graph('GET', `${base}/${publicado.id}?fields=permalink`)).permalink || null;
      } catch {
        permalink = null;
      }
      return { modo: 'real', id: publicado.id, container_id: container.id, permalink };
    },
  };
}
