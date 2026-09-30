/**
 * Fotos reais de banco de imagens gratuito (Pexels).
 * Precisa de PEXELS_API_KEY. O crédito do fotógrafo vai para a arte e para a legenda.
 */
import { env } from './config.js';

export function criarBancoDeFotos({ chave = env.pexelsKey } = {}) {
  return {
    provedor: 'pexels',
    disponivel: Boolean(chave),

    /** Busca uma foto vertical para a consulta (em inglês). Evita fotos já usadas na mesma peça. */
    async buscar(consulta, { evitar = [] } = {}) {
      if (!chave) throw new Error('Para usar fotos reais, configure PEXELS_API_KEY no Render.');
      const limpa = String(consulta || '').trim().replace(/\s+/g, ' ');
      const tentativas = [limpa, limpa.split(' ').slice(0, 2).join(' ')].filter((t, i, lista) => t && lista.indexOf(t) === i);
      for (const termo of tentativas) {
        const parametros = new URLSearchParams({ query: termo, orientation: 'portrait', per_page: '15', locale: 'en-US' });
        const resposta = await fetch(`https://api.pexels.com/v1/search?${parametros}`, { headers: { Authorization: chave } });
        if (resposta.status === 401 || resposta.status === 403) throw new Error('A chave do Pexels foi recusada. Confira PEXELS_API_KEY.');
        if (resposta.status === 429) throw new Error('O Pexels limitou as buscas por agora. Tente de novo mais tarde.');
        if (!resposta.ok) throw new Error(`O Pexels respondeu com erro ${resposta.status}.`);
        const dados = await resposta.json();
        const fotos = (dados.photos || []).filter((f) => !evitar.includes(String(f.id)));
        if (!fotos.length) continue;
        const foto = fotos[Math.floor(Math.random() * Math.min(fotos.length, 8))];
        const arquivo = await fetch(foto.src?.large2x || foto.src?.original);
        if (!arquivo.ok) throw new Error(`Não consegui baixar a foto do Pexels (erro ${arquivo.status}).`);
        return {
          buffer: Buffer.from(await arquivo.arrayBuffer()),
          mime: 'image/jpeg',
          id: String(foto.id),
          consulta: termo,
          credito: { autor: foto.photographer || 'autor não informado', url: foto.url || null, fonte: 'Pexels' },
        };
      }
      throw new Error(`Nenhuma foto encontrada no Pexels para "${limpa}". Gere de novo ou escolha outro tipo de imagem.`);
    },
  };
}
