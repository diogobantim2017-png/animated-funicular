import { env, marca, politica, segmentos, pendenciasDeConfiguracao } from './config.js';
import { hojeNoFuso, ehDoDia } from './util.js';
import { ofertaPorId } from './sinais.js';
import {
  radar,
  criarBrief,
  escreverTextos,
  montarPromptImagem,
  montarLegendaFinal,
  categoriasDisponiveis,
} from './agentes.js';
import { renderizarArte } from './arte.js';
import { avaliarRegras } from './regras.js';
import { avaliarComVisao } from './juiz.js';
import { consolidarGate, decidirRota, calcularMetricas } from './autonomia.js';

export const VEREDITOS = {
  publicavel: 'Publicável sem humano',
  precisa_humano: 'Precisa de revisão humana',
  bloqueada: 'Bloqueada pelas travas',
};

export function erroHttp(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

const CAMPOS_EDITAVEIS = ['titulo', 'subtitulo', 'cta_arte', 'legenda', 'hashtags'];

export function criarMotor({ db, ia, imagem, canal, sortear = Math.random, agora = () => new Date() }) {
  let emGeracao = null;
  const ocupadas = new Set();

  const hoje = () => hojeNoFuso(env.fuso, agora());
  const instante = () => agora().toISOString();

  const auditar = (peca_id, etapa, ator, resumo, detalhe = null) =>
    db.registrarAuditoria({ peca_id, etapa, ator, resumo, detalhe });

  async function modoDaCategoria(id) {
    const modos = await db.obterModosCategorias();
    return modos[id]?.modo || 'humano';
  }

  function verificarChaves() {
    const faltando = [];
    if (!env.anthropicKey) faltando.push('ANTHROPIC_API_KEY');
    if (imagem.provedor === 'openai' && !env.openaiKey) faltando.push('OPENAI_API_KEY');
    if (imagem.provedor === 'google' && !env.googleKey) faltando.push('GOOGLE_API_KEY');
    if (faltando.length) throw erroHttp(400, `Configure no .env: ${faltando.join(', ')}.`);
  }

  /* ---------------------------------------------------------- etapas */

  async function montarArte(id, { fundo, textos, oferta, versao }) {
    const r = await renderizarArte({ fundo, textos, oferta });
    const salvo = await db.salvarMidia(`${id}-arte-${versao}.jpg`, r.buffer, 'image/jpeg');
    const registro = { chave: salvo.chave, url: salvo.url, largura: r.largura, altura: r.altura, ajustes: r.ajustes };
    await db.atualizarPeca(id, { arte: registro });
    await auditar(id, 'arte', 'template', 'Arte composta com o template da marca', registro);
    return r.buffer;
  }

  async function gerarImagemEArte(id, { brief, textos, oferta, direcaoExtra }) {
    await db.atualizarPeca(id, { etapa: 'imagem' });
    const prompt = direcaoExtra
      ? `${montarPromptImagem(brief)} Additional direction from the human reviewer (in Portuguese): ${direcaoExtra}`
      : montarPromptImagem(brief);
    const inicio = Date.now();
    const gerada = await imagem.gerar(prompt);
    const versao = Date.now();
    const extensao = gerada.mime.includes('jpeg') ? 'jpg' : gerada.mime.includes('webp') ? 'webp' : 'png';
    const salvo = await db.salvarMidia(`${id}-fundo-${versao}.${extensao}`, gerada.buffer, gerada.mime);
    const registro = {
      provedor: imagem.provedor,
      modelo: imagem.modelo,
      prompt,
      chave: salvo.chave,
      url: salvo.url,
      segundos: Math.round((Date.now() - inicio) / 1000),
    };
    await db.atualizarPeca(id, { etapa: 'arte', imagem: registro });
    await auditar(id, 'imagem', `ia:imagem:${imagem.provedor}`, `Fundo gerado com ${imagem.modelo}`, registro);
    const arte = await montarArte(id, { fundo: gerada.buffer, textos, oferta, versao });
    return { fundo: gerada.buffer, arte };
  }

  async function avaliarEDecidir(id, { inicial, buffers }) {
    let peca = await db.atualizarPeca(id, { etapa: 'governanca' });
    const fundo = buffers?.fundo ?? (await db.lerMidia(peca.imagem.chave));
    const arte = buffers?.arte ?? (await db.lerMidia(peca.arte.chave));
    const segmento = segmentos.find((s) => s.id === peca.segmento_id);

    const regras = avaliarRegras({
      textos: peca.textos,
      categoriaId: peca.categoria,
      segmentoId: peca.segmento_id,
      ofertaId: peca.oferta_id,
      arte: peca.arte,
      hoje: hoje(),
      modoPublicacao: canal.modo,
    });
    const apontamentos = regras.filter((r) => !r.ok).length;
    await auditar(id, 'regras', 'regras', `${regras.length - apontamentos} de ${regras.length} travas sem apontamento`, regras);

    const juiz = await avaliarComVisao({
      ia,
      fundo,
      arte,
      textos: peca.textos,
      brief: peca.brief,
      oportunidade: peca.oportunidade,
      segmento,
    });
    await auditar(id, 'revisor_ia', 'ia:revisor', `Risco ${juiz.risco_reputacional}; ${juiz.aprovaria_sem_edicao ? 'publicaria como está' : 'editaria antes'}`, juiz);

    const gate = consolidarGate({ regras, juiz });
    const governanca = {
      regras,
      juiz,
      gate,
      veredito_inicial: peca.governanca?.veredito_inicial ?? gate.veredito,
      avaliada_em: instante(),
    };
    await auditar(id, 'gate', 'governanca', VEREDITOS[gate.veredito], gate);

    if (!inicial) {
      return db.atualizarPeca(id, {
        governanca,
        status: 'em_revisao',
        etapa: null,
        erro: null,
        decisao: { tipo: 'fila_humana', motivo: 'Peça alterada por humano volta para revisão', em: instante() },
      });
    }

    const decisao = decidirRota({
      gate,
      modoCategoria: await modoDaCategoria(peca.categoria),
      controle: await db.obterControle(),
      sortear,
    });
    await auditar(id, 'decisao', 'governanca', decisao.motivo, decisao);

    if (decisao.rota === 'publicar') {
      await db.atualizarPeca(id, {
        governanca,
        status: 'aprovada',
        etapa: null,
        decisao: { tipo: 'automatica', motivo: decisao.motivo, em: instante() },
      });
      return publicarPeca(id, { ator: 'sistema:autonomia' });
    }
    peca = await db.atualizarPeca(id, {
      governanca,
      status: 'em_revisao',
      etapa: null,
      decisao: { tipo: 'fila_humana', motivo: decisao.motivo, amostra_auditoria: Boolean(decisao.amostra_auditoria), em: instante() },
    });
    return peca;
  }

  async function executarPipeline(id, orientacao) {
    let etapa = 'radar';
    try {
      const dia = hoje();
      const historico = (await db.listarPecas({ limite: 13 }))
        .filter((p) => p.id !== id && p.oportunidade)
        .slice(0, 12)
        .map((p) => ({ criada_em: p.criada_em, categoria: p.categoria, tema: p.oportunidade.tema, status: p.status }));

      const rRadar = await radar({ ia, hoje: dia, historico, orientacao });
      const oportunidade = rRadar.dados;
      const oferta = oportunidade.oferta_id ? ofertaPorId(oportunidade.oferta_id) : null;
      etapa = 'brief';
      await db.atualizarPeca(id, { etapa, categoria: oportunidade.categoria, oportunidade, oferta_id: oportunidade.oferta_id || null });
      await auditar(id, 'radar', 'ia:radar', oportunidade.tema, { oportunidade, sinais: rRadar.contexto, modelo: rRadar.modelo });

      const rBrief = await criarBrief({ ia, oportunidade, oferta });
      const brief = rBrief.dados;
      const segmento = segmentos.find((s) => s.id === brief.segmento_id);
      etapa = 'textos';
      await db.atualizarPeca(id, { etapa, brief, segmento_id: brief.segmento_id });
      await auditar(id, 'brief', 'ia:estrategista', `Público: ${segmento?.nome || brief.segmento_id}`, { brief, modelo: rBrief.modelo });

      const rTextos = await escreverTextos({ ia, oportunidade, brief, segmento, oferta });
      const textos = rTextos.dados;
      etapa = 'imagem';
      await db.atualizarPeca(id, { etapa, textos });
      await auditar(id, 'textos', 'ia:redator', textos.titulo, { textos, modelo: rTextos.modelo });

      const buffers = await gerarImagemEArte(id, { brief, textos, oferta });
      etapa = 'governanca';
      return await avaliarEDecidir(id, { inicial: true, buffers });
    } catch (erro) {
      await db.atualizarPeca(id, { status: 'erro', erro: erro.message });
      await auditar(id, 'erro', 'sistema', `Falha na etapa ${etapa}: ${erro.message}`);
      throw erro;
    }
  }

  /* ------------------------------------------------------- publicação */

  async function publicarPeca(id, { ator }) {
    const peca = await db.obterPeca(id);
    const controle = await db.obterControle();
    if (controle.pausado) {
      await auditar(id, 'publicacao', ator, 'Publicação retida: sistema pausado');
      return db.atualizarPeca(id, { status: 'aprovada', publicacao: { pendente: true, motivo: 'Sistema pausado' } });
    }

    const regras = avaliarRegras({
      textos: peca.textos,
      categoriaId: peca.categoria,
      segmentoId: peca.segmento_id,
      ofertaId: peca.oferta_id,
      arte: peca.arte,
      hoje: hoje(),
      modoPublicacao: canal.modo,
    });
    const bloqueios = regras.filter((r) => !r.ok && r.severidade === 'bloqueio');
    if (bloqueios.length) {
      const motivo = `Nova checagem no momento da publicação encontrou bloqueio: ${bloqueios.map((b) => b.nome).join(', ')}`;
      await auditar(id, 'publicacao', 'regras', motivo, bloqueios);
      return db.atualizarPeca(id, { status: 'aprovada', publicacao: { pendente: true, motivo } });
    }

    const dia = hoje();
    const publicadasHoje = (await db.listarPecas({ status: 'publicada', limite: 500 })).filter((p) =>
      ehDoDia(p.publicacao?.em, dia, env.fuso),
    ).length;
    if (publicadasHoje >= politica.limites.publicacoes_por_dia) {
      const motivo = `Limite de ${politica.limites.publicacoes_por_dia} publicações por dia atingido. Publica no próximo ciclo.`;
      await auditar(id, 'publicacao', 'governanca', motivo);
      return db.atualizarPeca(id, { status: 'aprovada', publicacao: { pendente: true, motivo } });
    }

    const oferta = peca.oferta_id ? ofertaPorId(peca.oferta_id) : null;
    const legenda = montarLegendaFinal({ textos: peca.textos, oferta });
    try {
      const r = await canal.publicar({ urlImagem: peca.arte.url, legenda });
      const publicacao = { ...r, canal: canal.nome, em: instante(), legenda_final: legenda, ator };
      await auditar(
        id,
        'publicacao',
        ator,
        r.modo === 'real' ? `Publicado no Instagram${r.permalink ? `: ${r.permalink}` : ''}` : 'Publicação simulada, nada foi enviado',
        publicacao,
      );
      return db.atualizarPeca(id, { status: 'publicada', publicacao });
    } catch (erro) {
      await auditar(id, 'publicacao', ator, `Falha ao publicar: ${erro.message}`);
      return db.atualizarPeca(id, { status: 'aprovada', publicacao: { pendente: true, motivo: 'Falha na publicação', erro: erro.message } });
    }
  }

  async function publicarPendentes(ator) {
    const pendentes = (await db.listarPecas({ status: 'aprovada', limite: 50 })).reverse();
    for (const p of pendentes) {
      const r = await publicarPeca(p.id, { ator });
      if (r.status !== 'publicada') break;
    }
  }

  /** Se a concordância de uma categoria automática cair abaixo da meta, ela volta para o modo humano. */
  async function revisarAutonomia(categoriaId) {
    if ((await modoDaCategoria(categoriaId)) !== 'auto') return;
    const m = calcularMetricas(await db.listarPecas({ limite: 2000 }), categoriaId);
    if (m.revisadas_com_gate_publicavel >= m.min_amostras && m.concordancia < m.meta_concordancia) {
      await db.definirModoCategoria(categoriaId, 'humano', 'sistema:autonomia');
      await auditar(
        null,
        'autonomia',
        'sistema:autonomia',
        `${politica.categorias[categoriaId].nome}: autonomia revogada, concordância caiu para ${Math.round(m.concordancia * 100)}%`,
        m,
      );
    }
  }

  function emSegundoPlano(id, tarefa) {
    if (ocupadas.has(id)) throw erroHttp(409, 'Esta peça já está sendo processada. Aguarde.');
    ocupadas.add(id);
    tarefa()
      .catch(async (erro) => {
        await db.atualizarPeca(id, { status: 'em_revisao', etapa: null, erro: erro.message });
        await auditar(id, 'erro', 'sistema', `Falha: ${erro.message}`);
      })
      .finally(() => ocupadas.delete(id));
  }

  async function exigirEmRevisao(id) {
    const peca = await db.obterPeca(id);
    if (!peca) throw erroHttp(404, 'Peça não encontrada.');
    if (peca.status !== 'em_revisao') throw erroHttp(409, 'Esta ação só vale para peças em revisão.');
    if (ocupadas.has(id)) throw erroHttp(409, 'Esta peça já está sendo processada. Aguarde.');
    return peca;
  }

  /* ------------------------------------------------------- API pública */

  return {
    async gerar({ origem = 'manual', orientacao = null, usuario = 'equipe', aguardar = false } = {}) {
      verificarChaves();
      if (emGeracao) throw erroHttp(409, 'Já existe uma peça sendo gerada. Aguarde terminar.');
      if (orientacao?.categoria && !politica.categorias[orientacao.categoria]) {
        throw erroHttp(400, `Categoria "${orientacao.categoria}" não existe na política.`);
      }
      const dia = hoje();
      const geradasHoje = (await db.listarPecas({ limite: 500 })).filter((p) => ehDoDia(p.criada_em, dia, env.fuso)).length;
      if (geradasHoje >= politica.limites.geracoes_por_dia) {
        throw erroHttp(429, `Limite de ${politica.limites.geracoes_por_dia} gerações por dia atingido. Ajuste em politica.json.`);
      }
      const peca = await db.criarPeca({
        status: 'gerando',
        etapa: 'radar',
        categoria: orientacao?.categoria || null,
        origem,
        orientacao,
        criada_por: usuario,
        politica_versao: politica.versao,
      });
      emGeracao = peca.id;
      await auditar(
        peca.id,
        'inicio',
        origem === 'agenda' ? 'sistema:agenda' : `humano:${usuario}`,
        origem === 'agenda' ? 'Geração iniciada pela agenda automática' : 'Geração iniciada no painel',
        { orientacao, politica_versao: politica.versao },
      );
      const execucao = executarPipeline(peca.id, orientacao).finally(() => {
        emGeracao = null;
      });
      if (aguardar) return execucao;
      execucao.catch(() => {});
      return peca;
    },

    async aprovar(id, usuario) {
      const peca = await exigirEmRevisao(id);
      if (peca.governanca?.gate?.veredito === 'bloqueada') {
        throw erroHttp(409, 'Peça bloqueada pelas travas. Edite os textos ou gere nova imagem antes de aprovar.');
      }
      await db.atualizarPeca(id, {
        status: 'aprovada',
        revisao: { acao: 'aprovada', usuario, em: instante(), com_intervencao: Boolean(peca.intervencao_humana) },
        decisao: { ...peca.decisao, tipo: 'humana', aprovada_por: usuario },
      });
      await auditar(id, 'revisao', `humano:${usuario}`, peca.intervencao_humana ? 'Aprovada após ajustes' : 'Aprovada sem edição');
      const resultado = await publicarPeca(id, { ator: `humano:${usuario}` });
      await revisarAutonomia(peca.categoria);
      return resultado;
    },

    async publicarAgora(id, usuario) {
      const peca = await db.obterPeca(id);
      if (!peca) throw erroHttp(404, 'Peça não encontrada.');
      if (peca.status !== 'aprovada') throw erroHttp(409, 'Só peças aprovadas aguardando publicação podem ser publicadas.');
      return publicarPeca(id, { ator: `humano:${usuario}` });
    },

    async reprovar(id, usuario, motivo) {
      const peca = await exigirEmRevisao(id);
      const atualizada = await db.atualizarPeca(id, {
        status: 'reprovada',
        revisao: { acao: 'reprovada', usuario, motivo: motivo || null, em: instante(), com_intervencao: Boolean(peca.intervencao_humana) },
      });
      await auditar(id, 'revisao', `humano:${usuario}`, `Reprovada${motivo ? `: ${motivo}` : ''}`);
      await revisarAutonomia(peca.categoria);
      return atualizada;
    },

    async editarTextos(id, usuario, novos) {
      const peca = await exigirEmRevisao(id);
      const textos = { ...peca.textos };
      for (const campo of CAMPOS_EDITAVEIS) {
        if (novos[campo] === undefined) continue;
        textos[campo] =
          campo === 'hashtags'
            ? (Array.isArray(novos.hashtags) ? novos.hashtags : String(novos.hashtags).split(/[\s,]+/))
                .map((h) => h.trim())
                .filter(Boolean)
                .map((h) => (h.startsWith('#') ? h : `#${h}`))
            : String(novos[campo]);
      }
      const alterados = CAMPOS_EDITAVEIS.filter((c) => JSON.stringify(textos[c]) !== JSON.stringify(peca.textos[c]));
      if (!alterados.length) throw erroHttp(400, 'Nenhum texto foi alterado.');
      await db.atualizarPeca(id, { textos, intervencao_humana: true, status: 'gerando', etapa: 'arte', erro: null });
      await auditar(id, 'edicao', `humano:${usuario}`, `Textos editados: ${alterados.join(', ')}`, {
        antes: Object.fromEntries(alterados.map((c) => [c, peca.textos[c]])),
        depois: Object.fromEntries(alterados.map((c) => [c, textos[c]])),
      });
      emSegundoPlano(id, async () => {
        const fundo = await db.lerMidia(peca.imagem.chave);
        const oferta = peca.oferta_id ? ofertaPorId(peca.oferta_id) : null;
        const arte = await montarArte(id, { fundo, textos, oferta, versao: Date.now() });
        await avaliarEDecidir(id, { inicial: false, buffers: { fundo, arte } });
      });
      return db.obterPeca(id);
    },

    async regenerarImagem(id, usuario, direcao) {
      const peca = await exigirEmRevisao(id);
      verificarChaves();
      await db.atualizarPeca(id, { intervencao_humana: true, status: 'gerando', etapa: 'imagem', erro: null });
      await auditar(id, 'edicao', `humano:${usuario}`, `Nova imagem solicitada${direcao ? `: ${direcao}` : ''}`);
      emSegundoPlano(id, async () => {
        const oferta = peca.oferta_id ? ofertaPorId(peca.oferta_id) : null;
        const buffers = await gerarImagemEArte(id, { brief: peca.brief, textos: peca.textos, oferta, direcaoExtra: direcao });
        await avaliarEDecidir(id, { inicial: false, buffers });
      });
      return db.obterPeca(id);
    },

    async definirModo(categoriaId, modo, usuario) {
      const categoria = politica.categorias[categoriaId];
      if (!categoria) throw erroHttp(404, 'Categoria não encontrada.');
      if (!['auto', 'humano'].includes(modo)) throw erroHttp(400, 'Modo deve ser auto ou humano.');
      if (modo === 'auto') {
        const m = calcularMetricas(await db.listarPecas({ limite: 2000 }), categoriaId);
        if (!m.pode_liberar) throw erroHttp(409, m.motivo_bloqueio_liberacao);
      }
      await db.definirModoCategoria(categoriaId, modo, usuario);
      await auditar(null, 'autonomia', `humano:${usuario}`, `${categoria.nome}: modo ${modo === 'auto' ? 'automático' : 'humano'}`, {
        categoria: categoriaId,
        modo,
      });
    },

    async pausar(usuario, motivo) {
      await db.definirControle({ pausado: true, motivo: motivo || null, atualizado_por: usuario });
      await auditar(null, 'controle', `humano:${usuario}`, `Sistema pausado${motivo ? `: ${motivo}` : ''}`);
    },

    async retomar(usuario) {
      await db.definirControle({ pausado: false, motivo: null, atualizado_por: usuario });
      await auditar(null, 'controle', `humano:${usuario}`, 'Sistema retomado');
      await publicarPendentes(`humano:${usuario}`);
    },

    async cicloAutomatico() {
      const controle = await db.obterControle();
      if (controle.pausado) {
        await auditar(null, 'agenda', 'sistema:agenda', 'Ciclo ignorado: sistema pausado');
        return;
      }
      await publicarPendentes('sistema:agenda');
      try {
        await this.gerar({ origem: 'agenda', usuario: 'agenda', aguardar: true });
      } catch (erro) {
        await auditar(null, 'agenda', 'sistema:agenda', `Ciclo sem nova peça: ${erro.message}`);
      }
    },

    async detalhe(id) {
      const peca = await db.obterPeca(id);
      if (!peca) throw erroHttp(404, 'Peça não encontrada.');
      const oferta = peca.oferta_id ? ofertaPorId(peca.oferta_id) : null;
      return {
        peca,
        auditoria: await db.listarAuditoria(id),
        categoria: politica.categorias[peca.categoria] || null,
        segmento: segmentos.find((s) => s.id === peca.segmento_id) || null,
        oferta,
        legenda_final: peca.publicacao?.legenda_final || (peca.textos?.legenda ? montarLegendaFinal({ textos: peca.textos, oferta }) : null),
        processando: ocupadas.has(id) || emGeracao === id,
      };
    },

    async listar({ status } = {}) {
      const pecas = await db.listarPecas({ status, limite: 200 });
      return pecas.map((p) => ({
        id: p.id,
        criada_em: p.criada_em,
        status: p.status,
        etapa: p.etapa,
        categoria: p.categoria,
        categoria_nome: politica.categorias[p.categoria]?.nome || null,
        tema: p.oportunidade?.tema || null,
        titulo: p.textos?.titulo || null,
        arte_url: p.arte?.url || null,
        veredito: p.governanca?.gate?.veredito || null,
        decisao: p.decisao?.tipo || null,
        amostra_auditoria: Boolean(p.decisao?.amostra_auditoria),
        publicacao: p.publicacao ? { modo: p.publicacao.modo, permalink: p.publicacao.permalink, pendente: p.publicacao.pendente, motivo: p.publicacao.motivo } : null,
        erro: p.erro || null,
      }));
    },

    async estado() {
      const pecas = await db.listarPecas({ limite: 2000 });
      const modos = await db.obterModosCategorias();
      const dia = hoje();
      return {
        hoje: dia,
        controle: await db.obterControle(),
        em_geracao: emGeracao,
        contagens: {
          em_revisao: pecas.filter((p) => p.status === 'em_revisao').length,
          aguardando_publicacao: pecas.filter((p) => p.status === 'aprovada').length,
          geradas_hoje: pecas.filter((p) => ehDoDia(p.criada_em, dia, env.fuso)).length,
          publicadas_hoje: pecas.filter((p) => p.status === 'publicada' && ehDoDia(p.publicacao?.em, dia, env.fuso)).length,
          total: pecas.length,
        },
        limites: politica.limites,
        categorias: Object.entries(politica.categorias).map(([id, c]) => ({
          id,
          nome: c.nome,
          risco: c.risco,
          autonomia_maxima: c.autonomia_maxima,
          modo: modos[id]?.modo || 'humano',
          modo_atualizado_por: modos[id]?.atualizado_por || null,
          disponivel_hoje: categoriasDisponiveis(dia).some((d) => d.id === id),
          metricas: calcularMetricas(pecas, id),
        })),
        config: {
          marca: marca.nome,
          publicacao_modo: canal.modo,
          canal: canal.nome,
          provedor_imagem: imagem.provedor,
          modelo_imagem: imagem.modelo,
          modelo_ia: env.modeloIa,
          modelo_revisor: env.modeloJuiz,
          armazenamento: db.tipo,
          fuso: env.fuso,
          politica_versao: politica.versao,
          autonomia: politica.autonomia,
        },
        pendencias: pendenciasDeConfiguracao(),
      };
    },
  };
}
