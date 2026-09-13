const TelegramBot = require("node-telegram-bot-api");

const IA_ATIVADA = Boolean(process.env.ANTHROPIC_API_KEY);
let anthropic = null;
if (IA_ATIVADA) {
  const Anthropic = require("@anthropic-ai/sdk");
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} else {
  console.warn(
    "ANTHROPIC_API_KEY nao configurada - perguntas livres no Telegram ficarao desativadas (so /ultimo e alertas vao funcionar)."
  );
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_BASE_URL = process.env.TELEGRAM_WEBHOOK_URL; // ex: https://obd-backend-xxxx.onrender.com

// chat_id fica em memoria por enquanto - depois trocamos por banco de dados
let chatIdSalvo = process.env.TELEGRAM_CHAT_ID || null;

if (!TOKEN) {
  console.warn("TELEGRAM_BOT_TOKEN nao configurado - bot do Telegram desativado.");
}

// webHook:false porque nos mesmos vamos gerenciar a rota no Express
const bot = TOKEN ? new TelegramBot(TOKEN, { webHook: false }) : null;

/**
 * Configura o webhook do bot apontando pro backend publico.
 * Chamar isso uma vez quando o servidor sobe.
 */
async function configurarWebhook() {
  if (!bot || !WEBHOOK_BASE_URL) {
    console.warn("Webhook do Telegram nao configurado (falta token ou URL publica).");
    return;
  }
  const url = `${WEBHOOK_BASE_URL}/telegram/webhook`;
  await bot.setWebHook(url);
  console.log(`Webhook do Telegram configurado em: ${url}`);
}

/**
 * Processa updates recebidos via webhook.
 * Chamado pela rota POST /telegram/webhook no server.js
 */
function processarUpdate(update) {
  if (bot) bot.processUpdate(update);
}

/**
 * Envia uma mensagem para o chat salvo (usado pelos alertas automaticos).
 */
async function enviarAlerta(texto) {
  if (!bot || !chatIdSalvo) return;
  try {
    await bot.sendMessage(chatIdSalvo, texto, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Erro ao enviar alerta pro Telegram:", err.message);
  }
}

// Guarda uma referencia pro "ultimo registro" - sera injetada pelo server.js
let getUltimoRegistro = () => null;
function registrarFonteDeDados(fn) {
  getUltimoRegistro = fn;
}

if (bot) {
  // /start - salva o chat_id e confirma conexao
  bot.onText(/\/start/, (msg) => {
    chatIdSalvo = msg.chat.id;
    bot.sendMessage(
      chatIdSalvo,
      "🚗 *Mecânico Pessoal conectado!*\nVocê vai receber alertas automáticos por aqui. Pode perguntar coisas tipo:\n- /ultimo\n- \"quando devo trocar o óleo?\"",
      { parse_mode: "Markdown" }
    );
    console.log(`Chat ID salvo: ${chatIdSalvo}`);
  });

  // /ultimo - mostra o ultimo diagnostico salvo
  bot.onText(/\/ultimo/, (msg) => {
    const registro = getUltimoRegistro();
    if (!registro) {
      bot.sendMessage(msg.chat.id, "Nenhum registro salvo ainda.");
      return;
    }
    const texto =
      `🚗 *Último diagnóstico:*\n` +
      `*Códigos:* ${registro.codes.join(", ") || "nenhum"}\n` +
      `*KM:* ${registro.km || "—"}\n` +
      `*Diagnóstico:* ${registro.resultado.diagnosis}\n` +
      `*Urgência:* ${registro.resultado.urgency}`;
    bot.sendMessage(msg.chat.id, texto, { parse_mode: "Markdown" });
  });

  // Qualquer outra mensagem de texto (que nao seja comando) vai pra IA
  bot.on("message", async (msg) => {
    const texto = msg.text || "";
    if (texto.startsWith("/")) return; // comandos ja tratados acima

    if (!IA_ATIVADA) {
      bot.sendMessage(
        msg.chat.id,
        "Perguntas livres exigem uma chave da Anthropic configurada (ANTHROPIC_API_KEY). Por enquanto, use /ultimo para ver o último diagnóstico."
      );
      return;
    }

    const registro = getUltimoRegistro();
    const contexto = registro
      ? `Contexto do ultimo diagnostico do carro: ${JSON.stringify(registro)}`
      : "Nenhum diagnostico registrado ainda.";

    try {
      const resposta = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Voce e um assistente de manutencao automotiva chamado Mecanico Pessoal. ${contexto}\n\nPergunta do usuario: ${texto}\n\nResponda em portugues do Brasil, curto e direto (max 4 frases), formatado para leitura no Telegram.`,
          },
        ],
      });
      const textBlock = resposta.content.find((b) => b.type === "text");
      bot.sendMessage(msg.chat.id, textBlock ? textBlock.text : "Não consegui responder agora.");
    } catch (err) {
      console.error("Erro ao responder no Telegram:", err.message);
      bot.sendMessage(msg.chat.id, "Ocorreu um erro ao processar sua pergunta.");
    }
  });
}

module.exports = { bot, configurarWebhook, processarUpdate, enviarAlerta, registrarFonteDeDados };
