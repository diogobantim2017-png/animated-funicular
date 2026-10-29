/**
 * Régua de comunicação: calendário da série.
 * Distribui os posts nos dias da semana escolhidos, pulando feriados nacionais e vésperas de fim de ano,
 * quando quase ninguém lê LinkedIn de trabalho.
 */

const DIA = 86_400_000;
const dataUtc = (iso) => new Date(`${iso}T12:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const somar = (d, dias) => new Date(d.getTime() + dias * DIA);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia, 12));
}

/** Feriados nacionais e datas a evitar no ano, como mapa AAAA-MM-DD → nome. */
export function datasParaEvitar(ano) {
  const fixos = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia da Consciência Negra'],
    ['12-24', 'Véspera de Natal'],
    ['12-25', 'Natal'],
    ['12-31', 'Véspera de Ano-Novo'],
  ];
  const mapa = new Map(fixos.map(([md, nome]) => [`${ano}-${md}`, nome]));
  const p = pascoa(ano);
  mapa.set(iso(somar(p, -48)), 'Carnaval');
  mapa.set(iso(somar(p, -47)), 'Carnaval');
  mapa.set(iso(somar(p, -2)), 'Sexta-feira Santa');
  mapa.set(iso(somar(p, 60)), 'Corpus Christi');
  return mapa;
}

export const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Próximas `total` datas a partir de `inicio` (inclusive), só nos `diasSemana` (0 = domingo),
 * pulando feriados. Devolve também os feriados pulados, para a régua explicar a escolha.
 */
export function distribuirDatas({ inicio, diasSemana = [2, 4], total }) {
  const dias = [...new Set(diasSemana.map(Number))].filter((d) => d >= 0 && d <= 6);
  if (!dias.length) throw new Error('Escolha pelo menos um dia da semana.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inicio || ''))) throw new Error('Data de início inválida.');
  const datas = [];
  const pulados = [];
  const cache = new Map();
  const evitar = (d) => {
    const ano = d.getUTCFullYear();
    if (!cache.has(ano)) cache.set(ano, datasParaEvitar(ano));
    return cache.get(ano).get(iso(d));
  };
  let d = dataUtc(inicio);
  for (let passos = 0; datas.length < total && passos < 800; passos++, d = somar(d, 1)) {
    if (!dias.includes(d.getUTCDay())) continue;
    const feriado = evitar(d);
    if (feriado) {
      pulados.push({ data: iso(d), motivo: feriado });
      continue;
    }
    datas.push(iso(d));
  }
  return { datas, pulados };
}

/** Próxima ocorrência de um dia da semana a partir de amanhã (para sugerir o início da série). */
export function proximoDia(diaSemana, hoje = new Date()) {
  let d = dataUtc(iso(hoje));
  do d = somar(d, 1);
  while (d.getUTCDay() !== diaSemana);
  return iso(d);
}
