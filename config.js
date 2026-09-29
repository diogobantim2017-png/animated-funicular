import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ quiet: true });

export const raiz = path.dirname(fileURLToPath(import.meta.url));

function lerJson(relativo) {
  const caminho = path.join(raiz, relativo);
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (erro) {
    throw new Error(`Não foi possível ler ${relativo}: ${erro.message}`);
  }
}

const v = (nome, padrao = '') => (process.env[nome] ?? padrao).trim();

export const env = {
  porta: Number(v('PORT', '3000')),
  anthropicKey: v('ANTHROPIC_API_KEY'),
  modeloIa: v('CLAUDE_MODELO', 'claude-sonnet-5-5'),
  modeloJuiz: v('CLAUDE_MODELO_JUIZ') || v('CLAUDE_MODELO', 'claude-sonnet-5-5'),
  imagemProvedor: v('IMAGEM_PROVEDOR', 'openai').toLowerCase(),
  imagemModelo: v('IMAGEM_MODELO'),
  imagemQualidade: v('IMAGEM_QUALIDADE', 'medium'),
  imagemTamanho: v('IMAGEM_TAMANHO', '1024x1536'),
  openaiKey: v('OPENAI_API_KEY'),
  googleKey: v('GOOGLE_API_KEY'),
  armazenamento: v('ARMAZENAMENTO', 'local').toLowerCase(),
  dadosDir: path.resolve(raiz, v('DADOS_DIR', 'dados')),
  publicBaseUrl: v('PUBLIC_BASE_URL').replace(/\/+$/, ''),
  supabaseUrl: v('SUPABASE_URL'),
  supabaseChave: v('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseBucket: v('SUPABASE_BUCKET', 'pecas'),
  publicacaoModo: v('PUBLICACAO_MODO', 'simulacao') === 'real' ? 'real' : 'simulacao',
  igUserId: v('IG_USER_ID'),
  igToken: v('IG_ACCESS_TOKEN'),
  metaHost: v('META_GRAPH_HOST', 'graph.instagram.com'),
  metaVersao: v('META_GRAPH_VERSAO', 'v26.0'),
  cronRadar: v('CRON_RADAR'),
  fuso: v('FUSO_HORARIO', 'America/Sao_Paulo'),
  painelUsuario: v('PAINEL_USUARIO'),
  painelSenha: v('PAINEL_SENHA'),
};

export const marca = lerJson('marca.json');
export const politica = lerJson('politica.json');
export const calendario = lerJson('calendario.json');
export const segmentos = lerJson('segmentos.json').segmentos;
export const ofertas = lerJson('ofertas.json').ofertas;

export const MARCADOR_PENDENTE = '[DADO A SER VALIDADO]';

/** Verdadeiro se algum valor ainda tem o marcador. Campos "observacao" são instruções e ficam de fora. */
export function temPendencia(valor) {
  if (typeof valor === 'string') return valor.includes(MARCADOR_PENDENTE);
  if (Array.isArray(valor)) return valor.some(temPendencia);
  if (valor && typeof valor === 'object') {
    return Object.entries(valor).some(([chave, v]) => chave !== 'observacao' && temPendencia(v));
  }
  return false;
}

export function modeloImagemPadrao() {
  if (env.imagemModelo) return env.imagemModelo;
  return env.imagemProvedor === 'google' ? 'gemini-3.1-flash-image' : 'gpt-image-2';
}

/** Lista o que falta configurar, em linguagem de quem vai operar o painel. */
export function pendenciasDeConfiguracao() {
  const p = [];
  if (!env.anthropicKey) p.push('Falta ANTHROPIC_API_KEY no .env (radar, brief, textos e revisor de IA).');
  if (env.imagemProvedor === 'openai' && !env.openaiKey) p.push('Falta OPENAI_API_KEY no .env (geração de imagem).');
  if (env.imagemProvedor === 'google' && !env.googleKey) p.push('Falta GOOGLE_API_KEY no .env (geração de imagem).');
  if (!['openai', 'google'].includes(env.imagemProvedor)) p.push(`IMAGEM_PROVEDOR "${env.imagemProvedor}" não é suportado. Use openai ou google.`);
  if (env.armazenamento === 'supabase' && (!env.supabaseUrl || !env.supabaseChave)) {
    p.push('ARMAZENAMENTO=supabase exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (temPendencia(marca)) {
    p.push('marca.json ainda tem campos [DADO A SER VALIDADO]. A publicação real fica bloqueada até completar.');
  }
  if (env.publicacaoModo === 'real') {
    if (!env.igUserId || !env.igToken) p.push('PUBLICACAO_MODO=real exige IG_USER_ID e IG_ACCESS_TOKEN.');
    if (env.armazenamento === 'local' && !env.publicBaseUrl.startsWith('https://')) {
      p.push('Publicação real com armazenamento local exige PUBLIC_BASE_URL em https (o Instagram baixa a imagem por esse endereço). Alternativa: ARMAZENAMENTO=supabase.');
    }
  }
  return p;
}
