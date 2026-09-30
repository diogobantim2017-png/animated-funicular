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
import { renderizarArte, renderizarCarrossel } from './arte.js';
import { normalizarFormato, formatoDaPeca, visualDaPeca } from './formatos.js';
import { avaliarRegras } from './regras.js';
import { avaliarComVisao } from './juiz.js';
import { consolidarGate, decidirRota, calcularMetricas } from './autonomia.js';
import {
  PROGRAMACAO_PADRAO,
  DIAS_DA_SEMANA,
  normalizarProgramacao,
  proximosHorarios,
  horariosOcupados,
  proximoHorarioLivre,
  instanteNoFuso,
} from './programacao.js';

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

const CAMPOS_EDITAVEIS = ['titulo', 'subtitulo', 'cta_arte', 'legenda', 'hashtags', 'fechamento', 'slides'];

export function criarMotor({ db, ia, imagem, fotos = null, canal, sortear = Math.random, agora = () => new Date() }) {
  let emGeracao = null;
  const ocupadas = new Set();
  /** Horários da programação cuja geração automática já falhou nesta execução (evita tentar a cada minuto). */
  const tentativasFalhas = new Set();

  const hoje = () => hojeNoFuso(env.fuso, agora());
  const instante = () => agora().toISOString();

  const auditar = (peca_id, etapa, ator, resumo, detalhe = null) =>
    db.registrarAuditoria({ peca_id, etapa, ator, resumo, detalhe });

  const descreverHorario = (iso) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: env.fuso,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  async function lerProgramacao() {
    try {
      const salvo = await db.obterProgramacao();
      return {
        ...PROGRAMACAO_PADRAO,
        ...(salvo?.dados || {}),
        atualizado_em: salvo?.atualizado_em || null,
        atualizado_por: salvo?.atualizado_por || null,
        indisponivel: null,
      };
    } catch {
      return { ...PROGRAMACAO_PADRAO, indisponivel: 'Para usar a programação, rode de novo o arquivo schema.sql no SQL Editor do Supabase.' };
    }
  }

  /** Horário sugerido para uma peça: o horário para o qual ela foi gerada, se ainda estiver livre, ou o próximo livre. */
  async function horarioSugerido(peca) {
    const prog = await lerProgramacao();
    const pecas = await db.listarPecas({ limite: 500 });
    const agoraDt = agora();
    if (peca.para_horario && new Date(peca.para_horario) > agoraDt && !horariosOcupados(pecas, { ignorar: peca.id }).has(peca.para_horario)) {
      return peca.para_horario;
    }
    return proximoHorarioLivre(prog, pecas, { agora: agoraDt, fuso: env.fuso, ignorar: peca.id });
  }

  /** Converte a escolha do painel ("agora", "proximo" ou uma data) em horário ISO, ou null para publicar já. */
  async function resolverQuando(peca, quando) {
    if (!quando || quando === 'agora') return null;
    if (quando === 'proximo') {
      const para = await horarioSugerido(peca);
      if (!para) throw erroHttp(400, 'Não há horários na programação. Cadastre horários na aba Programação ou publique agora.');
      return para;
    }
    // Data e hora sem fuso (vinda do painel) valem no fuso do sistema, o mesmo dos horários exibidos.
    const semFuso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(quando));
    const data = semFuso ? instanteNoFuso(semFuso[1], semFuso[2], env.fuso) : new Date(quando);
    if (Number.isNaN(data.getTime())) throw erroHttp(400, 'Data e hora inválidas.');
    if (data.getTime() < agora().getTime() + 60_000) throw erroHttp(400, 'Escolha um horário no futuro.');
    if (data.getTime() > agora().getTime() + 90 * 86_400_000) throw erroHttp(400, 'Escolha um horário nos próximos 90 dias.');
    return data.toISOString();
  }

  async function agendarPeca(id, { para, ator, resumo }) {
    await auditar(id, 'agendamento', ator, `${resumo} para ${descreverHorario(para)}`, { para });
    return db.atualizarPeca(id, { status: 'agendada', agendamento: { para, definido_por: ator, em: instante() }, publicacao: null });
  }

  async function modoDaCategoria(id) {
    const modos = await db.obterModosCategorias();
    return modos[id]?.modo || 'humano';
  }

  function verificarChaves(visual = 'ia') {
    const faltando = [];
    if (!env.anthropicKey) faltando.push('ANTHROPIC_API_KEY');
    if (visual === 'ia' && imagem.provedor === 'openai' && !env.openaiKey) faltando.push('OPENAI_API_KEY');
    if (visual === 'ia' && imagem.provedor === 'google' && !env.googleKey) faltando.push('GOOGLE_API_KEY');
    if (visual === 'foto' && !fotos?.disponivel) faltando.push('PEXELS_API_KEY (fotos reais)');
    if (faltando.length) throw erroHttp(400, `Configure no .env: ${faltando.join(', ')}.`);
  }

  /* ---------------------------------------------------------- etapas */

  /** Monta a arte do post ou todas as imagens do carrossel e registra na peça. */
  async function montarVisual(id, { peca, fundo, textos, oferta, versao }) {
    const formato = formatoDaPeca(peca);
    const visual = visualDaPeca(peca);
    const credito = peca.imagem?.credito || null;
    const semente = peca.design_semente || 1;
    if (formato === 'post') {
      const r = await renderizarArte({ fundo, textos, oferta, visual, credito, semente });
      const salvo = await db.salvarMidia(`${id}-arte-${versao}.jpg`, r.buffer, 'image/jpeg');
      const registro = { chave: salvo.chave, url: salvo.url, largura: r.largura, altura: r.altura, ajustes: r.ajustes };
      await db.atualizarPeca(id, { arte: registro, slides_arte: null });
      await auditar(id, 'arte', 'template', 'Arte composta com o template da marca', registro);
      return { arte: r.buffer, slides: null };
    }
    const r = await renderizarCarrossel({ fundo, textos, oferta, formato, visual, credito, semente });
    const slides = [];
    for (const [i, buffer] of r.slides.entries()) {
      const salvo = await db.salvarMidia(`${id}-slide-${i + 1}-${versao}.jpg`, buffer, 'image/jpeg');
      slides.push({ chave: salvo.chave, url: salvo.url });
    }
    const registro = { ...slides[0], largura: r.largura, altura: r.altura, ajustes: r.ajustes };
    await db.atualizarPeca(id, { arte: registro, slides_arte: slides });
    await auditar(
      id,
      'arte',
      'template',
      `${formato === 'flashcards' ? 'Flashcards' : 'Carrossel'} com ${slides.length} imagens montado com o template da marca`,
      { ...registro, slides },
    );
    return { arte: r.slides[0], slides: r.slides };
  }

  /** Obtém a imagem de fundo conforme a escolha (IA, foto real ou só design) e monta a arte. */
  async function produzirVisual(id, { peca, textos, oferta, direcaoExtra = null, evitarFotos = [] }) {
    const visual = visualDaPeca(peca);
    const brief = peca.brief;
    let fundo = null;
    let registro = null;
    await db.atualizarPeca(id, { etapa: 'imagem' });
    const inicio = Date.now();
    if (visual === 'ia') {
      const prompt = direcaoExtra
        ? `${montarPromptImagem(brief)} Additional direction from the human reviewer (in Portuguese): ${direcaoExtra}`
        : montarPromptImagem(brief);
      const gerada = await imagem.gerar(prompt);
      const extensao = gerada.mime.includes('jpeg') ? 'jpg' : gerada.mime.includes('webp') ? 'webp' : 'png';
      const salvo = await db.salvarMidia(`${id}-fundo-${Date.now()}.${extensao}`, gerada.buffer, gerada.mime);
      registro = {
        origem: 'ia',
        provedor: imagem.provedor,
        modelo: imagem.modelo,
        prompt,
        chave: salvo.chave,
        url: salvo.url,
        segundos: Math.round((Date.now() - inicio) / 1000),
      };
      await auditar(id, 'imagem', `ia:imagem:${imagem.provedor}`, `Fundo gerado com ${imagem.modelo}`, registro);
      fundo = gerada.buffer;
    } else if (visual === 'foto') {
      if (!fotos) throw new Error('Banco de fotos não configurado.');
      const foto = await fotos.buscar(brief.busca_foto_en || brief.prompt_imagem_en, { evitar: evitarFotos });
      const salvo = await db.salvarMidia(`${id}-foto-${Date.now()}.jpg`, foto.buffer, foto.mime);
      registro = {
        origem: 'foto',
        provedor: fotos.provedor,
        consulta: foto.consulta,
        foto_id: foto.id,
        credito: foto.credito,
        chave: salvo.chave,
        url: salvo.url,
        segundos: Math.round((Date.now() - inicio) / 1000),
      };
      await auditar(id, 'imagem', `banco:${fotos.provedor}`, `Foto real de ${foto.credito.autor} (${foto.credito.fonte})`, registro);
      fundo = foto.buffer;
    } else {
      await auditar(id, 'imagem', 'template', 'Sem imagem: peça feita só com o design da marca');
    }
    const atual = await db.atualizarPeca(id, { etapa: 'arte', imagem: registro });
    const artes = await montarVisual(id, { peca: atual, fundo, textos, oferta, versao: Date.now() });
    return { fundo, ...artes };
  }

  async function avaliarEDecidir(id, { inicial, buffers }) {
    let peca = await db.atualizarPeca(id, { etapa: 'governanca' });
    const fundo = buffers ? buffers.fundo : peca.imagem?.chave ? await db.lerMidia(peca.imagem.chave) : null;
    const arte = buffers?.arte ?? (await db.lerMidia(peca.arte.chave));
    const slides = buffers
      ? buffers.slides
      : peca.slides_arte?.length
        ? await Promise.all(peca.slides_arte.map((sl) => db.lerMidia(sl.chave)))
        : null;
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
      slides,
      visual: visualDaPeca(peca),
      formato: formatoDaPeca(peca),
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
      peca = await db.atualizarPeca(id, {
        governanca,
        status: 'aprovada',
        etapa: null,
        decisao: { tipo: 'automatica', motivo: decisao.motivo, em: instante() },
      });
      const prog = await lerProgramacao();
      const para = prog.horarios.length ? await horarioSugerido(peca) : null;
      if (para) return agendarPeca(id, { para, ator: 'sistema:autonomia', resumo: 'Aprovada pelas travas e agendada sozinha' });
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

      const escolha = await db.obterPeca(id);
      const formato = formatoDaPeca(escolha);
      const numSlides = escolha.num_slides || 1;
      const rBrief = await criarBrief({ ia, oportunidade, oferta, formato, numSlides, visual: visualDaPeca(escolha) });
      const brief = rBrief.dados;
      const segmento = segmentos.find((s) => s.id === brief.segmento_id);
      etapa = 'textos';
      await db.atualizarPeca(id, { etapa, brief, segmento_id: brief.segmento_id });
      await auditar(id, 'brief', 'ia:estrategista', `Público: ${segmento?.nome || brief.segmento_id}`, { brief, modelo: rBrief.modelo });

      const rTextos = await escreverTextos({ ia, oportunidade, brief, segmento, oferta, formato, numSlides });
      const textos = rTextos.dados;
      etapa = 'imagem';
      await db.atualizarPeca(id, { etapa, textos });
      await auditar(id, 'textos', 'ia:redator', textos.titulo, { textos, modelo: rTextos.modelo });

      const buffers = await produzirVisual(id, { peca: await db.obterPeca(id), textos, oferta });
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
    const legenda = montarLegendaFinal({ textos: peca.textos, oferta, visual: visualDaPeca(peca), credito: peca.imagem?.credito });
    try {
      const r = await canal.publicar({ urlImagem: peca.arte.url, urlsImagens: peca.slides_arte?.map((sl) => sl.url) || null, legenda });
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
    async gerar({ origem = 'manual', orientacao = null, usuario = 'equipe', aguardar = false, paraHorario = null } = {}) {
      const escolha = normalizarFormato(orientacao || {});
      verificarChaves(escolha.visual);
      orientacao = { ...(orientacao || {}), ...escolha };
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
        para_horario: paraHorario,
        formato: escolha.formato,
        visual: escolha.visual,
        num_slides: escolha.num_slides,
        design_semente: Math.floor(Math.random() * 1_000_000) + 1,
      });
      emGeracao = peca.id;
      await auditar(
        peca.id,
        'inicio',
        origem === 'agenda' ? 'sistema:agenda' : origem === 'programacao' ? 'sistema:programacao' : `humano:${usuario}`,
        origem === 'agenda'
          ? 'Geração iniciada pela agenda automática'
          : origem === 'programacao'
            ? `Geração iniciada pela programação, para o horário de ${descreverHorario(paraHorario)}`
            : 'Geração iniciada no painel',
        { orientacao, politica_versao: politica.versao },
      );
      const execucao = executarPipeline(peca.id, orientacao).finally(() => {
        emGeracao = null;
      });
      if (aguardar) return execucao;
      execucao.catch(() => {});
      return peca;
    },

    async aprovar(id, usuario, { quando = 'agora' } = {}) {
      const peca = await exigirEmRevisao(id);
      if (peca.governanca?.gate?.veredito === 'bloqueada') {
        throw erroHttp(409, 'Peça bloqueada pelas travas. Edite os textos ou gere nova imagem antes de aprovar.');
      }
      const para = await resolverQuando(peca, quando);
      await db.atualizarPeca(id, {
        status: 'aprovada',
        revisao: { acao: 'aprovada', usuario, em: instante(), com_intervencao: Boolean(peca.intervencao_humana) },
        decisao: { ...peca.decisao, tipo: 'humana', aprovada_por: usuario },
      });
      await auditar(id, 'revisao', `humano:${usuario}`, peca.intervencao_humana ? 'Aprovada após ajustes' : 'Aprovada sem edição');
      const resultado = para
        ? await agendarPeca(id, { para, ator: `humano:${usuario}`, resumo: 'Agendada' })
        : await publicarPeca(id, { ator: `humano:${usuario}` });
      await revisarAutonomia(peca.categoria);
      return resultado;
    },

    async publicarAgora(id, usuario) {
      const peca = await db.obterPeca(id);
      if (!peca) throw erroHttp(404, 'Peça não encontrada.');
      if (!['aprovada', 'agendada'].includes(peca.status)) throw erroHttp(409, 'Só peças aprovadas ou agendadas podem ser publicadas.');
      return publicarPeca(id, { ator: `humano:${usuario}` });
    },

    async reagendar(id, usuario, quando) {
      const peca = await db.obterPeca(id);
      if (!peca) throw erroHttp(404, 'Peça não encontrada.');
      if (!['aprovada', 'agendada'].includes(peca.status)) throw erroHttp(409, 'Só peças aprovadas ou agendadas podem mudar de horário.');
      const para = await resolverQuando(peca, quando);
      if (!para) return publicarPeca(id, { ator: `humano:${usuario}` });
      return agendarPeca(id, { para, ator: `humano:${usuario}`, resumo: 'Horário alterado' });
    },

    async cancelarAgendamento(id, usuario) {
      const peca = await db.obterPeca(id);
      if (!peca) throw erroHttp(404, 'Peça não encontrada.');
      if (peca.status !== 'agendada') throw erroHttp(409, 'Esta peça não está agendada.');
      await auditar(id, 'agendamento', `humano:${usuario}`, 'Agendamento cancelado. A peça voltou para a fila de revisão.');
      return db.atualizarPeca(id, {
        status: 'em_revisao',
        agendamento: null,
        revisao: null,
        decisao: { tipo: 'fila_humana', motivo: 'Agendamento cancelado; volta para revisão', em: instante() },
      });
    },

    async programacao() {
      const prog = await lerProgramacao();
      const pecas = await db.listarPecas({ limite: 500 });
      const ocupados = horariosOcupados(pecas);
      const resumo = (p) => (p ? { id: p.id, status: p.status, titulo: p.textos?.titulo || p.oportunidade?.tema || null } : null);
      const proximos = proximosHorarios(prog, { agora: agora(), fuso: env.fuso, dias: 14 })
        .slice(0, 10)
        .map((h) => ({
          ...h,
          peca: resumo(ocupados.get(h.para)),
          gera_em: prog.gerar_automaticamente ? new Date(new Date(h.para).getTime() - prog.antecedencia_horas * 3_600_000).toISOString() : null,
        }));
      const agendadas = pecas
        .filter((p) => p.status === 'agendada' && p.agendamento?.para)
        .sort((a, b) => a.agendamento.para.localeCompare(b.agendamento.para))
        .map((p) => ({ para: p.agendamento.para, ...resumo(p) }));
      return { ...prog, dias_da_semana: DIAS_DA_SEMANA, fuso: env.fuso, proximos, agendadas };
    },

    async salvarProgramacao(dados, usuario) {
      let prog;
      try {
        prog = normalizarProgramacao(dados);
      } catch (erro) {
        throw erroHttp(400, erro.message);
      }
      try {
        await db.salvarProgramacao(prog, usuario);
      } catch {
        throw erroHttp(503, 'Para salvar a programação, rode de novo o arquivo schema.sql no SQL Editor do Supabase.');
      }
      tentativasFalhas.clear();
      await auditar(
        null,
        'programacao',
        `humano:${usuario}`,
        `Programação atualizada: ${prog.horarios.length} ${prog.horarios.length === 1 ? 'horário' : 'horários'} por semana; geração automática ${
          prog.gerar_automaticamente ? `ligada, ${prog.antecedencia_horas}h antes` : 'desligada'
        }`,
        prog,
      );
      return this.programacao();
    },

    /** Roda a cada minuto: publica as peças agendadas que chegaram na hora e gera peças para os próximos horários. */
    async tickProgramacao() {
      const controle = await db.obterControle();
      if (controle.pausado) return;
      const agoraDt = agora();
      let pecas = await db.listarPecas({ limite: 500 });

      const vencidas = pecas
        .filter((p) => p.status === 'agendada' && p.agendamento?.para && new Date(p.agendamento.para) <= agoraDt)
        .sort((a, b) => a.agendamento.para.localeCompare(b.agendamento.para));
      if (vencidas.length) {
        const prog = await lerProgramacao();
        const dia = hoje();
        let publicadasHoje = pecas.filter((p) => p.status === 'publicada' && ehDoDia(p.publicacao?.em, dia, env.fuso)).length;
        for (const p of vencidas) {
          if (ocupadas.has(p.id)) continue;
          if (publicadasHoje >= politica.limites.publicacoes_por_dia) {
            const para = proximoHorarioLivre(prog, await db.listarPecas({ limite: 500 }), {
              agora: agoraDt,
              fuso: env.fuso,
              ignorar: p.id,
              depoisDoDia: dia,
            });
            if (para) {
              await agendarPeca(p.id, {
                para,
                ator: 'sistema:programacao',
                resumo: `Limite de ${politica.limites.publicacoes_por_dia} publicações por dia atingido. Reagendada`,
              });
              continue;
            }
          }
          ocupadas.add(p.id);
          try {
            const r = await publicarPeca(p.id, { ator: 'sistema:programacao' });
            if (r.status === 'publicada') publicadasHoje++;
          } finally {
            ocupadas.delete(p.id);
          }
        }
        pecas = await db.listarPecas({ limite: 500 });
      }

      const prog = await lerProgramacao();
      if (!prog.gerar_automaticamente || !prog.horarios.length || emGeracao) return;
      const janela = prog.antecedencia_horas * 3_600_000;
      const tentados = new Set(pecas.map((p) => p.para_horario).filter(Boolean));
      const ocupados = horariosOcupados(pecas);
      const alvo = proximosHorarios(prog, { agora: agoraDt, fuso: env.fuso, dias: 3 }).find(
        (h) =>
          new Date(h.para).getTime() - agoraDt.getTime() <= janela &&
          !tentados.has(h.para) &&
          !ocupados.has(h.para) &&
          !tentativasFalhas.has(h.para),
      );
      if (!alvo) return;
      try {
        await this.gerar({
          origem: 'programacao',
          usuario: 'programacao',
          paraHorario: alvo.para,
          orientacao: { formato: prog.formato_padrao, visual: prog.visual_padrao, num_slides: prog.slides_padrao },
        });
      } catch (erro) {
        tentativasFalhas.add(alvo.para);
        await auditar(null, 'programacao', 'sistema:programacao', `Não gerou a peça do horário de ${descreverHorario(alvo.para)}: ${erro.message}`);
      }
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
        if (campo === 'slides') {
          if (!Array.isArray(peca.textos.slides)) continue;
          if (!Array.isArray(novos.slides) || novos.slides.length !== peca.textos.slides.length) {
            throw erroHttp(400, 'A quantidade de slides não muda na edição. Gere outra peça para mudar o tamanho do carrossel.');
          }
          textos.slides = novos.slides.map((sl) => ({ titulo: String(sl?.titulo ?? '').trim(), texto: String(sl?.texto ?? '').trim() }));
          continue;
        }
        if (campo === 'fechamento' && peca.textos.fechamento === undefined) continue;
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
        const fundo = peca.imagem?.chave ? await db.lerMidia(peca.imagem.chave) : null;
        const oferta = peca.oferta_id ? ofertaPorId(peca.oferta_id) : null;
        const artes = await montarVisual(id, { peca, fundo, textos, oferta, versao: Date.now() });
        await avaliarEDecidir(id, { inicial: false, buffers: { fundo, ...artes } });
      });
      return db.obterPeca(id);
    },

    async regenerarImagem(id, usuario, direcao) {
      const peca = await exigirEmRevisao(id);
      const visual = visualDaPeca(peca);
      verificarChaves(visual);
      const pedido = { ia: 'Nova imagem solicitada', foto: 'Outra foto solicitada', design: 'Novo visual solicitado' }[visual];
      await db.atualizarPeca(id, { intervencao_humana: true, status: 'gerando', etapa: 'imagem', erro: null });
      await auditar(id, 'edicao', `humano:${usuario}`, `${pedido}${direcao ? `: ${direcao}` : ''}`);
      emSegundoPlano(id, async () => {
        const oferta = peca.oferta_id ? ofertaPorId(peca.oferta_id) : null;
        const usadas = [...(peca.fotos_usadas || []), peca.imagem?.foto_id].filter(Boolean);
        const atual = await db.atualizarPeca(id, {
          design_semente: (peca.design_semente || 1) + 1,
          ...(visual === 'foto' ? { fotos_usadas: usadas } : {}),
        });
        const buffers = await produzirVisual(id, { peca: atual, textos: peca.textos, oferta, direcaoExtra: direcao, evitarFotos: usadas });
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
        legenda_final:
          peca.publicacao?.legenda_final ||
          (peca.textos?.legenda
            ? montarLegendaFinal({ textos: peca.textos, oferta, visual: visualDaPeca(peca), credito: peca.imagem?.credito })
            : null),
        processando: ocupadas.has(id) || emGeracao === id,
        sugestao_agendamento: ['em_revisao', 'aprovada', 'agendada'].includes(peca.status) ? await horarioSugerido(peca).catch(() => null) : null,
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
        agendamento_para: p.agendamento?.para || null,
        formato: formatoDaPeca(p),
        visual: visualDaPeca(p),
        slides: p.slides_arte?.length || 1,
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
          agendadas: pecas.filter((p) => p.status === 'agendada').length,
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
          fotos_disponiveis: Boolean(fotos?.disponivel),
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
