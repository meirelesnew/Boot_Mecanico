require("dotenv").config();
const express = require("express");
const { interpretDTC } = require("./dtcInterpreter");
const { decodificarModo03, decodificarDadosVivos } = require("./obdDecoder");
const { criarLimitador } = require("./limitador");
const banco = require("./armazenamento");
const telegram = require("./telegramBot");

// Uma falha pontual (ex: Telegram fora do ar) nao pode derrubar o servidor:
// se ele reiniciasse, perderiamos o que esta so na memoria.
process.on("unhandledRejection", (motivo) => {
  console.error("[erro] promessa rejeitada sem tratamento:", motivo && motivo.message ? motivo.message : motivo);
});

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------- Estado (fica na memoria e e gravado no banco quando ele esta configurado) ----------

let ultimoRegistro = null;
telegram.registrarFonteDeDados(() => ultimoRegistro);

// Leitura ao vivo muda a cada 2 segundos: fica so na memoria de proposito.
let ultimaLeituraViva = null;
telegram.registrarLeituraViva(() => ultimaLeituraViva);

const perfilCarro = { temGNV: false, observacoes: [], kmAtual: null };
const persistirPerfil = () => banco.salvar("perfil", perfilCarro);
const persistirRegistro = () => banco.salvar("ultimo_registro", ultimoRegistro);

telegram.registrarPerfil({
  getPerfil: () => perfilCarro,
  setTemGNV: (valor) => {
    perfilCarro.temGNV = valor;
    persistirPerfil();
  },
  addObservacao: (texto) => {
    perfilCarro.observacoes.push({ texto, data: new Date().toISOString() });
    persistirPerfil();
  },
  setKmAtual: (km) => {
    perfilCarro.kmAtual = km;
    persistirPerfil();
  },
});

async function carregarEstado() {
  if (!banco.ativo) {
    console.warn("[banco] SUPABASE_URL / SUPABASE_SECRET_KEY nao configurados: os dados ficam so na memoria.");
    return;
  }
  const [perfil, registro] = await Promise.all([banco.carregar("perfil"), banco.carregar("ultimo_registro")]);
  if (perfil) Object.assign(perfilCarro, perfil);
  if (!Array.isArray(perfilCarro.observacoes)) perfilCarro.observacoes = [];
  if (registro) ultimoRegistro = registro;
  console.log(
    `[banco] estado carregado (perfil: ${perfil ? "sim" : "vazio"}, ultimo registro: ${registro ? "sim" : "vazio"})`
  );
}

// ---------- Seguranca ----------

// Temperatura do motor a partir da qual o bot avisa (graus C)
const TEMP_ALERTA = 105;
// Com leitura automatica, avisa no maximo 1 vez a cada 5 minutos
const podeAlertarMotorQuente = criarLimitador(5 * 60 * 1000);

if (!process.env.OBD_TOKEN) {
  console.warn("[seguranca] OBD_TOKEN nao definido: as rotas do app ficam abertas para qualquer pessoa.");
}

// Senha opcional (?token=...) exigida nas rotas do app
function tokenOk(req) {
  const esperado = process.env.OBD_TOKEN;
  return !esperado || req.query.token === esperado;
}

function negar(res) {
  return res.status(401).type("text/plain").send("Nao autorizado");
}

// ---------- Rotas ----------

/**
 * Dados ja decodificados (JSON): { codes: ["P0300"], rpm, coolantTemp, km }
 */
app.post("/obd-data", async (req, res) => {
  if (!tokenOk(req)) return negar(res);

  const { codes = [], rpm, coolantTemp, km } = req.body;
  if (!Array.isArray(codes)) {
    return res.status(400).json({ error: "campo 'codes' deve ser uma lista" });
  }

  try {
    const resultado = await interpretDTC(codes, { rpm, coolantTemp, km }, perfilCarro);

    ultimoRegistro = { codes, rpm, coolantTemp, km, resultado, timestamp: new Date().toISOString() };
    persistirRegistro();

    if (resultado.urgency === "medio" || resultado.urgency === "alto") {
      await telegram.enviarAlerta(
        `⚠️ *Alerta do carro!*\n*Códigos:* ${codes.join(", ")}\n*Diagnóstico:* ${resultado.diagnosis}\n*Urgência:* ${resultado.urgency}`
      );
    }

    return res.json(ultimoRegistro);
  } catch (err) {
    console.error("Erro ao interpretar DTC:", err.message);
    return res.status(500).json({ error: "Falha ao interpretar codigos" });
  }
});

/**
 * Usado pelo app: recebe o TEXTO BRUTO que o ELM327 devolveu ao comando "03"
 * (ex: "SEARCHING... 43 01 30 00 00 00 00"), decodifica e avisa no Telegram.
 */
app.post("/obd-raw", express.text({ type: "*/*" }), async (req, res) => {
  if (!tokenOk(req)) return negar(res);

  const bruto = typeof req.body === "string" ? req.body : req.body && req.body.raw;
  const { codes, valido } = decodificarModo03(bruto);

  if (!valido) {
    return res
      .status(422)
      .type("text/plain")
      .send("Resposta nao reconhecida (sem dados do modo 03). Tente ler de novo.");
  }

  try {
    const km = perfilCarro.kmAtual;
    const resultado = await interpretDTC(codes, { km }, perfilCarro);

    ultimoRegistro = {
      codes,
      km,
      bruto: String(bruto).slice(0, 300),
      resultado,
      timestamp: new Date().toISOString(),
    };
    persistirRegistro();

    if (codes.length === 0) {
      await telegram.enviarAlerta("✅ *Leitura do scanner:* nenhum código de falha armazenado.");
      return res.type("text/plain").send("OK: nenhum codigo de falha");
    }

    if (resultado.urgency === "medio" || resultado.urgency === "alto") {
      await telegram.enviarAlerta(
        `⚠️ *Alerta do carro!*\n*Códigos:* ${codes.join(", ")}\n*Diagnóstico:* ${resultado.diagnosis}\n*Urgência:* ${resultado.urgency}`
      );
    } else {
      await telegram.enviarAlerta(
        `ℹ️ *Leitura do scanner:* ${codes.join(", ")}\n*Diagnóstico:* ${resultado.diagnosis}\n*Urgência:* ${resultado.urgency}`
      );
    }

    return res.type("text/plain").send(`Codigos: ${codes.join(", ")} | urgencia: ${resultado.urgency}`);
  } catch (err) {
    console.error("Erro no /obd-raw:", err.message);
    return res.status(500).type("text/plain").send("Falha ao processar a leitura");
  }
});

/**
 * Dados ao vivo: o app envia as respostas do ELM327 aos comandos 010C (RPM),
 * 0105 (temperatura) e 010D (velocidade), separadas por "|".
 * Com ?formato=csv a resposta vem como "rpm|temperatura|velocidade".
 */
app.post("/obd-live", express.text({ type: "*/*" }), async (req, res) => {
  if (!tokenOk(req)) return negar(res);

  const bruto = typeof req.body === "string" ? req.body : req.body && req.body.raw;
  const { rpm, coolantTemp, speed } = decodificarDadosVivos(bruto);

  if (rpm === null && coolantTemp === null && speed === null) {
    return res
      .status(422)
      .type("text/plain")
      .send("Nenhum dado reconhecido. Ligue a ignicao e rode 'Ler codigos' antes.");
  }

  ultimaLeituraViva = { rpm, coolantTemp, speed, timestamp: new Date().toISOString() };

  if (coolantTemp !== null && coolantTemp >= TEMP_ALERTA && podeAlertarMotorQuente()) {
    await telegram.enviarAlerta(
      `🌡️ *Motor quente!* Temperatura em *${coolantTemp} °C* (limite ${TEMP_ALERTA} °C).\nSe o ponteiro estiver alto, pare em local seguro e deixe esfriar.`
    );
  }

  if (req.query.formato === "csv") {
    const v = (x) => (x === null ? "--" : String(x));
    return res.type("text/plain").send(`${v(rpm)}|${v(coolantTemp)}|${v(speed)}`);
  }

  const fmt = (v, unid) => (v === null ? "sem dado" : `${v} ${unid}`.trim());
  return res
    .type("text/plain")
    .send(`RPM: ${fmt(rpm, "")} | Temp: ${fmt(coolantTemp, "C")} | Vel: ${fmt(speed, "km/h")}`);
});

/**
 * Simula uma leitura (sem carro). Nao grava no banco.
 */
app.post("/simulate", async (req, res) => {
  if (!tokenOk(req)) return negar(res);

  const exemplo = { codes: ["P0300", "P0171"], rpm: 2200, coolantTemp: 105, km: 278601 };

  try {
    const resultado = await interpretDTC(exemplo.codes, exemplo, perfilCarro);
    ultimoRegistro = { ...exemplo, resultado, timestamp: new Date().toISOString() };

    if (resultado.urgency === "medio" || resultado.urgency === "alto") {
      await telegram.enviarAlerta(
        `⚠️ *Alerta do carro (simulado)!*\n*Códigos:* ${exemplo.codes.join(", ")}\n*Diagnóstico:* ${resultado.diagnosis}\n*Urgência:* ${resultado.urgency}`
      );
    }

    return res.json({ enviado: exemplo, resultado });
  } catch (err) {
    console.error("Erro na simulacao:", err.message);
    return res.status(500).json({ error: "Falha na simulacao" });
  }
});

/**
 * "Estou vivo": usado pelo UptimeRobot para manter o Render acordado.
 * Uma vez por hora tambem faz um acesso leve ao banco: no plano gratuito do
 * Supabase o projeto e pausado apos 7 dias sem uso, e isso evita a pausa.
 * Rota aberta de proposito, e nao devolve nenhum dado.
 */
let ultimoPingBanco = 0;
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });

  const agora = Date.now();
  if (banco.ativo && agora - ultimoPingBanco > 60 * 60 * 1000) {
    ultimoPingBanco = agora;
    banco.testar().then((r) => {
      if (!r.ok) console.error("[banco] ping de manutencao falhou:", r.erro);
    });
  }
});

/** Ultimo diagnostico salvo. */
app.get("/ultimo", (req, res) => {
  if (!tokenOk(req)) return negar(res);
  if (!ultimoRegistro) {
    return res.status(404).json({ error: "Nenhum registro ainda" });
  }
  return res.json(ultimoRegistro);
});

/**
 * Webhook do Telegram. So aceita chamadas que tragam o segredo registrado
 * junto com o webhook (cabecalho que o proprio Telegram envia).
 */
app.post("/telegram/webhook", (req, res) => {
  if (!telegram.webhookAutorizado(req.get("x-telegram-bot-api-secret-token"))) {
    return res.sendStatus(401);
  }
  telegram.processarUpdate(req.body);
  res.sendStatus(200);
});

// ---------- Inicializacao ----------

async function iniciar() {
  // Carrega o estado do banco antes de abrir a porta (com limite de tempo, pra nunca travar o deploy)
  await Promise.race([
    Promise.all([carregarEstado(), telegram.iniciar()]),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);

  app.listen(PORT, async () => {
    console.log(`Servidor OBD rodando em http://localhost:${PORT}`);
    await telegram.configurarWebhook();
  });
}

iniciar();
