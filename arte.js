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
  if (marca.layout === 'corporativo') return renderizarArteCorporativa({ fundo, textos, oferta, visual, credito, design });
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

/** Fundo claro da marca: a cor definida em marca.json ou um tom bem suave da cor de destaque. */
const fundoClaro = (peso) => marca.cores.fundo_claro || misturar(marca.cores.secundaria, '#FFFFFF', peso);

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

const textoDoCredito = (visual, credito) =>
  visual === 'foto' && credito?.autor ? `Foto: ${credito.autor} / ${credito.fonte || 'Pexels'}${credito.licenca ? `, ${credito.licenca}` : ''}.` : null;

/** Fundo feito só com as cores da marca: formas geométricas, sem pessoas nem objetos. */
function desenharFundoDesign(ctx, semente = 1, d = normalizarDesign()) {
  const r = sorteador(semente);
  const { primaria, secundaria } = marca.cores;
  const escuro = d.fundo === 'escuro';
  ctx.fillStyle = escuro ? primaria : fundoClaro(0.78);
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
    : { fundo: fundoClaro(0.86), texto: primaria, destaque: secundaria, detalhe: primaria };
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
  ctx.fillStyle = claro ? fundoClaro(0.86) : primaria;
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

/* ----------------------------------------------------- carrossel em pista */

/**
 * Traçado da pista ao longo do painel inteiro (todas as imagens lado a lado).
 * Dois pontos por imagem, na metade de baixo, para as curvas passarem de uma imagem para a outra.
 */
function tracadoDaPista(total, semente) {
  const r = sorteador(semente + 11);
  const pontos = [{ x: -240, y: 1000 }];
  for (let i = 0; i < total; i++) {
    const base = i * LARGURA;
    pontos.push({ x: base + 280 + r() * 120, y: 870 + r() * 250 });
    pontos.push({ x: base + 760 + r() * 120, y: 870 + r() * 250 });
  }
  pontos.push({ x: total * LARGURA + 240, y: 1000 });
  return pontos;
}

/** Curvas suaves que passam por todos os pontos (Catmull-Rom convertido em Bézier). */
function segmentos(pontos) {
  const lista = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[Math.max(0, i - 1)];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[Math.min(pontos.length - 1, i + 2)];
    lista.push({
      p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    });
  }
  return lista;
}

function tracarCaminho(ctx, segs) {
  ctx.beginPath();
  ctx.moveTo(segs[0].p1.x, segs[0].p1.y);
  for (const s of segs) ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p2.x, s.p2.y);
}

/** Pontos ao longo da pista, com a direção em cada ponto, para posicionar largada, curvas e carro. */
function amostrar(segs) {
  const pontos = [];
  for (const s of segs) {
    for (let t = 0; t <= 1; t += 0.02) {
      const u = 1 - t;
      const x = u ** 3 * s.p1.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t ** 3 * s.p2.x;
      const y = u ** 3 * s.p1.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t ** 3 * s.p2.y;
      const dx = 3 * u * u * (s.c1.x - s.p1.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.p2.x - s.c2.x);
      const dy = 3 * u * u * (s.c1.y - s.p1.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.p2.y - s.c2.y);
      pontos.push({ x, y, angulo: Math.atan2(dy, dx) });
    }
  }
  return pontos;
}

const pontoPerto = (amostras, x) => amostras.reduce((melhor, p) => (Math.abs(p.x - x) < Math.abs(melhor.x - x) ? p : melhor));

/** Faixa quadriculada atravessando a pista (largada e chegada). */
function faixaQuadriculada(ctx, ponto) {
  ctx.save();
  ctx.translate(ponto.x, ponto.y);
  ctx.rotate(ponto.angulo);
  const lado = 20;
  for (let c = 0; c < 2; c++) {
    for (let l = -4; l < 4; l++) {
      ctx.fillStyle = (c + l) % 2 === 0 ? '#FFFFFF' : '#0B0C0F';
      ctx.fillRect(c * lado - lado, l * lado, lado, lado);
    }
  }
  ctx.restore();
}

/** Carro de corrida genérico visto de cima, sem pintura de equipe nem marcas. */
function desenharCarro(ctx, ponto, cor) {
  ctx.save();
  ctx.translate(ponto.x, ponto.y);
  ctx.rotate(ponto.angulo);
  ctx.scale(1.25, 1.25);
  ctx.fillStyle = '#0B0C0F';
  for (const [wx, wy] of [[-58, -36], [-58, 36], [48, -34], [48, 34]]) {
    ctx.beginPath();
    ctx.roundRect(wx - 18, wy - 11, 36, 22, 6);
    ctx.fill();
  }
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.roundRect(-96, -32, 16, 64, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-84, -15);
  ctx.lineTo(36, -19);
  ctx.lineTo(92, -6);
  ctx.lineTo(92, 6);
  ctx.lineTo(36, 19);
  ctx.lineTo(-84, 15);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(86, -38, 14, 76, 4);
  ctx.fill();
  ctx.fillStyle = '#15171C';
  ctx.beginPath();
  ctx.ellipse(-10, 0, 20, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Plaquinha de curva numerada, acima da pista. */
function placaDeCurva(ctx, ponto, numero, corFundo, corTexto) {
  const x = ponto.x - Math.sin(ponto.angulo) * -178;
  const y = ponto.y + Math.cos(ponto.angulo) * -178;
  ctx.fillStyle = corFundo;
  ctx.beginPath();
  ctx.arc(x, y, 34, 0, Math.PI * 2);
  ctx.fill();
  if (numero != null) {
    ctx.font = '36px "Marca Titulo"';
    ctx.fillStyle = corTexto;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(numero), x, y + 2);
    ctx.textAlign = 'left';
  }
}

function pilula(ctx, texto, x, y, fundo, cor) {
  ctx.font = '34px "Marca Destaque"';
  const t = String(texto || '').trim();
  const largura = Math.min(ctx.measureText(t).width + 84, LARGURA_SLIDE);
  ctx.fillStyle = fundo;
  ctx.beginPath();
  ctx.roundRect(x, y, largura, 86, 43);
  ctx.fill();
  ctx.fillStyle = cor;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x + 42, y + 45, largura - 84);
  return y + 86;
}

/**
 * Carrossel em pista: uma volta contínua que atravessa todas as imagens.
 * Capa com a largada e o carro, slides de conteúdo com curvas numeradas e o slide final com a bandeirada.
 * O texto fica na metade de cima; a pista, na metade de baixo.
 */
async function renderizarPista({ textos, design, semente = 1 }) {
  registrarFontes();
  const d = normalizarDesign(design);
  const miolo = textos.slides || [];
  const total = miolo.length + 2;
  const escuro = d.fundo !== 'claro';
  const { primaria, secundaria } = marca.cores;
  const corTexto = escuro ? marca.cores.texto_sobre_primaria : primaria;

  // Painel inteiro: todas as imagens lado a lado, para a pista não quebrar na troca de imagem.
  const painel = createCanvas(LARGURA * total, ALTURA);
  const p = painel.getContext('2d');
  p.fillStyle = escuro ? primaria : fundoClaro(0.86);
  p.fillRect(0, 0, painel.width, ALTURA);

  const segs = segmentos(tracadoDaPista(total, semente));
  const amostras = amostrar(segs);
  p.lineJoin = 'round';
  tracarCaminho(p, segs);
  p.lineWidth = 204;
  p.strokeStyle = '#FFFFFF';
  p.stroke();
  tracarCaminho(p, segs);
  p.setLineDash([46, 46]);
  p.strokeStyle = secundaria;
  p.stroke();
  p.setLineDash([]);
  tracarCaminho(p, segs);
  p.lineWidth = 166;
  p.strokeStyle = escuro ? '#30333B' : '#3A3D45';
  p.stroke();
  tracarCaminho(p, segs);
  p.lineWidth = 5;
  p.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  p.setLineDash([28, 34]);
  p.stroke();
  p.setLineDash([]);

  faixaQuadriculada(p, pontoPerto(amostras, 330));
  faixaQuadriculada(p, pontoPerto(amostras, (total - 1) * LARGURA + 700));
  const numerar = !miolo.some((sl) => temNumeracaoPropria(sl.titulo)) && d.numeros_grandes !== 'nao';
  miolo.forEach((_, i) => placaDeCurva(p, pontoPerto(amostras, (i + 1) * LARGURA + 540), numerar ? i + 1 : null, secundaria, marca.cores.texto_sobre_secundaria));
  desenharCarro(p, pontoPerto(amostras, 600), secundaria);

  const x = MARGEM + 20;
  const topo = 190;
  const limite = 720;
  const slides = [];
  let coube = true;
  let ajustesCapa = null;
  for (let i = 0; i < total; i++) {
    const canvas = createCanvas(LARGURA, ALTURA);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(painel, -i * LARGURA, 0);
    await desenharAssinatura(ctx);
    if (d.contador && i > 0) desenharContador(ctx, `${i + 1}/${total}`, escuro ? secundaria : primaria);

    if (i === 0) {
      const titulo = ajustarBloco(ctx, textos.titulo, { familia: 'Marca Titulo', maximo: d.texto_maior ? 100 : 92, minimo: 54, maxLinhas: 3, entrelinha: 1.05, largura: LARGURA_SLIDE });
      const sub = ajustarBloco(ctx, textos.subtitulo, { familia: 'Marca Texto', maximo: d.texto_maior ? 42 : 38, minimo: 28, maxLinhas: 3, entrelinha: 1.35, largura: LARGURA_SLIDE });
      let y = desenharBloco(ctx, titulo, x, topo, corTexto);
      y = desenharBloco(ctx, sub, x, y + 24, corTexto);
      y = pilula(ctx, 'Arraste e dê a volta', x, y + 34, secundaria, marca.cores.texto_sobre_secundaria);
      coube &&= titulo.coube && sub.coube && y <= limite + 40;
      ajustesCapa = { tamanho_titulo: titulo.tamanho, tamanho_subtitulo: sub.tamanho };
    } else if (i === total - 1) {
      const bloco = ajustarBloco(ctx, textos.fechamento, { familia: 'Marca Titulo', maximo: d.texto_maior ? 90 : 82, minimo: 50, maxLinhas: 4, entrelinha: 1.08, largura: LARGURA_SLIDE });
      let y = desenharBloco(ctx, bloco, x, topo + 40, corTexto);
      y = pilula(ctx, textos.cta_arte, x, y + 40, secundaria, marca.cores.texto_sobre_secundaria);
      coube &&= bloco.coube && y <= limite + 40;
    } else {
      const item = miolo[i - 1];
      const par = ajustarPar(ctx, {
        textoTitulo: item.titulo,
        textoCorpo: item.texto,
        area: limite - topo,
        largura: LARGURA_SLIDE,
        maxTitulo: d.texto_maior ? 88 : 80,
        maxCorpo: d.texto_maior ? 48 : 42,
        extra: 0,
        entre: 30 + 12 + 30,
      });
      let y = desenharBloco(ctx, par.bt, x, topo, corTexto);
      y += 30;
      barra(ctx, x, y, secundaria, 120);
      y += 12 + 30;
      ctx.globalAlpha = 0.92;
      desenharBloco(ctx, par.bx, x, y, corTexto);
      ctx.globalAlpha = 1;
      coube &&= par.coube;
    }
    if (d.pontos) desenharPontos(ctx, i + 1, total, escuro ? '#FFFFFF' : primaria);
    slides.push(await canvas.encode('jpeg', 90));
  }
  return { slides, largura: LARGURA, altura: ALTURA, ajustes: { ...ajustesCapa, slides: total, transbordou: !coube } };
}

/**
 * Carrossel ou flashcards: capa com o fundo escolhido (IA, foto ou design), slides de conteúdo
 * feitos só com o design da marca e um slide final com a chamada. Todos em 1080 x 1350.
 */
export async function renderizarCarrossel({ fundo, textos, oferta, formato, visual = 'ia', credito = null, semente = 1, design = {} }) {
  if (formato === 'pista') return renderizarPista({ textos, design: { ...design }, semente });
  if (marca.layout === 'corporativo') return renderizarCarrosselCorporativo({ fundo, textos, oferta, formato, visual, credito, design });
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

/* ------------------------------------------------------ layout corporativo */
// Usado quando marca.layout = "corporativo": degradê da marca, logos oficiais e nenhuma forma decorativa.

const LARGURA_CORP = LARGURA - MARGEM * 2 - 24;
const logosCarregados = new Map();

async function logoDaMarca(chave) {
  const arquivo = marca.logos?.[chave];
  if (!arquivo) return null;
  if (!logosCarregados.has(arquivo)) logosCarregados.set(arquivo, await loadImage(path.resolve(raiz, arquivo)));
  return logosCarregados.get(arquivo);
}

function colocarLogo(ctx, imagem, x, y, altura, alinhar = 'esquerda') {
  if (!imagem) return;
  const largura = (imagem.width / imagem.height) * altura;
  const px = alinhar === 'direita' ? x - largura : alinhar === 'centro' ? x - largura / 2 : x;
  ctx.drawImage(imagem, px, y, largura, altura);
}

function pintarDegrade(ctx, x = 0, y = 0, w = LARGURA, h = ALTURA) {
  const [de, ate] = marca.cores.gradiente || [marca.cores.primaria, marca.cores.primaria];
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, de);
  g.addColorStop(1, ate);
  ctx.fillStyle = g;
}

/** Símbolo da marca, grande e quase transparente, saindo pela direita: a única "forma" do layout corporativo. */
async function marcaDagua(ctx, d, claro = false) {
  if (d.formas === 'nenhuma') return;
  const simbolo = await logoDaMarca(claro ? 'simbolo_claro' : 'simbolo_escuro');
  if (!simbolo) return;
  const altura = d.formas === 'poucas' ? 860 : 1100;
  const largura = (simbolo.width / simbolo.height) * altura;
  ctx.globalAlpha = claro ? 0.05 : 0.08;
  ctx.drawImage(simbolo, LARGURA - largura * 0.6, ALTURA - altura * 0.95, largura, altura);
  ctx.globalAlpha = 1;
}

function cobrirComFoto(ctx, imagem, x, y, w, h) {
  const escala = Math.max(w / imagem.width, h / imagem.height);
  const iw = imagem.width * escala;
  const ih = imagem.height * escala;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(imagem, x + (w - iw) / 2, y + (h - ih) * 0.3, iw, ih);
  ctx.restore();
}

/** Botão em pílula; com "seta", ganha uma seta desenhada (não depende da fonte ter o caractere). */
function botao(ctx, texto, x, y, { fundo, cor, seta = false }) {
  ctx.font = '32px "Marca Destaque"';
  const t = String(texto || '').trim();
  const extra = seta ? 46 : 0;
  const largura = Math.min(ctx.measureText(t).width + 84 + extra, LARGURA_CORP);
  ctx.fillStyle = fundo;
  ctx.beginPath();
  ctx.roundRect(x, y, largura, 80, 40);
  ctx.fill();
  ctx.fillStyle = cor;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x + 42, y + 42, largura - 84 - extra);
  if (seta) {
    const sx = x + largura - 62;
    ctx.strokeStyle = cor;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, y + 40);
    ctx.lineTo(sx + 26, y + 40);
    ctx.moveTo(sx + 16, y + 30);
    ctx.lineTo(sx + 26, y + 40);
    ctx.lineTo(sx + 16, y + 50);
    ctx.stroke();
  }
  return y + 80;
}

function barraDeProgresso(ctx, atual, total, cor) {
  const largura = LARGURA - MARGEM * 2;
  const espaco = 10;
  const segmento = (largura - espaco * (total - 1)) / total;
  for (let i = 0; i < total; i++) {
    ctx.globalAlpha = i + 1 === atual ? 1 : 0.25;
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.roundRect(MARGEM + i * (segmento + espaco), ALTURA - 58, segmento, 6, 3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Capa e post único: foto com painel em degradê de borda curva, ou degradê inteiro quando não há imagem. */
async function capaCorporativa({ fundo, textos, oferta, visual, credito, d, rotuloCta = null, seta = false }) {
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const branco = marca.cores.texto_sobre_primaria;
  const comFoto = Boolean(fundo);
  const x = MARGEM + 12;

  const titulo = ajustarBloco(ctx, textos.titulo, {
    familia: 'Marca Titulo',
    maximo: comFoto ? (d.texto_maior ? 74 : 66) : d.texto_maior ? 96 : 86,
    minimo: 46,
    maxLinhas: comFoto ? 3 : 4,
    entrelinha: 1.1,
    largura: LARGURA_CORP,
  });
  const sub = ajustarBloco(ctx, textos.subtitulo, { familia: 'Marca Texto', maximo: d.texto_maior ? 40 : 34, minimo: 26, maxLinhas: 3, entrelinha: 1.4, largura: LARGURA_CORP });
  const destaque = oferta?.destaque
    ? ajustarBloco(ctx, oferta.destaque, { familia: 'Marca Destaque', maximo: 32, minimo: 24, maxLinhas: 2, entrelinha: 1.3, largura: LARGURA_CORP })
    : null;
  const legal = [oferta?.texto_legal, visual === 'ia' && comFoto ? politica.rotulo_ia : null, textoDoCredito(visual, credito)].filter(Boolean).join(' ');
  const blocoLegal = legal
    ? ajustarBloco(ctx, legal, { familia: 'Marca Texto', maximo: 20, minimo: 16, maxLinhas: 4, entrelinha: 1.4, largura: LARGURA_CORP - 330 })
    : null;

  const alturaTexto = alturaBloco(titulo) + 22 + alturaBloco(sub) + (destaque ? 26 + alturaBloco(destaque) : 0) + 44 + 80;
  const rodape = 150;
  let y;
  let topoPainel = 0;
  if (comFoto) {
    cobrirComFoto(ctx, await loadImage(fundo), 0, 0, LARGURA, ALTURA);
    topoPainel = Math.max(ALTURA - (alturaTexto + 120 + rodape), 470);
    ctx.beginPath();
    ctx.moveTo(0, topoPainel + 80);
    ctx.quadraticCurveTo(LARGURA * 0.55, topoPainel - 60, LARGURA, topoPainel + 6);
    ctx.lineTo(LARGURA, ALTURA);
    ctx.lineTo(0, ALTURA);
    ctx.closePath();
    pintarDegrade(ctx, 0, topoPainel, LARGURA, ALTURA - topoPainel);
    ctx.fill();
    y = topoPainel + 110;
  } else {
    pintarDegrade(ctx);
    ctx.fillRect(0, 0, LARGURA, ALTURA);
    await marcaDagua(ctx, d);
    colocarLogo(ctx, await logoDaMarca('horizontal_escuro'), x, MARGEM + 10, 66);
    y = Math.max(300, ALTURA - rodape - 40 - alturaTexto);
  }

  y = desenharBloco(ctx, titulo, x, y, branco);
  y += 22;
  ctx.globalAlpha = 0.94;
  y = desenharBloco(ctx, sub, x, y, branco);
  ctx.globalAlpha = 1;
  if (destaque) {
    y += 26;
    y = desenharBloco(ctx, destaque, x, y, branco);
  }
  y += 44;
  y = botao(ctx, rotuloCta || textos.cta_arte, x, y, { fundo: marca.cores.secundaria, cor: marca.cores.texto_sobre_secundaria, seta });

  if (blocoLegal) {
    ctx.globalAlpha = 0.85;
    desenharBloco(ctx, blocoLegal, x, ALTURA - 48 - alturaBloco(blocoLegal), branco);
    ctx.globalAlpha = 1;
  }
  if (comFoto) colocarLogo(ctx, await logoDaMarca('horizontal_escuro'), LARGURA - MARGEM, ALTURA - 52 - 54, 54, 'direita');

  const transbordou = !titulo.coube || !sub.coube || (destaque && !destaque.coube) || (blocoLegal && !blocoLegal.coube) || y > ALTURA - rodape + 30;
  return {
    canvas,
    ajustes: {
      tamanho_titulo: titulo.tamanho,
      tamanho_subtitulo: sub.tamanho,
      altura_card: Math.round(comFoto ? ALTURA - topoPainel : alturaTexto),
      transbordou: Boolean(transbordou),
    },
  };
}

async function renderizarArteCorporativa({ fundo, textos, oferta, visual, credito, design }) {
  registrarFontes();
  const { canvas, ajustes } = await capaCorporativa({ fundo, textos, oferta, visual, credito, d: normalizarDesign(design) });
  return { buffer: await canvas.encode('jpeg', 92), largura: LARGURA, altura: ALTURA, ajustes };
}

async function slideCorporativo({ titulo, texto, numero, total, d, mostrarNumero, cartao = null, cartoes = 0 }) {
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const { primaria } = marca.cores;
  const corpo = marca.cores.texto_corpo || '#3C3C3C';
  const branco = marca.cores.texto_sobre_primaria;
  // Conteúdo: fundo branco por padrão. Cartões: degradê por padrão, com o cartão branco em destaque.
  const escuro = cartao ? d.fundo !== 'claro' : d.fundo === 'escuro';
  if (escuro) pintarDegrade(ctx);
  else ctx.fillStyle = cartao ? marca.cores.fundo_claro || '#F4F4F4' : '#FFFFFF';
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  if (escuro) await marcaDagua(ctx, d);

  colocarLogo(ctx, await logoDaMarca(escuro ? 'simbolo_escuro' : 'simbolo_claro'), MARGEM, MARGEM, 68);
  if (d.contador) {
    ctx.font = '30px "Marca Destaque"';
    ctx.fillStyle = escuro ? branco : primaria;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${numero}/${total}`, LARGURA - MARGEM, MARGEM + 34);
    ctx.textAlign = 'left';
  }

  let coube;
  if (cartao) {
    const topo = 190;
    const alturaCartao = ALTURA - topo - 150;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(MARGEM, topo, LARGURA - MARGEM * 2, alturaCartao, 36);
    ctx.fill();
    ctx.restore();
    const x = MARGEM + 60;
    const largura = LARGURA - MARGEM * 2 - 120;
    if (d.contador) {
      ctx.font = '26px "Marca Destaque"';
      ctx.fillStyle = primaria;
      ctx.textBaseline = 'middle';
      ctx.fillText(`CARTÃO ${cartao} DE ${cartoes}`, x, topo + 72);
    }
    const inicio = topo + (d.contador ? 130 : 70);
    const fim = topo + alturaCartao - 60;
    const par = ajustarPar(ctx, { textoTitulo: titulo, textoCorpo: texto, area: fim - inicio, largura, maxTitulo: d.texto_maior ? 92 : 82, maxCorpo: d.texto_maior ? 48 : 42, extra: 0, entre: 30 + 6 + 32 });
    let y = inicio + Math.max(0, (fim - inicio - par.altura) / 2);
    y = desenharBloco(ctx, par.bt, x, y, primaria);
    y += 30;
    ctx.fillStyle = primaria;
    ctx.fillRect(x, y, 90, 6);
    y += 6 + 32;
    desenharBloco(ctx, par.bx, x, y, corpo);
    coube = par.coube;
  } else {
    const x = MARGEM + 12;
    const topo = 230;
    const base = ALTURA - 140;
    const alturaNumero = mostrarNumero ? 150 : 0;
    const par = ajustarPar(ctx, {
      textoTitulo: titulo,
      textoCorpo: texto,
      area: base - topo,
      largura: LARGURA_CORP,
      maxTitulo: d.texto_maior ? 92 : 82,
      maxCorpo: d.texto_maior ? 50 : 44,
      extra: mostrarNumero ? alturaNumero + 20 : 0,
      entre: 32 + 6 + 34,
    });
    let y = topo + Math.max(0, (base - topo - par.altura) / 2);
    if (mostrarNumero) {
      ctx.font = '150px "Marca Titulo"';
      ctx.fillStyle = escuro ? branco : primaria;
      ctx.globalAlpha = escuro ? 0.22 : 0.14;
      ctx.textBaseline = 'top';
      ctx.fillText(String(numero - 1).padStart(2, '0'), x - 6, y);
      ctx.globalAlpha = 1;
      y += alturaNumero + 20;
    }
    y = desenharBloco(ctx, par.bt, x, y, escuro ? branco : primaria);
    y += 32;
    ctx.fillStyle = escuro ? branco : primaria;
    ctx.fillRect(x, y, 90, 6);
    y += 6 + 34;
    desenharBloco(ctx, par.bx, x, y, escuro ? branco : corpo);
    coube = par.coube;
  }
  if (d.pontos) barraDeProgresso(ctx, numero, total, escuro ? branco : primaria);
  return { buffer: await canvas.encode('jpeg', 92), coube };
}

async function finalCorporativo({ fechamento, cta, legal, numero, total, d }) {
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const claro = d.fundo === 'claro';
  const cor = claro ? marca.cores.primaria : marca.cores.texto_sobre_primaria;
  if (claro) ctx.fillStyle = '#FFFFFF';
  else pintarDegrade(ctx);
  ctx.fillRect(0, 0, LARGURA, ALTURA);
  await marcaDagua(ctx, d, claro);
  const x = MARGEM + 12;
  const bloco = ajustarBloco(ctx, fechamento, { familia: 'Marca Titulo', maximo: d.texto_maior ? 92 : 84, minimo: 50, maxLinhas: 5, entrelinha: 1.1, largura: LARGURA_CORP });
  const blocoLegal = legal ? ajustarBloco(ctx, legal, { familia: 'Marca Texto', maximo: 20, minimo: 16, maxLinhas: 4, entrelinha: 1.4, largura: LARGURA_CORP }) : null;
  let y = Math.max(240, (ALTURA - (alturaBloco(bloco) + 48 + 80)) / 2 - 40);
  y = desenharBloco(ctx, bloco, x, y, cor);
  y += 48;
  y = botao(ctx, cta, x, y, claro ? { fundo: marca.cores.primaria, cor: marca.cores.texto_sobre_primaria } : { fundo: marca.cores.secundaria, cor: marca.cores.texto_sobre_secundaria });
  colocarLogo(ctx, await logoDaMarca(claro ? 'horizontal_claro' : 'horizontal_escuro'), x, ALTURA - 150 - 64, 64);
  if (blocoLegal) {
    ctx.globalAlpha = 0.85;
    desenharBloco(ctx, blocoLegal, x, y + 40, cor);
    ctx.globalAlpha = 1;
  }
  if (d.pontos) barraDeProgresso(ctx, numero, total, cor);
  return { buffer: await canvas.encode('jpeg', 92), coube: bloco.coube && (!blocoLegal || blocoLegal.coube) };
}

async function renderizarCarrosselCorporativo({ fundo, textos, oferta, formato, visual, credito, design }) {
  registrarFontes();
  const d = normalizarDesign(design);
  const miolo = textos.slides || [];
  const total = miolo.length + 2;
  const mostrarNumero =
    d.numeros_grandes === 'sim' || (d.numeros_grandes === 'auto' && formato !== 'flashcards' && !miolo.some((s) => temNumeracaoPropria(s.titulo)));
  const capa = await capaCorporativa({ fundo, textos, oferta: null, visual, credito, d, rotuloCta: 'Deslize para o lado', seta: true });
  const slides = [await capa.canvas.encode('jpeg', 92)];
  let coube = !capa.ajustes.transbordou;
  for (const [i, item] of miolo.entries()) {
    const r = await slideCorporativo({
      ...item,
      numero: i + 2,
      total,
      d,
      mostrarNumero,
      ...(formato === 'flashcards' ? { cartao: i + 1, cartoes: miolo.length } : {}),
    });
    slides.push(r.buffer);
    coube &&= r.coube;
  }
  const final = await finalCorporativo({ fechamento: textos.fechamento, cta: textos.cta_arte, legal: oferta?.texto_legal || null, numero: total, total, d });
  slides.push(final.buffer);
  coube &&= final.coube;
  return { slides, largura: LARGURA, altura: ALTURA, ajustes: { ...capa.ajustes, slides: total, transbordou: !coube } };
}
