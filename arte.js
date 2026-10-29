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
  // Peso extra para números grandes (no playbook da Capgemini, Ubuntu Sans Thin só para numerais).
  if (marca.fontes.numeros) familias['Marca Numeros'] = marca.fontes.numeros;
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
  if (marca.layout === 'playbook') return renderizarArtePlaybook({ fundo, textos, oferta, design, semente });
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
  if (marca.layout === 'playbook') return renderizarCarrosselPlaybook({ fundo, textos, formato, design, semente });
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

/** Logo oficial quando existe; sem logo, o nome da marca em texto (nunca um logo desenhado). */
async function assinatura(ctx, chave, x, y, altura, alinhar, cor) {
  const logo = await logoDaMarca(chave);
  if (logo) return colocarLogo(ctx, logo, x, y, altura, alinhar);
  const texto = marca.rotulo_assinatura || marca.nome;
  if (!texto) return;
  ctx.font = `${Math.round(altura * 0.46)}px "Marca Destaque"`;
  ctx.fillStyle = cor;
  ctx.textBaseline = 'middle';
  ctx.textAlign = alinhar === 'direita' ? 'right' : alinhar === 'centro' ? 'center' : 'left';
  ctx.fillText(texto, x, y + altura / 2);
  ctx.textAlign = 'left';
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
    await assinatura(ctx, 'horizontal_escuro', x, MARGEM + 10, 66, 'esquerda', branco);
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
  if (comFoto) await assinatura(ctx, 'horizontal_escuro', LARGURA - MARGEM, ALTURA - 52 - 54, 54, 'direita', branco);

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

  await assinatura(ctx, escuro ? 'simbolo_escuro' : 'simbolo_claro', MARGEM, MARGEM, 68, 'esquerda', escuro ? branco : primaria);
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
  await assinatura(ctx, claro ? 'horizontal_claro' : 'horizontal_escuro', x, ALTURA - 150 - 64, 64, 'esquerda', cor);
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

/* ------------------------------------------------- régua de comunicação em PDF */

const PAGINA = { largura: 1754, altura: 1240 };
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function dataCurta(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay();
  return { dia: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`, semana: DIAS_CURTOS[dia] };
}

function linhasCabendo(ctx, texto, largura, maxLinhas) {
  const linhas = quebrarLinhas(ctx, String(texto || ''), largura);
  if (linhas.length <= maxLinhas) return linhas;
  const cortadas = linhas.slice(0, maxLinhas);
  let ultima = cortadas[maxLinhas - 1];
  while (ultima && ctx.measureText(`${ultima}…`).width > largura) ultima = ultima.slice(0, -1);
  cortadas[maxLinhas - 1] = `${ultima.trimEnd()}…`;
  return cortadas;
}

/**
 * Páginas JPEG (A4 deitado) com a régua de comunicação, para aprovação.
 * `rotulos` traz os nomes legíveis de categoria, público, formato e etapa.
 */
export async function renderizarRegua(regua, rotulos) {
  registrarFontes();
  const { largura: W, altura: H } = PAGINA;
  const m = 80;
  const azul = marca.cores.primaria;
  const navy = (marca.cores.gradiente || [])[0] || '#00112C';
  const ciano = marca.cores.secundaria;
  const cinza = '#5B6472';
  const colunas = [
    { chave: 'n', titulo: '#', largura: 56 },
    { chave: 'data', titulo: 'Data', largura: 120 },
    { chave: 'tema', titulo: 'Tema e primeira linha do post', largura: 470 },
    { chave: 'categoria', titulo: 'Capacidade', largura: 200 },
    { chave: 'formato', titulo: 'Formato', largura: 128 },
    { chave: 'etapa', titulo: 'Etapa', largura: 150 },
    { chave: 'publico', titulo: 'Público', largura: 160 },
  ];
  colunas.push({ chave: 'cta', titulo: 'Chamada final', largura: W - 2 * m - colunas.reduce((t, c) => t + c.largura, 0) });
  const itens = regua.itens || [];
  // A primeira página tem objetivo e narrativa, então leva menos linhas da tabela.
  const grupos = [];
  for (let i = 0, cap = 5; i < itens.length || !grupos.length; i += cap, cap = 7) grupos.push(itens.slice(i, i + cap));
  const paginas = [];
  const totalPaginas = grupos.length;
  let inicioDoGrupo = 0;
  const datas = itens.map((i) => i.data).filter(Boolean).sort();
  const periodo = datas.length ? `${dataCurta(datas[0]).dia} a ${dataCurta(datas[datas.length - 1]).dia}/${datas[datas.length - 1].slice(0, 4)}` : '';

  for (let p = 0; p < totalPaginas; p++) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Cabeçalho
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, navy);
    g.addColorStop(1, azul);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 190);
    ctx.fillStyle = ciano;
    ctx.fillRect(m, 188, 160, 4);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '24px "Marca Destaque"';
    ctx.fillText('RÉGUA DE COMUNICAÇÃO · LINKEDIN', m, 66);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '50px "Marca Titulo"';
    ctx.fillText(linhasCabendo(ctx, regua.nome || 'Série de posts', W - 2 * m - 420, 1)[0], m, 128);
    ctx.font = '26px "Marca Texto"';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${itens.length} posts · ${periodo}${regua.cadencia?.texto ? ` · ${regua.cadencia.texto}` : ''}`, m, 168);
    ctx.textAlign = 'right';
    ctx.font = '26px "Marca Destaque"';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(marca.rotulo_assinatura || marca.nome, W - m, 66);
    ctx.textAlign = 'left';

    let y = 240;
    if (p === 0) {
      ctx.fillStyle = navy;
      ctx.font = '26px "Marca Titulo"';
      ctx.fillText('Objetivo', m, y);
      ctx.font = '24px "Marca Texto"';
      ctx.fillStyle = cinza;
      const obj = linhasCabendo(ctx, regua.objetivo, W - 2 * m - 160, 2);
      obj.forEach((l, i) => ctx.fillText(l, m + 160, y + i * 32));
      y += Math.max(1, obj.length) * 32 + 18;
      ctx.fillStyle = navy;
      ctx.font = '26px "Marca Titulo"';
      ctx.fillText('Narrativa', m, y);
      ctx.font = '24px "Marca Texto"';
      ctx.fillStyle = cinza;
      const nar = linhasCabendo(ctx, regua.narrativa, W - 2 * m - 160, 3);
      nar.forEach((l, i) => ctx.fillText(l, m + 160, y + i * 32));
      y += Math.max(1, nar.length) * 32 + 26;
    }

    // Tabela
    ctx.fillStyle = '#EEF3F8';
    ctx.fillRect(m, y, W - 2 * m, 52);
    ctx.font = '21px "Marca Destaque"';
    ctx.fillStyle = navy;
    let x = m;
    for (const c of colunas) {
      ctx.fillText(c.titulo, x + 14, y + 34);
      x += c.largura;
    }
    y += 52;
    const grupo = grupos[p];
    const alturaLinha = Math.min(150, Math.floor((H - y - 90) / (p === 0 ? 5 : 7)));
    const linhasCabem = (altura) => Math.max(1, Math.floor((alturaLinha - 22) / altura));
    grupo.forEach((item, k) => {
      const i = inicioDoGrupo + k;
      if (k % 2 === 1) {
        ctx.fillStyle = '#F7F9FC';
        ctx.fillRect(m, y, W - 2 * m, alturaLinha);
      }
      ctx.fillStyle = '#E1E8F0';
      ctx.fillRect(m, y + alturaLinha - 1, W - 2 * m, 1);
      let cx = m;
      const topo = y + 36;
      for (const c of colunas) {
        const area = c.largura - 28;
        if (c.chave === 'n') {
          ctx.font = '30px "Marca Titulo"';
          ctx.fillStyle = azul;
          ctx.fillText(String(i + 1).padStart(2, '0'), cx + 14, topo + 4);
        } else if (c.chave === 'data') {
          const dc = item.data ? dataCurta(item.data) : { dia: 'a definir', semana: '' };
          ctx.font = '26px "Marca Titulo"';
          ctx.fillStyle = navy;
          ctx.fillText(dc.dia, cx + 14, topo + 2);
          ctx.font = '21px "Marca Texto"';
          ctx.fillStyle = cinza;
          ctx.fillText(dc.semana, cx + 14, topo + 32);
          if (item.ja_produzido) {
            ctx.font = '15px "Marca Destaque"';
            ctx.fillStyle = '#1F8A57';
            ctx.fillText('JÁ PRODUZIDO', cx + 14, topo + 60);
          }
        } else if (c.chave === 'tema') {
          ctx.font = '23px "Marca Titulo"';
          ctx.fillStyle = navy;
          const t = linhasCabendo(ctx, item.titulo, area, 2);
          t.forEach((l, j) => ctx.fillText(l, cx + 14, topo + j * 29));
          ctx.font = '20px "Marca Texto"';
          ctx.fillStyle = cinza;
          const sobra = Math.max(1, Math.floor((alturaLinha - 30 - t.length * 29) / 26));
          linhasCabendo(ctx, `“${item.gancho || ''}”`, area, Math.min(3, sobra)).forEach((l, j) => ctx.fillText(l, cx + 14, topo + t.length * 29 + 6 + j * 26));
        } else {
          const valor = c.chave === 'cta' ? item.cta : rotulos[c.chave]?.(item) || '';
          ctx.font = c.chave === 'cta' ? '19px "Marca Texto"' : '20px "Marca Texto"';
          ctx.fillStyle = '#2B2F38';
          const altura = c.chave === 'cta' ? 24 : 26;
          linhasCabendo(ctx, valor, area, linhasCabem(altura)).forEach((l, j) => ctx.fillText(l, cx + 14, topo + j * altura));
        }
        cx += c.largura;
      }
      y += alturaLinha;
    });
    inicioDoGrupo += grupo.length;

    // Rodapé
    ctx.font = '19px "Marca Texto"';
    ctx.fillStyle = cinza;
    ctx.fillText('Datas sem feriados nacionais. Números e casos vêm da base de conhecimento aprovada; clientes aparecem sem nome.', m, H - 40);
    ctx.textAlign = 'right';
    ctx.fillText(`Página ${p + 1} de ${totalPaginas}`, W - m, H - 40);
    ctx.textAlign = 'left';
    paginas.push(await canvas.encode('jpeg', 92));
  }
  return paginas;
}

/* ------------------------------------------------------------ layout playbook */
// Capgemini Visual Identity Playbook 2026 (marca.layout = "playbook"):
// grade quadrada, temas oficiais (degradê, Midnight Blue ou branco), pixelização em grade em até 10% da peça,
// cursor com caixa alta, manchete em Ubuntu Sans Light com destaque só por cor, barra de progresso e logo oficial.
// Sem imagem gerada por IA: o playbook não permite.

const PB = { u: 45, margem: 90 };

function paletaPb() {
  const c = marca.cores;
  return {
    midnight: c.midnight || '#121A38',
    azul: c.primaria || '#0058AB',
    claro: c.secundaria || '#1DB8F2',
    turquesa: c.turquesa || '#09CCDA',
    g1: c.g1 || '#F3F4F7',
    g4: c.g4 || '#ADB8C2',
    g6: c.texto_corpo || '#4B5972',
  };
}

const rgbDe = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const hexDe = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mistura = (a, b, t) => hexDe(rgbDe(a).map((v, i) => v + (rgbDe(b)[i] - v) * t));

/** Cor do degradê comum (Midnight → Capgemini Blue → Light Blue) num ponto de 0 a 1. */
function corNoDegradePb(t) {
  const p = paletaPb();
  return t < 0.62 ? mistura(p.midnight, p.azul, t / 0.62) : mistura(p.azul, p.claro, (t - 0.62) / 0.38);
}

/** Posição (0 a 1) no degradê do fundo, para o ponto (x, y). Mesmo eixo usado em pintarFundoPb. */
const posicaoNoDegradePb = (x, y) => Math.max(0, Math.min(1, (x * 0.35 * LARGURA + y * ALTURA) / ((0.35 * LARGURA) ** 2 + ALTURA ** 2)));

function pintarFundoPb(ctx, tema) {
  const p = paletaPb();
  if (tema === 'claro') ctx.fillStyle = '#FFFFFF';
  else if (tema === 'escuro') ctx.fillStyle = p.midnight;
  else {
    // Degradê comum, do escuro (alto, à esquerda) para o claro (baixo): o texto fica sobre a parte escura.
    const g = ctx.createLinearGradient(0, 0, 0.35 * LARGURA, ALTURA);
    g.addColorStop(0, p.midnight);
    g.addColorStop(0.62, p.azul);
    g.addColorStop(1, p.claro);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, LARGURA, ALTURA);
}

/**
 * Pixelização em grade: quadrados alinhados à grade, perto de um canto, em tons do próprio fundo.
 * Fica sempre abaixo de 10% da área da peça, como o playbook pede.
 */
function pixelarPb(ctx, tema, semente, quantidade = 'padrao') {
  if (quantidade === 'nenhuma') return 0;
  const r = sorteador(semente + 29);
  const p = paletaPb();
  const { u } = PB;
  const colunas = LARGURA / u;
  const linhas = ALTURA / u;
  const limite = Math.floor(colunas * linhas * 0.1);
  const raio = quantidade === 'poucas' ? 5 : 7.5;
  const quadrados = [];
  for (let cy = 0; cy < linhas; cy++) {
    for (let cx = 0; cx < colunas; cx++) {
      // Canto superior direito, longe do texto e do logo.
      const d = Math.hypot(colunas - 1 - cx, cy) / raio;
      if (d >= 1) continue;
      if (r() < (1 - d) ** 1.6 * 0.95) quadrados.push([cx, cy, d]);
    }
  }
  for (const [cx, cy, d] of quadrados.slice(0, limite)) {
    const x = cx * u;
    const y = cy * u;
    let cor;
    if (tema === 'claro') cor = mistura('#FFFFFF', r() < 0.5 ? p.claro : p.azul, 0.06 + r() * 0.22 * (1 - d * 0.5));
    else if (tema === 'escuro') cor = mistura(p.midnight, r() < 0.65 ? p.azul : p.claro, 0.12 + r() * 0.45 * (1 - d * 0.6));
    else {
      const base = corNoDegradePb(posicaoNoDegradePb(x + u / 2, y + u / 2));
      cor = mistura(base, r() < 0.7 ? p.claro : p.azul, 0.15 + r() * 0.5 * (1 - d * 0.6));
    }
    ctx.fillStyle = cor;
    ctx.fillRect(x, y, u, u);
  }
  return Math.min(quadrados.length, limite);
}

/** Cursor do playbook: retângulo na proporção 1 : 1,83. */
function cursorPb(ctx, x, y, altura, cor) {
  ctx.fillStyle = cor;
  ctx.fillRect(x, y, Math.round(altura / 1.83), altura);
}

/** Rótulo em caixa alta com o cursor antes (o "prompt" do playbook). Devolve a largura usada. */
function rotuloPb(ctx, texto, x, y, cor, corCursor, tamanho = 24) {
  const t = String(texto || '').trim().toUpperCase();
  if (!t) return 0;
  cursorPb(ctx, x, y, Math.round(tamanho * 1.05), corCursor);
  ctx.font = `${tamanho}px "Marca Destaque"`;
  ctx.letterSpacing = `${Math.round(tamanho * 0.12)}px`;
  ctx.fillStyle = cor;
  ctx.textBaseline = 'alphabetic';
  const xt = x + Math.round(tamanho * 1.05 / 1.83) + 14;
  ctx.fillText(t, xt, y + tamanho * 0.9);
  const largura = ctx.measureText(t).width + (xt - x);
  ctx.letterSpacing = '0px';
  return largura;
}

/** Marca, palavra por palavra, o trecho do título que vai em destaque de cor. */
function palavrasComDestaque(texto, destaque) {
  const palavras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const alvo = String(destaque || '').trim().split(/\s+/).filter(Boolean);
  const limpar = (w) => w.toLowerCase().replace(/[.,!?;:"“”'’()]/g, '');
  const marcado = palavras.map(() => false);
  if (alvo.length) {
    for (let i = 0; i + alvo.length <= palavras.length; i++) {
      if (alvo.every((w, k) => limpar(palavras[i + k]) === limpar(w))) {
        for (let k = 0; k < alvo.length; k++) marcado[i + k] = true;
        break;
      }
    }
  }
  return palavras.map((p, i) => ({ p, d: marcado[i] }));
}

/** Manchete em Ubuntu Sans Light, com letras aproximadas e destaque só por cor (nunca negrito). */
function manchetePb(ctx, texto, destaque, { largura, maximo, minimo, maxLinhas, entrelinha = 1.06 }) {
  const palavras = palavrasComDestaque(texto, destaque);
  let resultado = null;
  for (let tamanho = maximo; tamanho >= minimo; tamanho -= 2) {
    ctx.font = `${tamanho}px "Marca Titulo"`;
    ctx.letterSpacing = `${(-tamanho * 0.025).toFixed(1)}px`;
    const espaco = ctx.measureText(' ').width;
    const linhas = [];
    let atual = [];
    let larguraAtual = 0;
    for (const w of palavras) {
      const lw = ctx.measureText(w.p).width;
      if (atual.length && larguraAtual + espaco + lw > largura) {
        linhas.push(atual);
        atual = [];
        larguraAtual = 0;
      }
      atual.push({ ...w, largura: lw });
      larguraAtual += (atual.length > 1 ? espaco : 0) + lw;
    }
    if (atual.length) linhas.push(atual);
    resultado = { tamanho, linhas, entrelinha, espaco, coube: linhas.length <= maxLinhas };
    if (resultado.coube) break;
  }
  ctx.letterSpacing = '0px';
  resultado.altura = resultado.linhas.length * resultado.tamanho * resultado.entrelinha;
  return resultado;
}

function desenharManchetePb(ctx, m, x, y, cor, corDestaque) {
  ctx.font = `${m.tamanho}px "Marca Titulo"`;
  ctx.letterSpacing = `${(-m.tamanho * 0.025).toFixed(1)}px`;
  ctx.textBaseline = 'alphabetic';
  const alt = m.tamanho * m.entrelinha;
  m.linhas.forEach((linha, i) => {
    let cx = x;
    const base = y + i * alt + m.tamanho * 0.86;
    for (const w of linha) {
      ctx.fillStyle = w.d ? corDestaque : cor;
      ctx.fillText(w.p, cx, base);
      cx += w.largura + m.espaco;
    }
  });
  ctx.letterSpacing = '0px';
  return y + m.altura;
}

/**
 * Barra de progresso: degradê sólido Midnight → Capgemini Blue → Light Blue → Turquoise,
 * com a altura de um quadrado da grade. "fracao" revela só parte da barra (progresso do carrossel).
 */
function barraPb(ctx, { x, y, largura, fracao = 1, invertida = false }) {
  const p = paletaPb();
  const g = ctx.createLinearGradient(x - largura * 0.2, 0, x + largura * 1.2, 0);
  // Sobre degradê, o playbook permite a sequência ao contrário, para a barra não sumir no fundo claro.
  const cores = invertida ? [p.turquesa, p.claro, p.azul, p.midnight] : [p.midnight, p.azul, p.claro, p.turquesa];
  g.addColorStop(0, cores[0]);
  g.addColorStop(0.379, cores[1]);
  g.addColorStop(0.621, cores[2]);
  g.addColorStop(1, cores[3]);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, Math.max(PB.u, largura * Math.max(0, Math.min(1, fracao))), PB.u);
}

async function logoPb(ctx, tema, x, y, altura) {
  const logo = await logoDaMarca(tema === 'claro' ? 'horizontal_claro' : 'horizontal_escuro');
  if (logo) colocarLogo(ctx, logo, x, y, altura);
  else await assinatura(ctx, tema === 'claro' ? 'horizontal_claro' : 'horizontal_escuro', x, y, altura, 'esquerda', tema === 'claro' ? paletaPb().azul : '#FFFFFF');
}

function coresDoTemaPb(tema) {
  const p = paletaPb();
  return tema === 'claro'
    ? { texto: p.azul, destaque: p.claro, apoio: p.g6, linha: 'rgba(0, 88, 171, 0.25)', cursor: p.claro }
    : { texto: p.g1, destaque: p.claro, apoio: 'rgba(243, 244, 247, 0.86)', linha: 'rgba(243, 244, 247, 0.35)', cursor: p.claro };
}

/** Post único e capa de carrossel. */
async function capaPb({ fundo, textos, d, semente, cta, fracao = 1, tema }) {
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const { margem, u } = PB;
  const cores = coresDoTemaPb(tema);
  pintarFundoPb(ctx, tema);
  let topoTexto = 330;
  if (fundo) {
    // Foto real (licenciada) no alto, com a pixelização fazendo a transição para o degradê.
    const img = await loadImage(fundo);
    const alturaFoto = 14 * u;
    const escala = Math.max(LARGURA / img.width, alturaFoto / img.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, LARGURA, alturaFoto);
    ctx.clip();
    ctx.drawImage(img, (LARGURA - img.width * escala) / 2, (alturaFoto - img.height * escala) / 2, img.width * escala, img.height * escala);
    ctx.restore();
    const r = sorteador(semente + 5);
    for (let cx = 0; cx < LARGURA / u; cx++) {
      for (let k = 0; k < 2; k++) {
        if (r() < (k === 0 ? 0.55 : 0.25)) {
          ctx.fillStyle = corNoDegradePb(posicaoNoDegradePb(cx * u, alturaFoto + k * u));
          ctx.fillRect(cx * u, alturaFoto - (k + 1) * u, u, u);
        }
      }
    }
    topoTexto = alturaFoto + u * 2;
  } else {
    pixelarPb(ctx, tema, semente, d.formas);
  }
  await logoPb(ctx, fundo ? 'escuro' : tema, margem, margem, 54);

  const rotulo = textos.rotulo_arte || marca.playbook?.rotulo_padrao || '';
  if (rotulo) rotuloPb(ctx, rotulo, margem, topoTexto - 70, cores.texto, cores.cursor);
  const m = manchetePb(ctx, textos.titulo, textos.titulo_destaque, {
    largura: LARGURA - margem * 2,
    maximo: fundo ? (d.texto_maior ? 84 : 76) : d.texto_maior ? 104 : 94,
    minimo: 52,
    maxLinhas: fundo ? 3 : 6,
  });
  let y = desenharManchetePb(ctx, m, margem, topoTexto, cores.texto, cores.destaque);

  // Linha fina e texto de apoio com o cursor, como no "basic with logo" do playbook.
  y += 44;
  ctx.fillStyle = cores.linha;
  ctx.fillRect(margem, y, 8 * u, 2);
  y += 26;
  const sub = ajustarBloco(ctx, textos.subtitulo, { familia: 'Marca Texto', maximo: d.texto_maior ? 40 : 36, minimo: 26, maxLinhas: 4, entrelinha: 1.32, largura: 15 * u });
  cursorPb(ctx, margem, y + 6, 24, cores.cursor);
  desenharBloco(ctx, sub, margem + 30, y, cores.apoio);
  const fimTexto = y + alturaBloco(sub);

  const yBarra = ALTURA - margem - u;
  if (cta) rotuloPb(ctx, cta, margem, yBarra - 70, cores.texto, cores.cursor, 22);
  barraPb(ctx, { x: margem, y: yBarra, largura: LARGURA - margem, fracao, invertida: tema === 'gradiente' && !fundo });
  const transbordou = !m.coube || !sub.coube || fimTexto > yBarra - (cta ? 90 : 40);
  return { canvas, ajustes: { tamanho_titulo: m.tamanho, tamanho_subtitulo: sub.tamanho, altura_card: Math.round(fimTexto - topoTexto), transbordou } };
}

async function renderizarArtePlaybook({ fundo, textos, oferta, design, semente = 1 }) {
  registrarFontes();
  const d = normalizarDesign(design);
  const tema = d.fundo === 'claro' ? 'claro' : d.fundo === 'escuro' ? 'escuro' : 'gradiente';
  const { canvas, ajustes } = await capaPb({ fundo, textos, d, semente, cta: textos.cta_arte, tema });
  if (oferta?.texto_legal) ajustes.transbordou = true;
  return { buffer: await canvas.encode('jpeg', 92), largura: LARGURA, altura: ALTURA, ajustes };
}

/** Slide de conteúdo (fundo branco por padrão) ou cartão de estudo (Midnight Blue por padrão). */
async function slidePb({ titulo, texto, numero, total, d, mostrarNumero, cartao = null, cartoes = 0, semente }) {
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const { margem, u } = PB;
  const p = paletaPb();
  const tema = cartao ? (d.fundo === 'claro' ? 'claro' : 'escuro') : d.fundo === 'escuro' ? 'escuro' : d.fundo === 'gradiente' ? 'gradiente' : 'claro';
  const cores = coresDoTemaPb(tema);
  pintarFundoPb(ctx, tema);
  pixelarPb(ctx, tema, semente + numero * 7, d.formas === 'nenhuma' ? 'nenhuma' : 'poucas');
  await logoPb(ctx, tema, margem, margem, 44);
  if (d.contador) {
    ctx.font = '24px "Marca Destaque"';
    ctx.letterSpacing = '3px';
    ctx.fillStyle = cores.texto;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${String(numero).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, LARGURA - margem, ALTURA - margem - u - 30);
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';
  }
  let y = 6 * u;
  if (cartao) {
    rotuloPb(ctx, `Cartão ${cartao} de ${cartoes}`, margem, y, cores.texto, cores.cursor);
    y += 80;
  } else if (mostrarNumero) {
    ctx.font = `${d.texto_maior ? 230 : 210}px "${marca.fontes.numeros ? 'Marca Numeros' : 'Marca Titulo'}"`;
    ctx.letterSpacing = '-6px';
    ctx.fillStyle = tema === 'claro' ? p.claro : p.claro;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(numero - 1).padStart(2, '0'), margem - 10, y + 150);
    ctx.letterSpacing = '0px';
    y += 210;
  }
  const limite = ALTURA - margem - u - 90;
  const m = manchetePb(ctx, titulo, null, { largura: LARGURA - margem * 2, maximo: d.texto_maior ? 84 : 76, minimo: 46, maxLinhas: 4 });
  y = desenharManchetePb(ctx, m, margem, y, cores.texto, cores.destaque);
  y += 40;
  ctx.fillStyle = cores.linha;
  ctx.fillRect(margem, y, 6 * u, 2);
  y += 30;
  const corpo = ajustarBloco(ctx, texto, { familia: 'Marca Texto', maximo: d.texto_maior ? 44 : 40, minimo: 28, maxLinhas: 8, entrelinha: 1.36, largura: LARGURA - margem * 2 });
  desenharBloco(ctx, corpo, margem, y, cores.apoio);
  const fim = y + alturaBloco(corpo);
  if (d.pontos) barraPb(ctx, { x: margem, y: ALTURA - margem - u, largura: LARGURA - margem, fracao: numero / total, invertida: tema === 'gradiente' });
  return { buffer: await canvas.encode('jpeg', 92), coube: m.coube && corpo.coube && fim <= limite };
}

async function finalPb({ textos, d, total, semente }) {
  const tema = d.fundo === 'claro' ? 'claro' : d.fundo === 'escuro' ? 'escuro' : 'gradiente';
  const cores = coresDoTemaPb(tema);
  const canvas = createCanvas(LARGURA, ALTURA);
  const ctx = canvas.getContext('2d');
  const { margem, u } = PB;
  pintarFundoPb(ctx, tema);
  pixelarPb(ctx, tema, semente + 101, d.formas);
  await logoPb(ctx, tema, margem, margem, 54);
  const m = manchetePb(ctx, textos.fechamento, textos.fechamento_destaque, { largura: LARGURA - margem * 2, maximo: d.texto_maior ? 96 : 88, minimo: 50, maxLinhas: 6 });
  const fim = desenharManchetePb(ctx, m, margem, 330, cores.texto, cores.destaque);
  const yBarra = ALTURA - margem - u;
  if (textos.cta_arte) rotuloPb(ctx, textos.cta_arte, margem, yBarra - 70, cores.texto, cores.cursor, 22);
  barraPb(ctx, { x: margem, y: yBarra, largura: LARGURA - margem, fracao: 1, invertida: tema === 'gradiente' });
  return { buffer: await canvas.encode('jpeg', 92), coube: m.coube && fim <= yBarra - 110 };
}

async function renderizarCarrosselPlaybook({ fundo, textos, formato, design, semente = 1 }) {
  registrarFontes();
  const d = normalizarDesign(design);
  const miolo = textos.slides || [];
  const total = miolo.length + 2;
  const mostrarNumero =
    d.numeros_grandes === 'sim' || (d.numeros_grandes === 'auto' && formato !== 'flashcards' && !miolo.some((s) => temNumeracaoPropria(s.titulo)));
  const temaCapa = d.fundo === 'claro' ? 'claro' : d.fundo === 'escuro' ? 'escuro' : 'gradiente';
  const capa = await capaPb({ fundo, textos, d, semente, cta: 'Deslize para o lado', fracao: d.pontos ? 1 / total : 1, tema: temaCapa });
  const slides = [await capa.canvas.encode('jpeg', 92)];
  let coube = !capa.ajustes.transbordou;
  for (const [i, item] of miolo.entries()) {
    const r = await slidePb({
      ...item,
      numero: i + 2,
      total,
      d,
      mostrarNumero,
      semente,
      ...(formato === 'flashcards' ? { cartao: i + 1, cartoes: miolo.length } : {}),
    });
    slides.push(r.buffer);
    coube &&= r.coube;
  }
  const final = await finalPb({ textos, d, total, semente });
  slides.push(final.buffer);
  coube &&= final.coube;
  return { slides, largura: LARGURA, altura: ALTURA, ajustes: { ...capa.ajustes, slides: total, transbordou: !coube } };
}
