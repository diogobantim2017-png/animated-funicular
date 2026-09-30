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

let idDescoberto = '';

/** ID da conta profissional. Se IG_USER_ID não foi preenchido, descobre pelo próprio token (login do Instagram). */
async function idDaConta(base) {
  if (env.igUserId) return env.igUserId;
  if (idDescoberto) return idDescoberto;
  const eu = await graph('GET', `${base}/me?fields=user_id,username`);
  idDescoberto = String(eu.user_id || eu.id || '');
  if (!idDescoberto) throw new Error('Não consegui descobrir a conta do Instagram pelo token. Preencha IG_USER_ID.');
  return idDescoberto;
}

/** Confere se o token funciona e qual conta ele representa. Não publica nada. */
export async function verificarConexaoInstagram() {
  if (!env.igToken) return { ok: false, erro: 'falta a variável IG_ACCESS_TOKEN.' };
  try {
    const base = `https://${env.metaHost}/${env.metaVersao}`;
    const eu = await graph('GET', `${base}/me?fields=user_id,username`);
    if (!env.igUserId) idDescoberto = String(eu.user_id || eu.id || '');
    return { ok: true, usuario: eu.username || null, id: env.igUserId || idDescoberto };
  } catch (erro) {
    return { ok: false, erro: `o token não funcionou (${erro.message}). Gere um novo no site da Meta e troque IG_ACCESS_TOKEN no Render.` };
  }
}

export function criarCanalInstagram() {
  return {
    nome: 'instagram',
    modo: env.publicacaoModo,
    async publicar({ urlImagem, urlsImagens = null, legenda }) {
      const itens = urlsImagens?.length > 1 ? urlsImagens.slice(0, 10) : null;
      if (env.publicacaoModo !== 'real') {
        return {
          modo: 'simulacao',
          id: null,
          permalink: null,
          itens: itens?.length || 1,
          observacao: 'Publicação simulada. Nada foi enviado ao Instagram. Use PUBLICACAO_MODO=real para publicar.',
        };
      }
      if (!env.igToken) throw new Error('Configure IG_ACCESS_TOKEN para publicar.');
      if ((itens || [urlImagem]).some((u) => !/^https:\/\//.test(u || ''))) {
        throw new Error('A imagem precisa de uma URL pública em https para o Instagram baixar. Veja PUBLIC_BASE_URL ou ARMAZENAMENTO=supabase.');
      }
      const base = `https://${env.metaHost}/${env.metaVersao}`;
      const conta = await idDaConta(base);
      let container;
      if (itens) {
        // Carrossel: um contêiner por imagem, depois o contêiner do carrossel com a legenda.
        const filhos = [];
        for (const url of itens) {
          const filho = await graph('POST', `${base}/${conta}/media`, { image_url: url, is_carousel_item: true });
          await aguardarContainer(base, filho.id);
          filhos.push(filho.id);
        }
        container = await graph('POST', `${base}/${conta}/media`, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda });
      } else {
        container = await graph('POST', `${base}/${conta}/media`, { image_url: urlImagem, caption: legenda });
      }
      await aguardarContainer(base, container.id);
      const publicado = await graph('POST', `${base}/${conta}/media_publish`, { creation_id: container.id });
      let permalink = null;
      try {
        permalink = (await graph('GET', `${base}/${publicado.id}?fields=permalink`)).permalink || null;
      } catch {
        permalink = null;
      }
      return { modo: 'real', id: publicado.id, container_id: container.id, permalink, itens: itens?.length || 1 };
    },
  };
}
