import { calendario, ofertas, temPendencia } from './config.js';

const DIA_MS = 24 * 60 * 60 * 1000;

function utc(ano, mes, dia) {
  return Date.UTC(ano, mes - 1, dia);
}

function formatar(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** n-ésimo dia da semana do mês (n = -1 é o último). diaSemana: 0 = domingo. */
export function nEsimoDiaSemana(ano, mes, diaSemana, n) {
  if (n > 0) {
    const primeiro = new Date(utc(ano, mes, 1)).getUTCDay();
    const deslocamento = (diaSemana - primeiro + 7) % 7;
    return utc(ano, mes, 1 + deslocamento + (n - 1) * 7);
  }
  const ultimoDia = new Date(Date.UTC(ano, mes, 0));
  const deslocamento = (ultimoDia.getUTCDay() - diaSemana + 7) % 7;
  return utc(ano, mes, ultimoDia.getUTCDate() - deslocamento);
}

/** Eventos em andamento ou que começam dentro da janela, a partir de hoje (AAAA-MM-DD). */
export function proximosEventos(hoje, janelaDias = calendario.janela_dias ?? 35) {
  const [a, m, d] = hoje.split('-').map(Number);
  const hojeMs = utc(a, m, d);
  const encontrados = new Map();

  for (const ev of calendario.eventos) {
    for (const ano of [a - 1, a, a + 1]) {
      if (ev.tipo === 'periodo') {
        const inicio = utc(ano, ev.inicio.mes, ev.inicio.dia);
        let fim = utc(ano, ev.fim.mes, ev.fim.dia);
        if (fim < inicio) fim = utc(ano + 1, ev.fim.mes, ev.fim.dia);
        const diasAteInicio = Math.round((inicio - hojeMs) / DIA_MS);
        if (hojeMs >= inicio && hojeMs <= fim) {
          encontrados.set(ev.nome, { nome: ev.nome, situacao: 'em andamento', ate: formatar(fim), dias: 0, temas: ev.temas });
        } else if (diasAteInicio > 0 && diasAteInicio <= janelaDias && !encontrados.has(ev.nome)) {
          encontrados.set(ev.nome, { nome: ev.nome, situacao: `começa em ${diasAteInicio} dias`, data: formatar(inicio), dias: diasAteInicio, temas: ev.temas });
        }
        continue;
      }
      const data = ev.tipo === 'fixa' ? utc(ano, ev.mes, ev.dia) : nEsimoDiaSemana(ano, ev.mes, ev.dia_semana, ev.n);
      const dias = Math.round((data - hojeMs) / DIA_MS);
      if (dias >= 0 && dias <= janelaDias) {
        encontrados.set(ev.nome, {
          nome: ev.nome,
          situacao: dias === 0 ? 'é hoje' : `em ${dias} dias`,
          data: formatar(data),
          dias,
          temas: ev.temas,
        });
      }
    }
  }
  return [...encontrados.values()].sort((x, y) => x.dias - y.dias);
}

/** Ofertas ativas e dentro da validade. */
export function ofertasDisponiveis(hoje) {
  return ofertas.filter((o) => o.ativa === true && (!o.validade || o.validade >= hoje));
}

export function ofertaPorId(id) {
  return ofertas.find((o) => o.id === id) || null;
}

export function ofertaTemPendencia(oferta) {
  return temPendencia(oferta);
}
