import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { marca, politica, raiz } from './config.js';
import { normalizarDesign, temNumeracaoPropria } from './formatos.js';

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
  // Evita palavra sozinha na última linha: traz uma palavra da linha de cima quando cabe.
  if (linhas.length >= 2) {
    const ultima = linhas[linhas.length - 1];
    const anterior = linhas[linhas.length - 2].split(' ');
    if (!ultima.includes(' ') && anterior.length >= 3) {
      const juntas = `${anterior[anterior.length - 1]} ${ultima}`;
      if (ctx.measureText(juntas).width <= larguraMax) {
        linhas[linhas.length - 2] = anterior.slice(0, -1).join(' ');
        linhas[linhas.length - 1] = juntas;
      }
    }
  }
  return linhas;
}

/** Reduz a fonte até caber no número de linhas. Nunca corta texto: se não couber, sinaliza. */
function ajustarBloco(ctx, texto, { familia, maximo, minimo, maxLinhas, entrelinha, largura = LARGURA_TEXTO }) {
  let resultado = null;
  for (let tamanho = maximo; tamanho >= minimo; tamanho -= 2) {
    ctx.font = `${tamanho}px "${familia}"`;
    const linhas = quebrarLinhas(ctx, texto, largura);
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
export async function renderizarArte({ fundo, textos, oferta, visual = 'ia', credito = null, semente = 1, design = {} }) {
  registrarFontes();
  const d = normalizarDesign(design);
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');

  if (fundo) {
    const imagem = await loadImage(fundo);
    const escala = Math.max(LARGURA / imagem.width, ALTURA / imagem.height);
    const w = imagem.width * escala;
    const h = imagem.height * escala;
    ctx.drawImage(imagem, (LARGURA - w) / 2, (ALTURA - h) * 0.3, w, h);
  } else {
    desenharFundoDesign(ctx, semente, d);
  }

  const titulo = ajustarBloco(ctx, textos.titulo, { familia: 'Marca Titulo', maximo: d.texto_maior ? 82 : 72, minimo: 50, maxLinhas: 3, entrelinha: 1.12 });
  const subtitulo = ajustarBloco(ctx, textos.subtitulo, { familia: 'Marca Texto', maximo: d.texto_maior ? 41 : 36, minimo: 28, maxLinhas: 3, entrelinha: 1.35 });
  const destaque = oferta?.destaque
    ? ajustarBloco(ctx, oferta.destaque, { familia: 'Marca Destaque', maximo: 34, minimo: 26, maxLinhas: 2, entrelinha: 1.3 })
    : null;
  const legal = [oferta?.texto_legal, visual === 'ia' && fundo ? politica.rotulo_ia : null, textoDoCredito(visual, credito)]
    .filter(Boolean)
    .join(' ');
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

  // Em fundo escuro sem imagem, o painel fica um tom abaixo para não sumir no fundo.
  ctx.fillStyle = !fundo && d.fundo === 'escuro' ? misturar(marca.cores.primaria, '#000000', 0.35) : marca.cores.primaria;
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

/* ------------------------------------------------------ design sem imagem */

function hexParaRgb(hex) {
  const limpo = String(hex).replace('#', '');
  const cheio = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  return [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16));
}

/** Mistura duas cores; peso é a proporção da segunda. */
function misturar(cor, outra, peso) {
  const a = hexParaRgb(cor);
  const b = hexParaRgb(outra);
  return `rgb(${a.map((v, i) => Math.round(v * (1 - peso) + b[i] * peso)).join(', ')})`;
}

/** Sequência pseudoaleatória estável: a mesma semente sempre gera o mesmo desenho. */
function sorteador(semente) {
  let t = Math.abs(Math.floor(semente)) || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const textoDoCredito = (visual, credito) => (visual === 'foto' && credito?.autor ? `Foto: ${credito.autor} / ${credito.fonte || 'Pexels'}.` : null);

/** Fundo feito só com as cores da marca: formas geométricas, sem pessoas nem objetos. */
function desenharFundoDesign(ctx, semente = 1, d = normalizarDesign()) {
  const r = sorteador(semente);
  const { primaria, secundaria } = marca.cores;
  const escuro = d.fundo === 'escuro';
  ctx.fillStyle = escuro ? primaria : misturar(secundaria, '#FFFFFF', 0.78);
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  if (d.formas === 'nenhuma') return;

  ctx.globalAlpha = escuro ? 0.35 : 0.6;
  ctx.fillStyle = secundaria;
  ctx.beginPath();
  ctx.arc(LARGURA * (0.6 + r() * 0.3), 250 + r() * 160, 230 + r() * 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (d.formas === 'poucas') return;

  const contraste = escuro ? '#FFFFFF' : primaria;
  ctx.globalAlpha = escuro ? 0.07 : 0.12;
  ctx.fillStyle = contraste;
  ctx.beginPath();
  ctx.arc(LARGURA * (0.08 + r() * 0.25), 420 + r() * 140, 170 + r() * 80, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = escuro ? secundaria : primaria;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(LARGURA * (0.3 + r() * 0.3), 330 + r() * 120, 56 + r() * 40, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = escuro ? 0.25 : 0.35;
  ctx.fillStyle = contraste;
  const ox = 90 + r() * 560;
  const oy = 190 + r() * 180;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.arc(ox + i * 34, oy + j * 34, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/* --------------------------------------------------- carrossel e flashcards */

const LARGURA_SLIDE = LARGURA - MARGEM * 2 - 40;

function desenharContador(ctx, texto, cor) {
  ctx.font = '30px "Marca Destaque"';
  ctx.fillStyle = cor;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, LARGURA - MARGEM, MARGEM + 40);
  ctx.textAlign = 'left';
}

function desenharPontos(ctx, atual, total, cor) {
  const espaco = 30;
  const inicio = LARGURA / 2 - ((total - 1) * espaco) / 2;
  for (let i = 0; i < total; i++) {
    ctx.globalAlpha = i + 1 === atual ? 1 : 0.28;
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(inicio + i * espaco, ALTURA - 64, i + 1 === atual ? 10 : 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function barra(ctx, x, y, cor, largura = 110) {
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.roundRect(x, y, largura, 12, 6);
  ctx.fill();
}

/** Escolhe o maior tamanho de letra em que título e texto cabem juntos na área disponível. */
function ajustarPar(ctx, { area, largura, ...opcoes }) {
  const escalas = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6];
  let ultimo = null;
  for (const e of escalas) {
    const bt = ajustarBloco(ctx, opcoes.textoTitulo, { familia: 'Marca Titulo', maximo: Math.round(opcoes.maxTitulo * e), minimo: 40, maxLinhas: 4, entrelinha: 1.1, largura });
    const bx = ajustarBloco(ctx, opcoes.textoCorpo, { familia: 'Marca Texto', maximo: Math.round(opcoes.maxCorpo * e), minimo: 26, maxLinhas: 12, entrelinha: 1.42, largura });
    const altura = opcoes.extra + alturaBloco(bt) + opcoes.entre + alturaBloco(bx);
    ultimo = { bt, bx, altura, coube: bt.coube && bx.coube && altura <= area };
    if (ultimo.coube) return ultimo;
  }
  return ultimo;
}

/** Cores de um slide conforme o fundo pedido: claro (tom suave da marca) ou escuro (cor principal). */
function paleta(escuro) {
  const { primaria, secundaria } = marca.cores;
  return escuro
    ? { fundo: primaria, texto: marca.cores.texto_sobre_primaria, destaque: secundaria, detalhe: secundaria }
    : { fundo: misturar(secundaria, '#FFFFFF', 0.86), texto: primaria, destaque: secundaria, detalhe: primaria };
}

async function slideConteudo({ titulo, texto, numero, total, design }) {
  const d = normalizarDesign(design);
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const cor = paleta(d.fundo === 'escuro');
  ctx.fillStyle = cor.fundo;
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  if (d.formas !== 'nenhuma') {
    ctx.globalAlpha = d.fundo === 'escuro' ? 0.5 : 0.85;
    ctx.fillStyle = cor.destaque;
    ctx.beginPath();
    ctx.arc(LARGURA + 40, ALTURA + 20, 200, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  await desenharAssinatura(ctx);
  if (d.contador) desenharContador(ctx, `${numero}/${total}`, cor.detalhe);

  // Número grande decorativo: só quando o título não traz numeração própria, para não confundir.
  const mostrarNumero = d.numeros_grandes === 'sim' || (d.numeros_grandes === 'auto' && !temNumeracaoPropria(titulo));
  const x = MARGEM + 20;
  const topo = 190;
  const base = ALTURA - 130;
  const alturaNumero = mostrarNumero ? 132 : 0;
  const par = ajustarPar(ctx, {
    textoTitulo: titulo,
    textoCorpo: texto,
    area: base - topo,
    largura: LARGURA_SLIDE,
    maxTitulo: d.texto_maior ? 94 : 84,
    maxCorpo: d.texto_maior ? 57 : 50,
    extra: mostrarNumero ? alturaNumero + 24 : 0,
    entre: 36,
  });
  let y = topo + Math.max(0, (base - topo - par.altura) / 2);
  if (mostrarNumero) {
    ctx.font = '132px "Marca Titulo"';
    ctx.fillStyle = cor.detalhe;
    ctx.globalAlpha = d.fundo === 'escuro' ? 0.35 : 0.22;
    ctx.textBaseline = 'top';
    ctx.fillText(String(numero - 1).padStart(2, '0'), x - 6, y);
    ctx.globalAlpha = 1;
    y += alturaNumero + 24;
  }
  y = desenharBloco(ctx, par.bt, x, y, cor.texto);
  y += 36;
  ctx.globalAlpha = 0.92;
  desenharBloco(ctx, par.bx, x, y, cor.texto);
  ctx.globalAlpha = 1;
  if (d.pontos) desenharPontos(ctx, numero, total, cor.detalhe);
  return { buffer: await canvas.encode('jpeg', 90), coube: par.coube };
}

async function slideCartao({ titulo, texto, numero, total, cartao, cartoes, design }) {
  const d = normalizarDesign(design);
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const { primaria, secundaria } = marca.cores;
  // Nos cartões, o padrão é fundo escuro com o cartão branco em destaque.
  const escuro = d.fundo !== 'claro';
  const cor = paleta(escuro);
  ctx.fillStyle = cor.fundo;
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  if (d.formas === 'normal' && !escuro) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = secundaria;
    ctx.beginPath();
    ctx.arc(LARGURA + 40, ALTURA + 20, 200, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  await desenharAssinatura(ctx);
  if (d.contador) desenharContador(ctx, `${numero}/${total}`, escuro ? secundaria : primaria);

  const topo = 190;
  const alturaCartao = ALTURA - topo - 170;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(MARGEM, topo, LARGURA - MARGEM * 2, alturaCartao, 48);
  ctx.fill();
  if (!escuro) {
    ctx.strokeStyle = misturar(primaria, '#FFFFFF', 0.8);
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const x = MARGEM + 56;
  const largura = LARGURA - MARGEM * 2 - 112;
  if (d.contador) {
    ctx.font = '26px "Marca Destaque"';
    ctx.fillStyle = primaria;
    ctx.globalAlpha = 0.7;
    ctx.textBaseline = 'middle';
    ctx.fillText(`CARTÃO ${cartao} DE ${cartoes}`, x, topo + 70);
    ctx.globalAlpha = 1;
  }

  const inicio = topo + (d.contador ? 120 : 60);
  const fim = topo + alturaCartao - 50;
  const par = ajustarPar(ctx, {
    textoTitulo: titulo,
    textoCorpo: texto,
    area: fim - inicio,
    largura,
    maxTitulo: d.texto_maior ? 100 : 92,
    maxCorpo: d.texto_maior ? 57 : 50,
    extra: 0,
    entre: 30 + 12 + 34,
  });
  let y = inicio + Math.max(0, (fim - inicio - par.altura) / 2);
  y = desenharBloco(ctx, par.bt, x, y, primaria);
  y += 30;
  barra(ctx, x, y, secundaria, 120);
  y += 12 + 34;
  ctx.globalAlpha = 0.9;
  desenharBloco(ctx, par.bx, x, y, primaria);
  ctx.globalAlpha = 1;

  ctx.font = '28px "Marca Destaque"';
  ctx.fillStyle = escuro ? secundaria : primaria;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Salve para revisar depois', LARGURA / 2, ALTURA - 118);
  ctx.textAlign = 'left';
  if (d.pontos) desenharPontos(ctx, numero, total, escuro ? secundaria : primaria);
  return { buffer: await canvas.encode('jpeg', 90), coube: par.coube };
}

async function slideFinal({ fechamento, cta, legal, numero, total, design }) {
  const d = normalizarDesign(design);
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const { primaria, secundaria } = marca.cores;
  // O slide final é escuro por padrão, para a chamada se destacar; com "tudo claro", segue o resto.
  const claro = d.fundo === 'claro';
  const corTexto = claro ? primaria : marca.cores.texto_sobre_primaria;
  ctx.fillStyle = claro ? misturar(secundaria, '#FFFFFF', 0.86) : primaria;
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  if (d.formas !== 'nenhuma') {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = secundaria;
    ctx.beginPath();
    ctx.arc(LARGURA - 60, 250, 210, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  await desenharAssinatura(ctx);

  const x = MARGEM + 20;
  const blocoFechamento = ajustarBloco(ctx, fechamento, {
    familia: 'Marca Titulo',
    maximo: d.texto_maior ? 86 : 78,
    minimo: 50,
    maxLinhas: 5,
    entrelinha: 1.12,
    largura: LARGURA_SLIDE,
  });
  const blocoLegal = legal
    ? ajustarBloco(ctx, legal, { familia: 'Marca Texto', maximo: 22, minimo: 18, maxLinhas: 4, entrelinha: 1.4, largura: LARGURA_SLIDE })
    : null;
  let y = 560;
  y = desenharBloco(ctx, blocoFechamento, x, y, corTexto);
  y += 48;
  ctx.font = '34px "Marca Destaque"';
  const textoCta = String(cta || '').trim();
  const larguraCta = Math.min(ctx.measureText(textoCta).width + 84, LARGURA_SLIDE);
  ctx.fillStyle = claro ? primaria : secundaria;
  ctx.beginPath();
  ctx.roundRect(x, y, larguraCta, 86, 43);
  ctx.fill();
  ctx.fillStyle = claro ? marca.cores.texto_sobre_primaria : marca.cores.texto_sobre_secundaria;
  ctx.textBaseline = 'middle';
  ctx.fillText(textoCta, x + 42, y + 45, larguraCta - 84);
  y += 86;
  if (blocoLegal) {
    ctx.globalAlpha = 0.8;
    desenharBloco(ctx, blocoLegal, x, ALTURA - 150 - blocoLegal.linhas.length * 30, corTexto);
    ctx.globalAlpha = 1;
  }
  if (d.pontos) desenharPontos(ctx, numero, total, claro ? primaria : secundaria);
  return { buffer: await canvas.encode('jpeg', 90), coube: blocoFechamento.coube && (!blocoLegal || blocoLegal.coube) && y < ALTURA - 220 };
}

/**
 * Carrossel ou flashcards: capa com o fundo escolhido (IA, foto ou design), slides de conteúdo
 * feitos só com o design da marca e um slide final com a chamada. Todos em 1080 x 1350.
 */
export async function renderizarCarrossel({ fundo, textos, oferta, formato, visual = 'ia', credito = null, semente = 1, design = {} }) {
  registrarFontes();
  const miolo = textos.slides || [];
  // Números grandes no automático: se algum título já traz numeração, nenhum slide mostra o número decorativo.
  const pedido = normalizarDesign(design);
  if (pedido.numeros_grandes === 'auto') {
    design = { ...pedido, numeros_grandes: miolo.some((sl) => temNumeracaoPropria(sl.titulo)) ? 'nao' : 'sim' };
  }
  const total = miolo.length + 2;
  const capa = await renderizarArte({ fundo, textos: { ...textos, cta_arte: 'Deslize para o lado' }, oferta: null, visual, credito, semente, design });
  const slides = [capa.buffer];
  let coube = !capa.ajustes.transbordou;
  for (const [i, item] of miolo.entries()) {
    const r =
      formato === 'flashcards'
        ? await slideCartao({ ...item, numero: i + 2, total, cartao: i + 1, cartoes: miolo.length, design })
        : await slideConteudo({ ...item, numero: i + 2, total, design });
    slides.push(r.buffer);
    coube &&= r.coube;
  }
  const final = await slideFinal({
    fechamento: textos.fechamento,
    cta: textos.cta_arte,
    legal: [oferta?.destaque, oferta?.texto_legal].filter(Boolean).join(' ') || null,
    numero: total,
    total,
    design,
  });
  slides.push(final.buffer);
  coube &&= final.coube;
  return { slides, largura: LARGURA, altura: ALTURA, ajustes: { ...capa.ajustes, slides: total, transbordou: !coube } };
}
