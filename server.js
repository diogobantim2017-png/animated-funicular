import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env, raiz, politica, pendenciasDeConfiguracao } from './config.js';
import { proximoDia } from './regua.js';
import { verificarConexaoInstagram } from './instagram.js';

/* Conexão com o Instagram, conferida no início quando a publicação é real. */
let statusInstagram = null;
import { criarArmazenamento } from './index.js';
import { chamarFerramenta, perguntarComBusca } from './claude.js';
import { criarGeo, motoresDisponiveis } from './geo.js';
import { criarGeradorImagem } from './gerador.js';
import { criarCanalInstagram } from './instagram.js';
import { CHECAGENS_VISUAIS, NOTAS } from './juiz.js';
import { criarMotor } from './motor.js';
import { criarBancoDeFotos } from './fotos.js';
import { listarBanco, caminhoDoBanco, descreverPendentes, catalogoCompleto } from './banco.js';

const db = await criarArmazenamento();
const imagem = criarGeradorImagem();
const canal = criarCanalInstagram();
const fotos = criarBancoDeFotos();
const motor = criarMotor({ db, ia: chamarFerramenta, imagem, fotos, canal });
const geo = criarGeo({ db, motores: motoresDisponiveis({ perguntarClaude: perguntarComBusca }), ia: env.anthropicKey ? chamarFerramenta : null, modelo: env.modeloIa });

const app = express();
app.disable('x-powered-by');
// O histórico do radar de visibilidade pode passar de 1 MB; as outras rotas seguem com o limite menor.
const jsonPadrao = express.json({ limit: '1mb' });
const jsonGrande = express.json({ limit: '25mb' });
app.use((req, res, next) => (req.path === '/api/geo/importar' ? jsonGrande : jsonPadrao)(req, res, next));

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

/* Interface do painel: só estes arquivos são servidos. O restante da pasta é código do servidor. */
const arquivosDoPainel = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/estilo.css': 'estilo.css',
  '/app.js': 'app.js',
  '/efeitos.js': 'efeitos.js',
  '/fontes/Ubuntu-Regular.ttf': 'Ubuntu-Regular.ttf',
  '/fontes/Ubuntu-Medium.ttf': 'Ubuntu-Medium.ttf',
  '/fontes/Ubuntu-Bold.ttf': 'Ubuntu-Bold.ttf',
};
for (const [rota, arquivo] of Object.entries(arquivosDoPainel)) {
  app.get(rota, (req, res) => res.sendFile(path.join(raiz, arquivo)));
}

/** Quem executou a ação: nome informado no painel, senão o usuário do login, senão "equipe". */
function quem(req) {
  const nome = String(req.body?.usuario || '').trim().slice(0, 60);
  return nome || req.usuario || 'equipe';
}

/* ---------------------------------------------------------------- agenda */

// Radar de visibilidade em IA: confere de hora em hora se já passou uma semana desde a última rodada.
cron.schedule(
  '23 * * * *',
  async () => {
    try {
      await geo.verificarSemanal();
    } catch (erro) {
      console.error('Falha na rodada semanal de visibilidade em IA:', erro.message);
    }
  },
  { timezone: env.fuso, noOverlap: true, name: 'geo' },
);

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
    pendencias: [
      ...estado.pendencias,
      ...(avisoAgenda ? [avisoAgenda] : []),
      ...(statusInstagram && !statusInstagram.ok ? [`Instagram: ${statusInstagram.erro}`] : []),
    ],
    instagram: statusInstagram,
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

/* Régua de comunicação */
app.get('/api/reguas', async (req, res) => {
  res.json(await motor.listarReguas());
});

app.post('/api/reguas', async (req, res) => {
  const b = req.body || {};
  const pedido = {
    objetivo: String(b.objetivo || '').slice(0, 600),
    publico: String(b.publico || '').slice(0, 60),
    obrigatorios: String(b.obrigatorios || '').slice(0, 1500),
    ja_produzido: String(b.ja_produzido || '').slice(0, 4000),
    observacoes: String(b.observacoes || '').slice(0, 800),
    total: Number(b.total) || 9,
    inicio: String(b.inicio || ''),
    dias_semana: Array.isArray(b.dias_semana) ? b.dias_semana.map(Number) : [2, 4],
  };
  res.json(await motor.criarRegua(quem(req), pedido));
});

app.post('/api/reguas/sugerida', async (req, res) => {
  const arquivo = path.join(raiz, 'regua-inicial.json');
  if (!fs.existsSync(arquivo)) return res.status(404).json({ erro: 'Não há régua sugerida neste perfil.' });
  const modelo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const dias = modelo.cadencia?.dias_semana || [2, 4];
  // Se a data planejada já passou, a série começa no próximo dia de publicação.
  const hojeIso = new Date().toISOString().slice(0, 10);
  const inicio = req.body?.inicio || (modelo.cadencia?.inicio > hojeIso ? modelo.cadencia.inicio : proximoDia(dias[0]));
  modelo.cadencia = { ...modelo.cadencia, inicio: String(inicio) };
  res.json(await motor.importarRegua(quem(req), modelo));
});

app.get('/api/reguas/:id', async (req, res) => {
  res.json(await motor.obterRegua(req.params.id));
});

app.delete('/api/reguas/:id', async (req, res) => {
  res.json(await motor.excluirRegua(req.params.id));
});

app.patch('/api/reguas/:id/itens/:item', async (req, res) => {
  const b = req.body || {};
  res.json(await motor.atualizarItemRegua(req.params.id, req.params.item, { data: b.data, titulo: b.titulo, ja_produzido: b.ja_produzido }));
});

app.post('/api/reguas/:id/itens/:item/gerar', async (req, res) => {
  res.json(await motor.gerarPecaDaRegua(req.params.id, req.params.item, quem(req)));
});

app.get('/api/reguas/:id/pdf', async (req, res) => {
  const pdf = await motor.pdfDaRegua(req.params.id);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="regua-${req.params.id.slice(0, 8)}.pdf"`);
  res.send(pdf);
});

app.get('/api/pecas/:id/pdf', async (req, res) => {
  const pdf = await motor.pdfDaPeca(req.params.id);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="post-${req.params.id.slice(0, 8)}.pdf"`);
  res.send(pdf);
});

app.get('/api/pecas/:id', async (req, res) => {
  res.json(await motor.detalhe(req.params.id));
});

app.post('/api/pipeline/rodar', async (req, res) => {
  const texto = String(req.body?.texto || '').trim().slice(0, 600);
  const categoria = String(req.body?.categoria || '').trim();
  const orientacao = {
    texto: texto || null,
    categoria: categoria || null,
    formato: String(req.body?.formato || 'post'),
    visual: String(req.body?.visual || 'ia'),
    num_slides: Number(req.body?.slides) || null,
  };
  const peca = await motor.gerar({ origem: 'manual', orientacao, usuario: quem(req) });
  res.status(202).json(peca);
});

app.post('/api/pecas/:id/aprovar', async (req, res) => {
  res.json(await motor.aprovar(req.params.id, quem(req), { quando: req.body?.quando || 'agora' }));
});

app.post('/api/pecas/:id/reagendar', async (req, res) => {
  res.json(await motor.reagendar(req.params.id, quem(req), req.body?.quando || 'proximo'));
});

app.post('/api/pecas/:id/cancelar-agendamento', async (req, res) => {
  res.json(await motor.cancelarAgendamento(req.params.id, quem(req)));
});

// Radar de visibilidade em IA (GEO, em teste).
app.get('/api/geo', async (req, res) => {
  res.json({ config: await geo.config(), motores: geo.motores(), situacao: geo.situacao(), rodadas: await geo.listar() });
});

app.put('/api/geo/config', async (req, res) => {
  res.json(await geo.salvarConfig(req.body || {}));
});

app.post('/api/geo/rodar', async (req, res) => {
  res.json(await geo.rodar(String(req.body?.usuario || 'equipe').slice(0, 80)));
});

app.get('/api/geo/rodadas/:id', async (req, res) => {
  const rodada = await geo.obter(req.params.id);
  if (!rodada) return res.status(404).json({ erro: 'Rodada não encontrada.' });
  res.json(rodada);
});

app.post('/api/geo/rodadas/:id/diagnostico', async (req, res) => {
  res.json(await geo.diagnosticar(req.params.id));
});

app.get('/api/geo/rodadas/:id/plano', async (req, res) => {
  const texto = await geo.plano(req.params.id);
  res.set('Content-Disposition', `attachment; filename="plano-visibilidade-em-ia-${req.params.id.replace(/[^a-z0-9-]/gi, '')}.txt"`);
  res.type('text/plain; charset=utf-8').send(texto);
});

app.get('/api/geo/exportar', async (req, res) => {
  res.set('Content-Disposition', `attachment; filename="visibilidade-em-ia-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(await geo.exportar()));
});

app.post('/api/geo/importar', async (req, res) => {
  res.json(await geo.importar(req.body));
});

// Banco de imagens da marca: fotos banco-*.jpg na pasta do projeto.
app.get('/api/banco', async (req, res) => {
  res.json(await listarBanco());
});

// A IA descreve as fotos que ainda não têm descrição (em partes; o painel chama de novo até acabar).
app.post('/api/banco/descrever', async (req, res) => {
  if (!env.anthropicKey) return res.status(400).json({ erro: 'Falta a chave da IA (ANTHROPIC_API_KEY) para descrever as fotos.' });
  res.json(await descreverPendentes({ ia: chamarFerramenta, modelo: env.modeloIa, limite: 24 }));
});

// Catálogo completo para baixar e subir no projeto, para não precisar descrever de novo.
app.get('/api/banco/catalogo', async (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="banco-imagens.json"');
  res.type('application/json').send(JSON.stringify(await catalogoCompleto(), null, 2));
});

app.get('/banco/*caminho', (req, res) => {
  const relativo = [].concat(req.params.caminho || []).join('/');
  const caminho = caminhoDoBanco(relativo);
  if (!caminho || !fs.existsSync(caminho)) return res.status(404).send('Foto não encontrada no banco.');
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(caminho);
});

app.get('/api/programacao', async (req, res) => {
  res.json(await motor.programacao());
});

app.put('/api/programacao', async (req, res) => {
  res.json(await motor.salvarProgramacao(req.body || {}, quem(req)));
});

app.post('/api/pecas/:id/reprovar', async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim().slice(0, 500);
  res.json(await motor.reprovar(req.params.id, quem(req), motivo));
});

app.post('/api/pecas/:id/editar', async (req, res) => {
  res.json(await motor.editarTextos(req.params.id, quem(req), req.body?.campos || {}));
});

app.post('/api/pecas/:id/ajustar-textos', async (req, res) => {
  res.json(await motor.ajustarTextosComIa(req.params.id, quem(req), String(req.body?.pedido || '').slice(0, 1000)));
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

/* ------------------------------------------------------------ programação */

// A cada minuto: publica o que chegou na hora e gera peças para os próximos horários.
let tickRodando = false;
async function tickProgramacao() {
  if (tickRodando) return;
  tickRodando = true;
  try {
    await motor.tickProgramacao();
  } catch (erro) {
    console.error('Programação:', erro.message);
  } finally {
    tickRodando = false;
  }
}
const relogioProgramacao = setInterval(tickProgramacao, 60_000);
setTimeout(tickProgramacao, 15_000);

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
  if (canal.modo === 'real') {
    verificarConexaoInstagram().then((s) => {
      statusInstagram = s;
      console.log(s.ok ? `Instagram conectado: @${s.usuario || 'conta sem nome'} (id ${s.id})` : `Instagram: ${s.erro}`);
    });
  }
});

function encerrar() {
  tarefaAgenda?.stop();
  clearInterval(relogioProgramacao);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
