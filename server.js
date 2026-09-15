require("dotenv").config();
const express = require("express");
const { interpretDTC } = require("./dtcInterpreter");
const {
  configurarWebhook,
  processarUpdate,
  enviarAlerta,
  registrarFonteDeDados,
  registrarPerfil,
} = require("./telegramBot");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Guarda o ultimo registro em memoria (depois trocamos por banco de dados)
let ultimoRegistro = null;
registrarFonteDeDados(() => ultimoRegistro);

// Perfil do carro - informacoes fixas que ajudam a interpretar os diagnosticos
let perfilCarro = { temGNV: false, observacoes: [], kmAtual: null };
registrarPerfil({
  getPerfil: () => perfilCarro,
  setTemGNV: (valor) => {
    perfilCarro.temGNV = valor;
  },
  addObservacao: (texto) => {
    perfilCarro.observacoes.push({ texto, data: new Date().toISOString() });
  },
  setKmAtual: (km) => {
    perfilCarro.kmAtual = km;
  },
});

/**
 * Endpoint que o APP (React Native) vai chamar de verdade,
 * enviando os dados lidos do scanner Bluetooth.
 *
 * Body esperado:
 * {
 *   "codes": ["P0300"],
 *   "rpm": 850,
 *   "coolantTemp": 92,
 *   "km": 278601
 * }
 */
app.post("/obd-data", async (req, res) => {
  const { codes = [], rpm, coolantTemp, km } = req.body;

  if (!Array.isArray(codes)) {
    return res.status(400).json({ error: "campo 'codes' deve ser uma lista" });
  }

  try {
    const resultado = await interpretDTC(codes, { rpm, coolantTemp, km }, perfilCarro);

    ultimoRegistro = {
      codes,
      rpm,
      coolantTemp,
      km,
      resultado,
      timestamp: new Date().toISOString(),
    };

    if (resultado.urgency === "medio" || resultado.urgency === "alto") {
      await enviarAlerta(
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
 * Endpoint de teste - simula o que o scanner mandaria,
 * sem precisar de hardware nenhum conectado.
 */
app.post("/simulate", async (req, res) => {
  const exemplo = {
    codes: ["P0300", "P0171"],
    rpm: 2200,
    coolantTemp: 105,
    km: 278601,
  };

  try {
    const resultado = await interpretDTC(exemplo.codes, exemplo, perfilCarro);

    ultimoRegistro = {
      ...exemplo,
      resultado,
      timestamp: new Date().toISOString(),
    };

    if (resultado.urgency === "medio" || resultado.urgency === "alto") {
      await enviarAlerta(
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
 * Rota simples de "estou vivo" - usada por servicos de monitoramento
 * (ex: UptimeRobot) pra manter o servidor acordado no plano free do Render.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Consulta o ultimo registro salvo.
 */
app.get("/ultimo", (req, res) => {
  if (!ultimoRegistro) {
    return res.status(404).json({ error: "Nenhum registro ainda" });
  }
  return res.json(ultimoRegistro);
});

/**
 * Rota que o Telegram chama automaticamente quando alguem manda
 * mensagem pro bot. Nao precisa chamar isso manualmente.
 */
app.post("/telegram/webhook", (req, res) => {
  processarUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  console.log(`Servidor OBD rodando em http://localhost:${PORT}`);
  await configurarWebhook();
});
