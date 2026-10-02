/**
 * Fotos reais para a capa, de duas fontes, na ordem definida em politica.fotos.provedores:
 *
 * - wikimedia: Wikimedia Commons, o banco de mídia livre da Wikipédia. Tem fotos reais de pilotos, carros e
 *   circuitos com licença livre (domínio público, CC0, CC BY, CC BY-SA). Não precisa de chave. Por ser foto
 *   editorial de pessoas e marcas reais, a peça sempre passa por revisão humana (ver politica.visao_foto_editorial).
 * - pexels: banco gratuito de fotos genéricas. Precisa de PEXELS_API_KEY.
 *
 * O crédito (autor, fonte e licença) vai para a arte e para a legenda.
 */
import { env, politica } from './config.js';

const AGENTE = 'MotorDeCampanhas/1.0 (painel de campanhas; contato pelo site do perfil)';
const LICENCAS_LIVRES = /^(cc0|public domain|pd\b.*|cc[ -]by(-sa)?([ -][\d.]+)?)$/i;

const semHtml = (valor = '') =>
  String(valor)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function criarWikimedia({ buscarNaRede = fetch } = {}) {
  return {
    nome: 'wikimedia',
    fonte: 'Wikimedia Commons',
    disponivel: true,
    async buscar(consulta, { evitar = [] } = {}) {
      const limpa = String(consulta || '').trim().replace(/\s+/g, ' ');
      const tentativas = [limpa, limpa.split(' ').slice(0, 3).join(' ')].filter((t, i, l) => t && l.indexOf(t) === i);
      for (const termo of tentativas) {
        const parametros = new URLSearchParams({
          action: 'query',
          format: 'json',
          formatversion: '2',
          generator: 'search',
          gsrsearch: `${termo} filetype:bitmap`,
          gsrnamespace: '6',
          gsrlimit: '25',
          prop: 'imageinfo',
          iiprop: 'url|size|mime|extmetadata',
          iiurlwidth: '1400',
          iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Restrictions',
          origin: '*',
        });
        const resposta = await buscarNaRede(`https://commons.wikimedia.org/w/api.php?${parametros}`, { headers: { 'User-Agent': AGENTE } });
        if (!resposta.ok) throw new Error(`O Wikimedia Commons respondeu com erro ${resposta.status}.`);
        const dados = await resposta.json();
        const candidatas = (dados.query?.pages || [])
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((p) => ({ pagina: p, info: p.imageinfo?.[0] }))
          .filter(({ pagina, info }) => {
            if (!info || evitar.includes(`wikimedia:${pagina.pageid}`)) return false;
            if (!/^image\/(jpeg|png)$/.test(info.mime || '')) return false;
            if (Math.min(info.width || 0, info.height || 0) < 800) return false;
            const licenca = semHtml(info.extmetadata?.LicenseShortName?.value);
            return LICENCAS_LIVRES.test(licenca);
          });
        if (!candidatas.length) continue;
        const { pagina, info } = candidatas[Math.floor(Math.random() * Math.min(candidatas.length, 5))];
        const arquivo = await buscarNaRede(info.thumburl || info.url, { headers: { 'User-Agent': AGENTE } });
        if (!arquivo.ok) throw new Error(`Não consegui baixar a foto do Wikimedia Commons (erro ${arquivo.status}).`);
        const meta = info.extmetadata || {};
        const licenca = semHtml(meta.LicenseShortName?.value);
        return {
          buffer: Buffer.from(await arquivo.arrayBuffer()),
          mime: info.thumbmime || info.mime || 'image/jpeg',
          id: `wikimedia:${pagina.pageid}`,
          consulta: termo,
          editorial: true,
          credito: {
            autor: semHtml(meta.Artist?.value).slice(0, 80) || 'autor não informado',
            fonte: 'Wikimedia Commons',
            licenca,
            url_licenca: semHtml(meta.LicenseUrl?.value) || null,
            url: info.descriptionurl || null,
            compartilha_igual: /-sa\b/i.test(licenca),
          },
        };
      }
      return null;
    },
  };
}

function criarPexels({ chave, buscarNaRede = fetch } = {}) {
  return {
    nome: 'pexels',
    fonte: 'Pexels',
    disponivel: Boolean(chave),
    async buscar(consulta, { evitar = [] } = {}) {
      if (!chave) return null;
      const limpa = String(consulta || '').trim().replace(/\s+/g, ' ');
      const tentativas = [limpa, limpa.split(' ').slice(0, 2).join(' ')].filter((t, i, lista) => t && lista.indexOf(t) === i);
      for (const termo of tentativas) {
        const parametros = new URLSearchParams({ query: termo, orientation: 'portrait', per_page: '15', locale: 'en-US' });
        const resposta = await buscarNaRede(`https://api.pexels.com/v1/search?${parametros}`, { headers: { Authorization: chave } });
        if (resposta.status === 401 || resposta.status === 403) throw new Error('A chave do Pexels foi recusada. Confira PEXELS_API_KEY.');
        if (resposta.status === 429) throw new Error('O Pexels limitou as buscas por agora. Tente de novo mais tarde.');
        if (!resposta.ok) throw new Error(`O Pexels respondeu com erro ${resposta.status}.`);
        const dados = await resposta.json();
        const fotos = (dados.photos || []).filter((f) => !evitar.includes(String(f.id)));
        if (!fotos.length) continue;
        const foto = fotos[Math.floor(Math.random() * Math.min(fotos.length, 8))];
        const arquivo = await buscarNaRede(foto.src?.large2x || foto.src?.original);
        if (!arquivo.ok) throw new Error(`Não consegui baixar a foto do Pexels (erro ${arquivo.status}).`);
        return {
          buffer: Buffer.from(await arquivo.arrayBuffer()),
          mime: 'image/jpeg',
          id: String(foto.id),
          consulta: termo,
          editorial: false,
          credito: { autor: foto.photographer || 'autor não informado', url: foto.url || null, fonte: 'Pexels' },
        };
      }
      return null;
    },
  };
}

export function criarBancoDeFotos({ chave = env.pexelsKey, buscarNaRede = fetch, provedores = politica.fotos?.provedores || ['pexels'] } = {}) {
  const todos = { wikimedia: criarWikimedia({ buscarNaRede }), pexels: criarPexels({ chave, buscarNaRede }) };
  const lista = provedores.map((n) => todos[n]).filter(Boolean);
  const ativos = lista.filter((p) => p.disponivel);
  return {
    provedor: ativos.map((p) => p.nome).join('+') || 'nenhum',
    fontes: ativos.map((p) => p.fonte),
    disponivel: ativos.length > 0,

    /** Busca uma foto para a consulta (em inglês), na ordem dos provedores. Evita fotos já usadas na mesma peça. */
    async buscar(consulta, { evitar = [] } = {}) {
      if (!ativos.length) throw new Error('Para usar fotos reais, configure PEXELS_API_KEY no Render ou ligue o Wikimedia Commons na política.');
      for (const p of ativos) {
        const foto = await p.buscar(consulta, { evitar });
        if (foto) return { ...foto, provedor: p.nome };
      }
      throw new Error(`Nenhuma foto encontrada em ${ativos.map((p) => p.fonte).join(' ou ')} para "${consulta}". Gere de novo ou escolha outro tipo de imagem.`);
    },
  };
}
