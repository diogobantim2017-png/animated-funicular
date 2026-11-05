/**
 * Banco de imagens da marca: fotos já autorizadas para uso.
 * Ficam na pasta "banco-imagens" do projeto, com qualquer nome, ou na pasta principal com o nome começando por "banco-".
 * O arquivo banco-imagens.json é opcional e traz descrição, temas e crédito de cada foto.
 * Fotos sem descrição podem ser descritas pela IA de uma vez (descreverPendentes); o catálogo completo pode ser
 * baixado e subido no projeto para não precisar descrever de novo.
 * Na hora de gerar, a IA olha as miniaturas e escolhe a foto que mais combina com o post.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { raiz, marca } from './config.js';
import { normalizar } from './util.js';

export const PADRAO_BANCO = /^banco-[\p{L}\p{N}][\p{L}\p{N} ._()-]*\.(jpe?g|png|webp)$/iu;
const IMAGEM = /\.(jpe?g|png|webp)$/i;
export const PASTA_DO_BANCO = 'banco-imagens';
const pasta = () => process.env.BANCO_DIR || raiz;
/** Descrições feitas pela IA enquanto o servidor está ligado (o catálogo baixado guarda de vez). */
const descricoesDaIa = new Map();

const mimeDe = (arquivo) => (/\.png$/i.test(arquivo) ? 'image/png' : /\.webp$/i.test(arquivo) ? 'image/webp' : 'image/jpeg');

async function lerCatalogo() {
  try {
    const bruto = JSON.parse(await fs.readFile(path.join(pasta(), 'banco-imagens.json'), 'utf8'));
    return Array.isArray(bruto) ? bruto : bruto.imagens || [];
  } catch {
    return [];
  }
}

async function arquivosDoBanco() {
  const lista = [];
  try {
    for (const a of await fs.readdir(pasta())) if (PADRAO_BANCO.test(a)) lista.push(a);
  } catch {
    /* pasta principal sem acesso: segue só com a pasta do banco */
  }
  try {
    for (const a of await fs.readdir(path.join(pasta(), PASTA_DO_BANCO))) {
      if (IMAGEM.test(a) && !a.startsWith('.')) lista.push(`${PASTA_DO_BANCO}/${a}`);
    }
  } catch {
    /* ainda não existe a pasta banco-imagens */
  }
  return lista.sort((a, b) => a.localeCompare(b));
}

/** Fotos do banco, com o que o catálogo (ou a IA) diz de cada uma. */
export async function listarBanco() {
  const arquivos = await arquivosDoBanco();
  const catalogo = new Map((await lerCatalogo()).filter((c) => c?.arquivo).map((c) => [c.arquivo, c]));
  return arquivos.map((arquivo) => {
    const c = catalogo.get(arquivo) || catalogo.get(path.basename(arquivo)) || {};
    const daIa = descricoesDaIa.get(arquivo);
    const descricao = String(c.descricao || '').trim();
    const tags = Array.isArray(c.tags) ? c.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    return {
      arquivo,
      descricao: descricao || daIa?.descricao || '',
      tags: tags.length ? tags : daIa?.tags || [],
      descrita_pela_ia: !descricao && Boolean(daIa),
      credito: String(c.credito || '').trim(),
      url: `/banco/${arquivo.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
}

/** Caminho seguro de uma foto do banco: só a pasta banco-imagens ou arquivos banco-*, sem sair do projeto. */
export function caminhoDoBanco(arquivo) {
  const partes = String(arquivo || '').split('/').filter(Boolean);
  if (partes.length === 1 && PADRAO_BANCO.test(partes[0])) return path.join(pasta(), partes[0]);
  if (partes.length === 2 && partes[0] === PASTA_DO_BANCO && IMAGEM.test(partes[1]) && !partes[1].startsWith('.') && !partes[1].includes('..')) {
    return path.join(pasta(), PASTA_DO_BANCO, partes[1]);
  }
  return null;
}

/**
 * A IA olha as fotos ainda sem descrição e escreve descrição e temas de cada uma, em lotes de 8.
 * Devolve quantas descreveu e quantas faltam (o painel chama de novo até acabar).
 */
export async function descreverPendentes({ ia, modelo, limite = 40 }) {
  const pendentes = (await listarBanco()).filter((f) => !f.descricao).slice(0, limite);
  let descritas = 0;
  for (let i = 0; i < pendentes.length; i += 8) {
    const lote = pendentes.slice(i, i + 8);
    const conteudo = [{ type: 'text', text: 'Descreva cada foto do banco de imagens da marca.' }];
    for (const [k, foto] of lote.entries()) {
      const buffer = await fs.readFile(caminhoDoBanco(foto.arquivo));
      conteudo.push({ type: 'text', text: `FOTO ${k}: ${foto.arquivo}` });
      conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await miniatura(buffer, 384)).toString('base64') } });
    }
    const ferramenta = {
      name: 'descrever_fotos',
      description: 'Registra a descrição e os temas de cada foto.',
      input_schema: {
        type: 'object',
        properties: {
          fotos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                indice: { type: 'integer', description: 'Número da foto (FOTO N).' },
                descricao: { type: 'string', description: 'O que a foto mostra, em uma frase objetiva em português (pessoas, lugar, ação, clima).' },
                temas: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'De 3 a 6 temas curtos em português que a foto ilustra bem (ex.: reunião, dados, indústria, atendimento).' },
              },
              required: ['indice', 'descricao', 'temas'],
            },
          },
        },
        required: ['fotos'],
      },
    };
    const sistema = `Você cataloga o banco de imagens da marca ${marca.nome}. Descreva só o que se vê, sem inventar nomes de pessoas, empresas ou lugares.`;
    const r = await ia({ modelo, sistema, conteudo, ferramenta, maxTokens: 1500 });
    for (const item of r.dados?.fotos || []) {
      const foto = lote[Number(item.indice)];
      if (!foto || !String(item.descricao || '').trim()) continue;
      descricoesDaIa.set(foto.arquivo, {
        descricao: String(item.descricao).trim(),
        tags: (item.temas || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 6),
      });
      descritas++;
    }
  }
  const faltam = (await listarBanco()).filter((f) => !f.descricao).length;
  return { descritas, faltam };
}

/** Catálogo completo (do arquivo e da IA), para baixar e subir no projeto como banco-imagens.json. */
export async function catalogoCompleto() {
  const fotos = await listarBanco();
  return {
    observacao: 'Catálogo do banco de imagens. Suba este arquivo na pasta principal do projeto com o nome banco-imagens.json.',
    imagens: fotos.map((f) => ({ arquivo: f.arquivo, descricao: f.descricao, tags: f.tags, credito: f.credito })),
  };
}

const palavras = (t) => new Set(normalizar(String(t || '')).split(/[^a-z0-9]+/).filter((w) => w.length > 3));

async function miniatura(buffer, lado = 512) {
  const img = await loadImage(buffer);
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const c = createCanvas(Math.max(1, Math.round(img.width * escala)), Math.max(1, Math.round(img.height * escala)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.encode('jpeg', 80);
}

/**
 * Escolhe a foto do banco para o post. Devolve { vazio } se o banco não tem fotos,
 * { nenhuma, motivo } se nenhuma combina, ou a foto escolhida com o buffer e o motivo.
 */
export async function escolherDoBanco({ ia, modelo, brief = {}, oportunidade = {}, textos = {}, segmento = null, evitar = [], direcao = null, maximo = 16 }) {
  let todas = await listarBanco();
  if (!todas.length) return { vazio: true };
  // Com muitas fotos sem descrição, a IA descreve antes, para a busca por assunto funcionar.
  if (todas.length > maximo && todas.some((f) => !f.descricao)) {
    await descreverPendentes({ ia, modelo, limite: 200 });
    todas = await listarBanco();
  }
  let candidatas = todas.filter((i) => !evitar.includes(i.arquivo));
  if (!candidatas.length) candidatas = todas;
  if (candidatas.length > maximo) {
    // Com muitas fotos, a IA olha só as mais parecidas com o assunto (pelo nome, descrição e temas).
    const alvo = palavras([oportunidade.tema, brief.cena_visual, brief.busca_foto_en, brief.mensagem_chave, textos.titulo, direcao].join(' '));
    candidatas = candidatas
      .map((i, k) => ({ i, nota: [...palavras(`${i.arquivo} ${i.descricao} ${i.tags.join(' ')}`)].filter((w) => alvo.has(w)).length - k / 1e6 }))
      .sort((a, b) => b.nota - a.nota)
      .slice(0, maximo)
      .map((x) => x.i);
  }
  const conteudo = [
    {
      type: 'text',
      text: `Post para escolher a foto de fundo:
- Tema: ${oportunidade.tema || textos.titulo || ''}
- Título da arte: ${textos.titulo || ''}
- Público: ${segmento?.nome || brief.segmento_id || ''}
- Mensagem-chave: ${brief.mensagem_chave || ''}
- Cena desejada: ${brief.cena_visual || ''}${direcao ? `\n- Pedido da equipe para a imagem: ${direcao}` : ''}

Fotos do banco:`,
    },
  ];
  for (const [k, foto] of candidatas.entries()) {
    const buffer = await fs.readFile(caminhoDoBanco(foto.arquivo));
    conteudo.push({ type: 'text', text: `FOTO ${k}: ${foto.arquivo}${foto.descricao ? `. ${foto.descricao}` : ''}${foto.tags.length ? ` (temas: ${foto.tags.join(', ')})` : ''}` });
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await miniatura(buffer)).toString('base64') } });
  }
  const ferramenta = {
    name: 'escolher_imagem_do_banco',
    description: 'Registra a foto do banco que melhor combina com o post.',
    input_schema: {
      type: 'object',
      properties: {
        indice: { type: 'integer', description: 'Número da foto escolhida (FOTO N), ou -1 se nenhuma combina com o post.' },
        motivo: { type: 'string', description: 'Uma frase, em português, explicando a escolha.' },
      },
      required: ['indice', 'motivo'],
    },
  };
  const sistema = `Você escolhe a foto de fundo de um post do perfil ${marca.nome}. As fotos são do banco de imagens autorizado da marca.
Escolha a que melhor combina com o assunto e com o público do post e que funciona como fundo de arte: sem texto importante na imagem e com área tranquila.
Se nenhuma combinar com o assunto, responda -1: o post sai só com o design da marca. Na dúvida entre duas, prefira a mais simples.`;
  const r = await ia({ modelo, sistema, conteudo, ferramenta, maxTokens: 400 });
  const indice = Number(r.dados?.indice);
  const motivo = String(r.dados?.motivo || '').trim();
  if (!Number.isInteger(indice) || indice < 0 || indice >= candidatas.length) return { nenhuma: true, motivo, modelo: r.modelo };
  const escolhida = candidatas[indice];
  const buffer = await fs.readFile(caminhoDoBanco(escolhida.arquivo));
  return { ...escolhida, buffer, mime: mimeDe(escolhida.arquivo), motivo, modelo: r.modelo, avaliadas: candidatas.length };
}
