import { env } from './config.js';
import { criarArmazenamentoLocal } from './local.js';
import { criarArmazenamentoSupabase } from './supabase.js';

export async function criarArmazenamento() {
  if (env.armazenamento === 'supabase') {
    return criarArmazenamentoSupabase({ url: env.supabaseUrl, chave: env.supabaseChave, bucket: env.supabaseBucket });
  }
  return criarArmazenamentoLocal({ diretorio: env.dadosDir, urlPublica: env.publicBaseUrl });
}
