import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const copiar = (x) => (x == null ? x : structuredClone(x));

export async function criarArmazenamentoLocal({ diretorio, urlPublica }) {
  const arquivo = path.join(diretorio, 'banco.json');
  const pastaMidia = path.join(diretorio, 'midia');
  await fs.mkdir(pastaMidia, { recursive: true });

  let estado = { pecas: [], auditoria: [], categorias: {}, controle: { pausado: false } };
  try {
    estado = { ...estado, ...JSON.parse(await fs.readFile(arquivo, 'utf8')) };
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }

  let fila = Promise.resolve();
  const salvar = () => {
    fila = fila.then(async () => {
      const temporario = `${arquivo}.tmp`;
      await fs.writeFile(temporario, JSON.stringify(estado, null, 2));
      await fs.rename(temporario, arquivo);
    });
    return fila;
  };

  return {
    tipo: 'local',
    pastaMidia,

    async criarPeca(dados) {
      const agora = new Date().toISOString();
      const peca = { id: randomUUID(), criada_em: agora, atualizada_em: agora, ...dados };
      estado.pecas.push(peca);
      await salvar();
      return copiar(peca);
    },

    async atualizarPeca(id, parcial) {
      const peca = estado.pecas.find((p) => p.id === id);
      if (!peca) throw new Error(`Peça ${id} não encontrada.`);
      Object.assign(peca, copiar(parcial), { atualizada_em: new Date().toISOString() });
      await salvar();
      return copiar(peca);
    },

    async obterPeca(id) {
      return copiar(estado.pecas.find((p) => p.id === id) || null);
    },

    async listarPecas({ status, limite = 200 } = {}) {
      return copiar(
        estado.pecas
          .filter((p) => !status || (Array.isArray(status) ? status.includes(p.status) : p.status === status))
          .sort((a, b) => b.criada_em.localeCompare(a.criada_em))
          .slice(0, limite),
      );
    },

    async registrarAuditoria({ peca_id = null, etapa, ator, resumo, detalhe = null }) {
      estado.auditoria.push({ id: randomUUID(), em: new Date().toISOString(), peca_id, etapa, ator, resumo, detalhe });
      await salvar();
    },

    async listarAuditoria(pecaId) {
      return copiar(estado.auditoria.filter((a) => a.peca_id === pecaId).sort((a, b) => a.em.localeCompare(b.em)));
    },

    async obterControle() {
      return copiar(estado.controle);
    },

    async definirControle(parcial) {
      estado.controle = { ...estado.controle, ...parcial, atualizado_em: new Date().toISOString() };
      await salvar();
      return copiar(estado.controle);
    },

    async obterModosCategorias() {
      return copiar(estado.categorias);
    },

    async obterProgramacao() {
      return copiar(estado.programacao || null);
    },

    async salvarProgramacao(dados, por) {
      estado.programacao = { dados, atualizado_em: new Date().toISOString(), atualizado_por: por };
      await salvar();
      return copiar(estado.programacao);
    },

    async definirModoCategoria(id, modo, por) {
      estado.categorias[id] = { modo, atualizado_em: new Date().toISOString(), atualizado_por: por };
      await salvar();
    },

    async salvarMidia(nome, buffer) {
      await fs.writeFile(path.join(pastaMidia, nome), buffer);
      return { chave: nome, url: urlPublica ? `${urlPublica}/midia/${nome}` : `/midia/${nome}` };
    },

    async lerMidia(chave) {
      return fs.readFile(path.join(pastaMidia, path.basename(chave)));
    },
  };
}
