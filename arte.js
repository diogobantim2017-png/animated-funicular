import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { marca, politica, raiz } from './config.js';

export const LARGURA = 1080;
export const ALTURA = 1350;

const MARGEM = 56;
const RESPIRO = 56;
const LARGURA_CARD = LARGURA - MARGEM * 2;
const LARGURA_TEXTO = LARGURA_CARD - RESPIRO * 2;
const ALTURA_MAX_CARD = Math.round(ALTURA * 0.62);

let fontesProntas = false;

function registrarFontes() {
  if (fontesProntas) return;
  const familias = {
    'Marca Titulo': marca.fontes.titulo,
    'Marca Destaque': marca.fontes.destaque,
    'Marca Texto': marca.fontes.texto,
  };
  for (const [familia, relativo] of Object.entries(familias)) {
    const caminho = path.resolve(raiz, relativo);
    if (!fs.existsSync(caminho)) throw new Error(`Fonte da marca não encontrada: ${relativo}`);
    GlobalFonts.registerFromPath(caminho, familia);
  }
  fontesProntas = true;
}

function quebrarLinhas(ctx, texto, larguraMax) {
  const palavras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (ctx.measureText(tentativa).width <= larguraMax) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    if (ctx.measureText(palavra).width <= larguraMax) {
      atual = palavra;
      continue;
    }
    let pedaco = '';
    for (const letra of palavra) {
      if (ctx.measureText(pedaco + letra).width > larguraMax) {
        linhas.push(pedaco);
        pedaco = letra;
      } else {
        pedaco += letra;
      }
    }
    atual = pedaco;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Reduz a fonte até caber no número de linhas. Nunca corta texto: se não couber, sinaliza. */
function ajustarBloco(ctx, texto, { familia, maximo, minimo, maxLinhas, entrelinha }) {
  let resultado = null;
  for (let tamanho = maximo; tamanho >= minimo; tamanho -= 2) {
    ctx.font = `${tamanho}px "${familia}"`;
    const linhas = quebrarLinhas(ctx, texto, LARGURA_TEXTO);
    resultado = { familia, tamanho, linhas, entrelinha, coube: linhas.length <= maxLinhas };
    if (resultado.coube) return resultado;
  }
  return resultado;
}

function alturaBloco(bloco) {
  return bloco.linhas.length * bloco.tamanho * bloco.entrelinha;
}

function desenharBloco(ctx, bloco, x, y, cor) {
  ctx.font = `${bloco.tamanho}px "${bloco.familia}"`;
  ctx.fillStyle = cor;
  ctx.textBaseline = 'alphabetic';
  const altLinha = bloco.tamanho * bloco.entrelinha;
  bloco.linhas.forEach((linha, i) => {
    const base = y + i * altLinha + altLinha / 2 + bloco.tamanho * 0.36;
    ctx.fillText(linha, x, base);
  });
  return y + alturaBloco(bloco);
}

async function desenharAssinatura(ctx) {
  const altura = 76;
  if (marca.logo) {
    const logo = await loadImage(path.resolve(raiz, marca.logo));
    const largLogo = (logo.width / logo.height) * (altura - 28);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(MARGEM, MARGEM, largLogo + 56, altura, altura / 2);
    ctx.fill();
    ctx.drawImage(logo, MARGEM + 28, MARGEM + 14, largLogo, altura - 28);
    return;
  }
  ctx.font = '30px "Marca Titulo"';
  const largura = ctx.measureText(marca.nome).width + 56;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(MARGEM, MARGEM, Math.min(largura, LARGURA - MARGEM * 2), altura, altura / 2);
  ctx.fill();
  ctx.fillStyle = marca.cores.primaria;
  ctx.textBaseline = 'middle';
  ctx.fillText(marca.nome, MARGEM + 28, MARGEM + altura / 2 + 2, LARGURA - MARGEM * 2 - 56);
}

/**
 * Compõe a arte final. A IA só fornece o fundo e os textos de marketing;
 * logo, oferta, texto legal e rótulo de IA vêm de configuração oficial.
 */
export async function renderizarArte({ fundo, textos, oferta }) {
  registrarFontes();
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');

  const imagem = await loadImage(fundo);
  const escala = Math.max(LARGURA / imagem.width, ALTURA / imagem.height);
  const w = imagem.width * escala;
  const h = imagem.height * escala;
  ctx.drawImage(imagem, (LARGURA - w) / 2, (ALTURA - h) * 0.3, w, h);

  const titulo = ajustarBloco(ctx, textos.titulo, { familia: 'Marca Titulo', maximo: 72, minimo: 50, maxLinhas: 3, entrelinha: 1.12 });
  const subtitulo = ajustarBloco(ctx, textos.subtitulo, { familia: 'Marca Texto', maximo: 36, minimo: 28, maxLinhas: 3, entrelinha: 1.35 });
  const destaque = oferta?.destaque
    ? ajustarBloco(ctx, oferta.destaque, { familia: 'Marca Destaque', maximo: 34, minimo: 26, maxLinhas: 2, entrelinha: 1.3 })
    : null;
  const legal = [oferta?.texto_legal, politica.rotulo_ia].filter(Boolean).join(' ');
  const blocoLegal = legal
    ? ajustarBloco(ctx, legal, { familia: 'Marca Texto', maximo: 22, minimo: 18, maxLinhas: 4, entrelinha: 1.4 })
    : null;

  ctx.font = '32px "Marca Destaque"';
  const textoCta = String(textos.cta_arte || '').trim();
  const larguraCta = Math.min(ctx.measureText(textoCta).width + 80, LARGURA_TEXTO);
  const alturaCta = 80;

  let conteudo = alturaBloco(titulo) + 20 + alturaBloco(subtitulo);
  if (destaque) conteudo += 28 + 2 + 20 + alturaBloco(destaque);
  conteudo += 36 + alturaCta;
  if (blocoLegal) conteudo += 28 + alturaBloco(blocoLegal);
  const alturaCard = conteudo + RESPIRO * 2;
  const topoCard = ALTURA - MARGEM - alturaCard;

  ctx.fillStyle = marca.cores.primaria;
  ctx.beginPath();
  ctx.roundRect(MARGEM, topoCard, LARGURA_CARD, alturaCard, 40);
  ctx.fill();

  const x = MARGEM + RESPIRO;
  let y = topoCard + RESPIRO;
  y = desenharBloco(ctx, titulo, x, y, marca.cores.texto_sobre_primaria);
  y += 20;
  ctx.globalAlpha = 0.92;
  y = desenharBloco(ctx, subtitulo, x, y, marca.cores.texto_sobre_primaria);
  ctx.globalAlpha = 1;

  if (destaque) {
    y += 28;
    ctx.fillStyle = marca.cores.secundaria;
    ctx.fillRect(x, y, 96, 2);
    y += 2 + 20;
    y = desenharBloco(ctx, destaque, x, y, marca.cores.secundaria);
  }

  y += 36;
  ctx.fillStyle = marca.cores.secundaria;
  ctx.beginPath();
  ctx.roundRect(x, y, larguraCta, alturaCta, alturaCta / 2);
  ctx.fill();
  ctx.font = '32px "Marca Destaque"';
  ctx.fillStyle = marca.cores.texto_sobre_secundaria;
  ctx.textBaseline = 'middle';
  ctx.fillText(textoCta, x + 40, y + alturaCta / 2 + 2, larguraCta - 80);
  y += alturaCta;

  if (blocoLegal) {
    y += 28;
    ctx.globalAlpha = 0.82;
    desenharBloco(ctx, blocoLegal, x, y, marca.cores.texto_sobre_primaria);
    ctx.globalAlpha = 1;
  }

  await desenharAssinatura(ctx);

  const transbordou =
    !titulo.coube || !subtitulo.coube || (destaque && !destaque.coube) || (blocoLegal && !blocoLegal.coube) || alturaCard > ALTURA_MAX_CARD;

  return {
    buffer: await canvas.encode('jpeg', 90),
    largura: LARGURA,
    altura: ALTURA,
    ajustes: {
      tamanho_titulo: titulo.tamanho,
      tamanho_subtitulo: subtitulo.tamanho,
      altura_card: Math.round(alturaCard),
      transbordou: Boolean(transbordou),
    },
  };
}
