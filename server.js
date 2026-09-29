import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env, raiz, politica, pendenciasDeConfiguracao } from './config.js';
import { criarArmazenamento } from './index.js';
import { chamarFerramenta } from './claude.js';
import { criarGeradorImagem } from './gerador.js';
import { criarCanalInstagram } from './instagram.js';
import { CHECAGENS_VISUAIS, NOTAS } from './juiz.js';
import { criarMotor } from './motor.js';

const db = await criarArmazenamento();
const imagem = criarGeradorImagem();
const canal = criarCanalInstagram();
const motor = criarMotor({ db, ia: chamarFerramenta, imagem, canal });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

/* Rotas públicas: checagem de saúde e imagens (o Instagram precisa baixar a arte sem senha). */
app.get('/saude', (req, res) => res.json({ ok: true }));
if (db.tipo === 'local') {
  app.use('/midia', express.static(db.pastaMidia, { maxAge: '1h', fallthrough: false }));
}

/* Proteção do painel e da API com usuário e senha (Basic Auth), quando configurada. */
const igual = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const autenticacaoAtiva = Boolean(env.painelUsuario && env.painelSenha);
if (autenticacaoAtiva) {
  app.use((req, res, next) => {
    const [tipo, valor] = String(req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const texto = Buffer.from(valor, 'base64').toString('utf8');
      const i = texto.indexOf(':');
      const usuario = texto.slice(0, i);
      const senha = texto.slice(i + 1);
      const usuarioOk = igual(usuario, env.painelUsuario);
      const senhaOk = igual(senha, env.painelSenha);
      if (i > 0 && usuarioOk && senhaOk) {
        req.usuario = usuario;
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Motor de campanhas", charset="UTF-8"');
    res.status(401).send('Acesso restrito. Informe usuário e senha do painel.');
  });
}

/* Interface do painel: só estes três arquivos são servidos. O restante da pasta é código do servidor. */
const arquivosDoPainel = { '/': 'index.html', '/index.html': 'index.html', '/estilo.css': 'estilo.css', '/app.js': 'app.js' };
for (const [rota, arquivo] of Object.entries(arquivosDoPainel)) {
  app.get(rota, (req, res) => res.sendFile(path.join(raiz, arquivo)));
}

/** Quem executou a ação: nome informado no painel, senão o usuário do login, senão "equipe". */
function quem(req) {
  const nome = String(req.body?.usuario || '').trim().slice(0, 60);
  return nome || req.usuario || 'equipe';
}

/* ---------------------------------------------------------------- agenda */

let tarefaAgenda = null;
let avisoAgenda = null;
if (env.cronRadar) {
  if (cron.validate(env.cronRadar)) {
    tarefaAgenda = cron.schedule(
      env.cronRadar,
      async () => {
        try {
          await motor.cicloAutomatico();
        } catch (erro) {
          console.error('Falha no ciclo automático:', erro.message);
        }
      },
      { timezone: env.fuso, noOverlap: true, name: 'radar' },
    );
  } else {
    avisoAgenda = `CRON_RADAR "${env.cronRadar}" é inválido. A agenda automática está desligada.`;
  }
}

function agenda() {
  return {
    ativa: Boolean(tarefaAgenda),
    expressao: env.cronRadar || null,
    fuso: env.fuso,
    proxima: tarefaAgenda?.getNextRun()?.toISOString() || null,
    aviso: avisoAgenda,
  };
}

/* ------------------------------------------------------------------- API */

app.get('/api/estado', async (req, res) => {
  const estado = await motor.estado();
  res.json({
    ...estado,
    pendencias: avisoAgenda ? [...estado.pendencias, avisoAgenda] : estado.pendencias,
    agenda: agenda(),
    sessao: { autenticacao: autenticacaoAtiva, usuario: req.usuario || null },
    rotulos: { checagens_visuais: CHECAGENS_VISUAIS, notas: NOTAS, severidade_visao: politica.visao, juiz: politica.juiz },
    rotulo_ia: politica.rotulo_ia,
  });
});

app.get('/api/pecas', async (req, res) => {
  const bruto = String(req.query.status || '').trim();
  const status = bruto ? (bruto.includes(',') ? bruto.split(',').map((s) => s.trim()) : bruto) : undefined;
  res.json(await motor.listar({ status }));
});

app.get('/api/pecas/:id', async (req, res) => {
  res.json(await motor.detalhe(req.params.id));
});

app.post('/api/pipeline/rodar', async (req, res) => {
  const texto = String(req.body?.texto || '').trim().slice(0, 600);
  const categoria = String(req.body?.categoria || '').trim();
  const orientacao = texto || categoria ? { texto: texto || null, categoria: categoria || null } : null;
  const peca = await motor.gerar({ origem: 'manual', orientacao, usuario: quem(req) });
  res.status(202).json(peca);
});

app.post('/api/pecas/:id/aprovar', async (req, res) => {
  res.json(await motor.aprovar(req.params.id, quem(req)));
});

app.post('/api/pecas/:id/reprovar', async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
  res.json(await motor.reprovar(req.params.id, quem(req), motivo));
});

app.post('/api/pecas/:id/editar', async (req, res) => {
  res.json(await motor.editarTextos(req.params.id, quem(req), req.body?.campos || {}));
});

app.post('/api/pecas/:id/regenerar-imagem', async (req, res) => {
  const direcao = String(req.body?.direcao || '').trim().slice(0, 500);
  res.json(await motor.regenerarImagem(req.params.id, quem(req), direcao));
});

app.post('/api/pecas/:id/publicar', async (req, res) => {
  res.json(await motor.publicarAgora(req.params.id, quem(req)));
});

app.post('/api/categorias/:id/modo', async (req, res) => {
  await motor.definirModo(req.params.id, String(req.body?.modo || ''), quem(req));
  res.json({ ok: true });
});

app.post('/api/controle/pausar', async (req, res) => {
  await motor.pausar(quem(req), String(req.body?.motivo || '').trim().slice(0, 300));
  res.json({ ok: true });
});

app.post('/api/controle/retomar', async (req, res) => {
  await motor.retomar(quem(req));
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((erro, req, res, next) => {
  const status = erro.status || erro.statusCode || 500;
  if (status >= 500) console.error(erro);
  const mensagem = erro.type === 'entity.parse.failed' ? 'Corpo da requisição não é um JSON válido.' : erro.message;
  res.status(status).json({ erro: mensagem });
});

/* ----------------------------------------------------------------- boot */

const servidor = app.listen(env.porta, () => {
  const e = agenda();
  console.log(`\nMotor de campanhas rodando em http://localhost:${env.porta}`);
  console.log(`Armazenamento: ${db.tipo}   Publicação: ${canal.modo === 'real' ? 'REAL no Instagram' : 'simulação'}`);
  console.log(`IA: ${env.modeloIa} (revisor ${env.modeloJuiz})   Imagem: ${imagem.provedor} ${imagem.modelo}`);
  console.log(e.ativa ? `Agenda: "${e.expressao}" (${e.fuso}), próxima execução ${e.proxima}` : 'Agenda automática desligada (CRON_RADAR vazio).');
  console.log(autenticacaoAtiva ? 'Painel protegido por usuário e senha.' : 'Painel sem senha. Defina PAINEL_USUARIO e PAINEL_SENHA antes de expor na internet.');
  const pendencias = [...pendenciasDeConfiguracao(), ...(avisoAgenda ? [avisoAgenda] : [])];
  if (pendencias.length) {
    console.log('\nPendências de configuração:');
    for (const p of pendencias) console.log(`  - ${p}`);
  }
  console.log('');
});

function encerrar() {
  tarefaAgenda?.stop();
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
