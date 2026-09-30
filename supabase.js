import { createClient } from '@supabase/supabase-js';

const COLUNAS = ['id', 'criada_em', 'atualizada_em', 'status', 'etapa', 'categoria'];

function paraLinha(peca) {
  const linha = { dados: {} };
  for (const [chave, valor] of Object.entries(peca)) {
    if (COLUNAS.includes(chave)) linha[chave] = valor;
    else linha.dados[chave] = valor;
  }
  return linha;
}

function daLinha(linha) {
  if (!linha) return null;
  const { dados, ...colunas } = linha;
  return { ...(dados || {}), ...colunas };
}

function falha(contexto, erro) {
  if (erro) throw new Error(`Supabase (${contexto}): ${erro.message}`);
}

export async function criarArmazenamentoSupabase({ url, chave, bucket }) {
  const sb = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: erroConexao } = await sb.from('controle').select('id').limit(1);
  falha('conexão; rode schema.sql no SQL Editor', erroConexao);

  const armazenamento = {
    tipo: 'supabase',

    async criarPeca(dados) {
      const { data, error } = await sb.from('pecas').insert(paraLinha(dados)).select().single();
      falha('criar peça', error);
      return daLinha(data);
    },

    async atualizarPeca(id, parcial) {
      const atual = await armazenamento.obterPeca(id);
      if (!atual) throw new Error(`Peça ${id} não encontrada.`);
      const linha = paraLinha({ ...atual, ...parcial, atualizada_em: new Date().toISOString() });
      const { data, error } = await sb.from('pecas').update(linha).eq('id', id).select().single();
      falha('atualizar peça', error);
      return daLinha(data);
    },

    async obterPeca(id) {
      const { data, error } = await sb.from('pecas').select('*').eq('id', id).maybeSingle();
      falha('ler peça', error);
      return daLinha(data);
    },

    async listarPecas({ status, limite = 200 } = {}) {
      let consulta = sb.from('pecas').select('*').order('criada_em', { ascending: false }).limit(limite);
      if (status) consulta = Array.isArray(status) ? consulta.in('status', status) : consulta.eq('status', status);
      const { data, error } = await consulta;
      falha('listar peças', error);
      return data.map(daLinha);
    },

    async registrarAuditoria({ peca_id = null, etapa, ator, resumo, detalhe = null }) {
      const { error } = await sb.from('auditoria').insert({ peca_id, etapa, ator, resumo, detalhe });
      falha('registrar auditoria', error);
    },

    async listarAuditoria(pecaId) {
      const { data, error } = await sb
        .from('auditoria')
        .select('*')
        .eq('peca_id', pecaId)
        .order('em', { ascending: true })
        .order('id', { ascending: true });
      falha('ler auditoria', error);
      return data;
    },

    async obterControle() {
      const { data, error } = await sb.from('controle').select('*').eq('id', 1).maybeSingle();
      falha('ler controle', error);
      return data || { pausado: false };
    },

    async definirControle(parcial) {
      const { data, error } = await sb
        .from('controle')
        .upsert({ id: 1, ...parcial, atualizado_em: new Date().toISOString() })
        .select()
        .single();
      falha('gravar controle', error);
      return data;
    },

    async obterProgramacao() {
      const { data, error } = await sb.from('programacao').select('*').eq('id', 1).maybeSingle();
      falha('ler programação; rode de novo o schema.sql no SQL Editor', error);
      return data;
    },

    async salvarProgramacao(dados, por) {
      const { data, error } = await sb
        .from('programacao')
        .upsert({ id: 1, dados, atualizado_em: new Date().toISOString(), atualizado_por: por })
        .select()
        .single();
      falha('gravar programação; rode de novo o schema.sql no SQL Editor', error);
      return data;
    },

    async obterModosCategorias() {
      const { data, error } = await sb.from('estado_categorias').select('*');
      falha('ler categorias', error);
      return Object.fromEntries(data.map((c) => [c.id, c]));
    },

    async definirModoCategoria(id, modo, por) {
      const { error } = await sb
        .from('estado_categorias')
        .upsert({ id, modo, atualizado_em: new Date().toISOString(), atualizado_por: por });
      falha('gravar categoria', error);
    },

    async salvarMidia(nome, buffer, tipo = 'image/jpeg') {
      const { error } = await sb.storage.from(bucket).upload(nome, buffer, { contentType: tipo, upsert: true });
      falha('enviar imagem ao Storage', error);
      const { data } = sb.storage.from(bucket).getPublicUrl(nome);
      return { chave: nome, url: data.publicUrl };
    },

    async lerMidia(chave) {
      const { data, error } = await sb.storage.from(bucket).download(chave);
      falha('baixar imagem do Storage', error);
      return Buffer.from(await data.arrayBuffer());
    },
  };

  return armazenamento;
}
