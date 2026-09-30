/**
 * Programação de publicação: horários fixos por dia da semana, no fuso do sistema.
 * Tudo aqui é cálculo puro; quem grava e publica é o motor.
 */
import { hojeNoFuso } from './util.js';
import { normalizarFormato, SLIDES_PADRAO } from './formatos.js';

export const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const ANTECEDENCIAS = [3, 12, 24, 48];
export const PROGRAMACAO_PADRAO = {
  horarios: [],
  gerar_automaticamente: false,
  antecedencia_horas: 24,
  formato_padrao: 'post',
  visual_padrao: 'ia',
  slides_padrao: SLIDES_PADRAO,
};
const MAX_HORARIOS = 21;

/** Diferença, em minutos, entre o relógio do fuso e o UTC naquele instante. */
function deslocamento(fuso, data) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value]),
  );
  const comoUtc = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return Math.round((comoUtc - data.getTime()) / 60000);
}

/** Instante (Date) correspondente a uma data AAAA-MM-DD e hora HH:MM no relógio do fuso. */
export function instanteNoFuso(dia, hora, fuso) {
  const [a, m, d] = dia.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const palpite = Date.UTC(a, m - 1, d, h, mi);
  let t = palpite - deslocamento(fuso, new Date(palpite)) * 60000;
  const corrigido = palpite - deslocamento(fuso, new Date(t)) * 60000;
  if (corrigido !== t) t = corrigido;
  return new Date(t);
}

function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

const diaDaSemana = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** Valida e organiza o que veio do painel. Lança erro com mensagem legível. */
export function normalizarProgramacao(bruto = {}) {
  const horarios = [];
  const vistos = new Set();
  for (const h of Array.isArray(bruto.horarios) ? bruto.horarios : []) {
    const dia = Number(h?.dia);
    const hora = String(h?.hora || '').trim();
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new Error('Dia da semana inválido.');
    const partes = /^(\d{1,2}):(\d{2})$/.exec(hora);
    if (!partes || Number(partes[1]) > 23 || Number(partes[2]) > 59) throw new Error(`Horário inválido: "${hora}". Use o formato 12:30.`);
    const horaFormatada = `${partes[1].padStart(2, '0')}:${partes[2]}`;
    const chave = `${dia}-${horaFormatada}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    horarios.push({ dia, hora: horaFormatada });
  }
  if (horarios.length > MAX_HORARIOS) throw new Error(`Use no máximo ${MAX_HORARIOS} horários por semana.`);
  horarios.sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora));
  const antecedencia = Number(bruto.antecedencia_horas);
  const escolha = normalizarFormato({ formato: bruto.formato_padrao, visual: bruto.visual_padrao, num_slides: bruto.slides_padrao });
  return {
    horarios,
    gerar_automaticamente: Boolean(bruto.gerar_automaticamente),
    antecedencia_horas: ANTECEDENCIAS.includes(antecedencia) ? antecedencia : PROGRAMACAO_PADRAO.antecedencia_horas,
    formato_padrao: escolha.formato,
    visual_padrao: escolha.visual,
    slides_padrao: escolha.formato === 'post' ? SLIDES_PADRAO : escolha.num_slides,
  };
}

/** Próximas ocorrências dos horários, depois de "agora", em ordem. */
export function proximosHorarios(programacao, { agora, fuso, dias = 28 }) {
  const hoje = hojeNoFuso(fuso, agora);
  const saida = [];
  for (let i = 0; i <= dias; i++) {
    const dia = somarDias(hoje, i);
    const semana = diaDaSemana(dia);
    for (const h of programacao.horarios || []) {
      if (h.dia !== semana) continue;
      const instante = instanteNoFuso(dia, h.hora, fuso);
      if (instante > agora) saida.push({ para: instante.toISOString(), dia: semana, hora: h.hora, data: dia });
    }
  }
  return saida.sort((a, b) => a.para.localeCompare(b.para));
}

/**
 * Horários já tomados: peças agendadas ocupam o próprio horário, e peças geradas para um horário
 * (ainda gerando ou em revisão) reservam esse horário.
 */
export function horariosOcupados(pecas, { ignorar = null } = {}) {
  const ocupados = new Map();
  for (const p of pecas) {
    if (p.id === ignorar) continue;
    if (p.status === 'agendada' && p.agendamento?.para) ocupados.set(p.agendamento.para, p);
    else if (['gerando', 'em_revisao'].includes(p.status) && p.para_horario && !ocupados.has(p.para_horario)) {
      ocupados.set(p.para_horario, p);
    }
  }
  return ocupados;
}

/** Primeiro horário livre da programação, ou null se não houver horários cadastrados. */
export function proximoHorarioLivre(programacao, pecas, { agora, fuso, ignorar = null, depoisDoDia = null }) {
  const ocupados = horariosOcupados(pecas, { ignorar });
  return (
    proximosHorarios(programacao, { agora, fuso }).find((h) => !ocupados.has(h.para) && (!depoisDoDia || h.data > depoisDoDia))?.para ||
    null
  );
}
