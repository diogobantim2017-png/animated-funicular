import { politica } from './config.js';
import { media } from './util.js';
import { CHECAGENS_VISUAIS, NOTAS } from './juiz.js';

/**
 * Junta travas determinísticas e revisão de IA em um veredito:
 * publicavel | precisa_humano | bloqueada.
 */
export function consolidarGate({ regras, juiz, editorial = false }) {
  const motivos = [];

  for (const r of regras) {
    if (!r.ok) motivos.push({ origem: 'regra', id: r.id, severidade: r.severidade, texto: `${r.nome}: ${r.detalhe}` });
  }

  for (const [chave, presente] of Object.entries(juiz.elementos_no_fundo || {})) {
    if (!presente) continue;
    // Foto editorial real (ex.: piloto e patrocinadores numa foto licenciada): severidade própria, em geral revisão humana.
    const severidade = (editorial && politica.visao_foto_editorial?.[chave]) || politica.visao[chave] || 'alerta';
    if (severidade === 'ignorar') continue;
    motivos.push({ origem: 'visao', id: chave, severidade, texto: CHECAGENS_VISUAIS[chave] || chave });
  }

  if (editorial) {
    motivos.push({
      origem: 'visao',
      id: 'foto_editorial',
      severidade: 'alerta',
      texto: 'Foto real de banco livre: confira se mostra quem o texto diz, se combina com o assunto e se o crédito está certo',
    });
  }

  const notas = Object.keys(NOTAS).map((k) => Number(juiz.notas?.[k] ?? 0));
  const mediaNotas = Number(media(notas).toFixed(1));
  const menorNota = Math.min(...notas);
  if (mediaNotas < politica.juiz.nota_minima_media) {
    motivos.push({ origem: 'juiz', id: 'nota_media', severidade: 'alerta', texto: `Nota média ${mediaNotas} abaixo do mínimo ${politica.juiz.nota_minima_media}` });
  }
  if (menorNota < politica.juiz.nota_minima_item) {
    const [chave] = Object.entries(juiz.notas || {}).find(([, v]) => Number(v) === menorNota) || ['nota'];
    motivos.push({ origem: 'juiz', id: 'nota_item', severidade: 'alerta', texto: `${NOTAS[chave] || chave} com nota ${menorNota}, abaixo do mínimo ${politica.juiz.nota_minima_item}` });
  }
  if (!politica.juiz.riscos_aceitos_para_auto.includes(juiz.risco_reputacional)) {
    motivos.push({ origem: 'juiz', id: 'risco', severidade: 'alerta', texto: `Risco reputacional ${juiz.risco_reputacional}: ${juiz.justificativa_risco}` });
  }
  if (juiz.aprovaria_sem_edicao === false) {
    motivos.push({ origem: 'juiz', id: 'editaria', severidade: 'alerta', texto: 'O revisor de IA editaria a peça antes de publicar' });
  }

  const bloqueios = motivos.filter((m) => m.severidade === 'bloqueio').length;
  const alertas = motivos.length - bloqueios;
  const veredito = bloqueios ? 'bloqueada' : alertas ? 'precisa_humano' : 'publicavel';
  return { veredito, bloqueios, alertas, motivos, media_notas: mediaNotas, menor_nota: menorNota, politica_versao: politica.versao };
}

/** Depois do gate: publica sozinho ou manda para a fila humana. */
export function decidirRota({ gate, modoCategoria, controle, sortear = Math.random }) {
  if (gate.veredito === 'bloqueada') return { rota: 'fila', motivo: 'Bloqueada por trava de governança' };
  if (gate.veredito === 'precisa_humano') return { rota: 'fila', motivo: 'Alertas exigem revisão humana' };
  if (modoCategoria !== 'auto') return { rota: 'fila', motivo: 'Categoria em modo humano: toda peça passa por aprovação' };
  if (controle?.pausado) return { rota: 'fila', motivo: 'Sistema pausado: nada é publicado sozinho' };
  if (sortear() < politica.autonomia.amostragem_auditoria) {
    return { rota: 'fila', motivo: 'Amostra de auditoria: peça sorteada para conferência humana', amostra_auditoria: true };
  }
  return { rota: 'publicar', motivo: 'Passou em todas as travas e a categoria tem autonomia liberada' };
}

/**
 * Métricas que sustentam a liberação de autonomia de uma categoria.
 * Concordância: das peças que o gate considerou publicáveis e que um humano revisou,
 * quantas foram aprovadas sem nenhuma intervenção.
 */
export function calcularMetricas(pecas, categoriaId) {
  const daCategoria = pecas.filter((p) => p.categoria === categoriaId);
  const decididas = daCategoria.filter((p) => ['aprovada', 'reprovada'].includes(p.revisao?.acao));
  const gatePublicavel = decididas.filter((p) => p.governanca?.veredito_inicial === 'publicavel');
  const concordantes = gatePublicavel.filter((p) => p.revisao.acao === 'aprovada' && !p.intervencao_humana).length;
  const alertasIgnorados = decididas.filter(
    (p) => p.governanca?.veredito_inicial === 'precisa_humano' && p.revisao.acao === 'aprovada' && !p.intervencao_humana,
  ).length;
  const cfg = politica.autonomia;
  const revisadas = gatePublicavel.length;
  const concordancia = revisadas ? concordantes / revisadas : null;
  const categoria = politica.categorias[categoriaId];
  const pode = categoria?.autonomia_maxima === 'auto' && revisadas >= cfg.min_amostras && concordancia >= cfg.meta_concordancia;
  return {
    total: daCategoria.length,
    publicadas: daCategoria.filter((p) => p.status === 'publicada').length,
    publicadas_sozinhas: daCategoria.filter((p) => p.status === 'publicada' && p.decisao?.tipo === 'automatica').length,
    revisadas_com_gate_publicavel: revisadas,
    concordantes,
    concordancia,
    alertas_ignorados_pelo_humano: alertasIgnorados,
    min_amostras: cfg.min_amostras,
    meta_concordancia: cfg.meta_concordancia,
    pode_liberar: Boolean(pode),
    motivo_bloqueio_liberacao:
      categoria?.autonomia_maxima !== 'auto'
        ? 'A política não permite modo automático nesta categoria.'
        : revisadas < cfg.min_amostras
          ? `Faltam ${cfg.min_amostras - revisadas} peças revisadas com veredito publicável.`
          : concordancia < cfg.meta_concordancia
            ? `Concordância de ${Math.round(concordancia * 100)}%, abaixo da meta de ${Math.round(cfg.meta_concordancia * 100)}%.`
            : null,
  };
}
