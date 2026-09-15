const TelegramBot = require("node-telegram-bot-api");
const { perguntarIA, IA_ATIVADA } = require("./openRouterClient");

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

// Guarda funcoes de acesso ao perfil do carro - sera injetado pelo server.js
let perfilFns = {
  getPerfil: () => ({ temGNV: false, observacoes: [], kmAtual: null }),
  setTemGNV: () => {},
  addObservacao: () => {},
  setKmAtual: () => {},
};
function registrarPerfil(fns) {
  perfilFns = fns;
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

  // /gnv ou /gnv on - ativa a flag de GNV no perfil do carro
  bot.onText(/\/gnv(?:\s+(on|off))?/, (msg, match) => {
    const modo = match[1] || "on";
    const ativar = modo !== "off";
    perfilFns.setTemGNV(ativar);
    bot.sendMessage(
      msg.chat.id,
      ativar
        ? "✅ Perfil atualizado: carro marcado como *equipado com GNV*. Vou considerar isso nos diagnósticos de sensor de oxigênio."
        : "✅ Perfil atualizado: GNV desativado.",
      { parse_mode: "Markdown" }
    );
  });

  // /km <numero> - atualiza a quilometragem atual de verdade no perfil
  bot.onText(/\/km (\d+)/, (msg, match) => {
    const km = parseInt(match[1], 10);
    perfilFns.setKmAtual(km);
    bot.sendMessage(msg.chat.id, `📍 Quilometragem atualizada: *${km.toLocaleString("pt-BR")} km*`, {
      parse_mode: "Markdown",
    });
  });

  // /perfil - mostra o que esta salvo sobre o carro
  bot.onText(/\/perfil/, (msg) => {
    const perfil = perfilFns.getPerfil();
    const observacoes = perfil.observacoes.length
      ? perfil.observacoes.map((o) => `- ${o.texto}`).join("\n")
      : "Nenhuma observação registrada.";
    const texto =
      `🚗 *Perfil do carro:*\n` +
      `*KM atual:* ${perfil.kmAtual ? perfil.kmAtual.toLocaleString("pt-BR") + " km" : "não informado"}\n` +
      `*GNV:* ${perfil.temGNV ? "Sim" : "Não"}\n` +
      `*Observações:*\n${observacoes}`;
    bot.sendMessage(msg.chat.id, texto, { parse_mode: "Markdown" });
  });

  // /obs <texto> - adiciona uma observacao livre ao perfil
  bot.onText(/\/obs (.+)/, (msg, match) => {
    const texto = match[1];
    perfilFns.addObservacao(texto);
    bot.sendMessage(msg.chat.id, `📌 Observação salva: "${texto}"`);
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
        "Perguntas livres exigem uma chave da OpenRouter configurada (OPENROUTER_API_KEY). Por enquanto, use /ultimo para ver o último diagnóstico."
      );
      return;
    }

    const registro = getUltimoRegistro();
    const perfil = perfilFns.getPerfil();
    const contexto =
      (registro
        ? `Contexto do ultimo diagnostico do carro: ${JSON.stringify(registro)}. `
        : "Nenhum diagnostico registrado ainda. ") +
      `Perfil do carro: KM atual = ${perfil.kmAtual ?? "não informado"}. Tem GNV = ${
        perfil.temGNV ? "sim" : "não"
      }. Observações: ${perfil.observacoes.map((o) => o.texto).join("; ") || "nenhuma"}. ` +
      `IMPORTANTE: você não tem capacidade de salvar, atualizar ou registrar nada no sistema - você só responde perguntas com base no contexto acima. Se o usuário pedir para atualizar algo, informe que ele deve usar um comando (ex: /km, /gnv, /obs) em vez de dizer que já foi feito.`;

    try {
      const systemPrompt = `Voce e um assistente de manutencao automotiva chamado Mecanico Pessoal. ${contexto} Responda em portugues do Brasil, curto e direto (max 4 frases), formatado para leitura no Telegram.`;
      const resposta = await perguntarIA(systemPrompt, texto);
      bot.sendMessage(msg.chat.id, resposta || "Não consegui responder agora, tenta de novo em instantes.");
    } catch (err) {
      console.error("Erro ao responder no Telegram:", err.message);
      bot.sendMessage(msg.chat.id, "Ocorreu um erro ao processar sua pergunta.");
    }
  });
}

module.exports = { bot, configurarWebhook, processarUpdate, enviarAlerta, registrarFonteDeDados, registrarPerfil };
