const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");
const { perguntarIA, IA_ATIVADA } = require("./openRouterClient");
const { montarTextoUltimo } = require("./formatadores");
const banco = require("./armazenamento");
const combustivel = require("./combustivel");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_BASE_URL = process.env.TELEGRAM_WEBHOOK_URL; // ex: https://obd-backend-xxxx.onrender.com

// Segredo que o Telegram devolve em cada chamada do webhook (cabecalho
// X-Telegram-Bot-Api-Secret-Token). Derivado do token do bot: nao precisa configurar nada.
const SEGREDO_WEBHOOK = TOKEN
  ? crypto.createHash("sha256").update(TOKEN).digest("hex").slice(0, 48)
  : null;
// So passa a exigir o segredo depois que o Telegram confirmou que o webhook foi registrado com ele.
let segredoAtivo = false;

// Dono do bot: so o chat dele e atendido. Vem da variavel TELEGRAM_CHAT_ID, ou do banco, ou do primeiro /start.
let chatIdSalvo = process.env.TELEGRAM_CHAT_ID || null;

if (!TOKEN) {
  console.warn("TELEGRAM_BOT_TOKEN nao configurado - bot do Telegram desativado.");
}

// webHook:false porque nos mesmos gerenciamos a rota no Express.
// TELEGRAM_API_BASE existe so para testes automatizados (aponta para um Telegram falso).
const opcoesBot = { webHook: false };
if (process.env.TELEGRAM_API_BASE) opcoesBot.baseApiUrl = process.env.TELEGRAM_API_BASE;
const bot = TOKEN ? new TelegramBot(TOKEN, opcoesBot) : null;

/** Carrega do banco o chat autorizado (se nao veio por variavel de ambiente). */
async function iniciar() {
  if (chatIdSalvo) return;
  const salvo = await banco.carregar("chat_id");
  if (salvo) {
    chatIdSalvo = salvo;
    console.log("[telegram] chat autorizado carregado do banco");
  }
}

/** Registra o webhook no Telegram, ja com o segredo. */
async function configurarWebhook() {
  if (!bot || !WEBHOOK_BASE_URL) {
    console.warn("Webhook do Telegram nao configurado (falta token ou URL publica).");
    return;
  }
  const url = `${WEBHOOK_BASE_URL}/telegram/webhook`;
  try {
    await bot.setWebHook(url, { secret_token: SEGREDO_WEBHOOK });
    segredoAtivo = true;
    console.log(`Webhook do Telegram configurado em: ${url}`);
  } catch (err) {
    console.error("[telegram] falha ao configurar o webhook:", err.message);
  }
}

/** A rota do webhook usa isto: confere o segredo enviado pelo Telegram. */
function webhookAutorizado(segredoRecebido) {
  return !segredoAtivo || segredoRecebido === SEGREDO_WEBHOOK;
}

/**
 * Processa updates recebidos via webhook. Ponto unico de controle de acesso:
 *  - ja existe dono: ignora qualquer chat que nao seja o dele
 *  - ainda nao existe dono: so aceita /start (que registra o dono)
 */
function processarUpdate(update) {
  const msg = update && update.message;
  if (!bot || !msg || !msg.chat) return;

  const chatId = msg.chat.id;
  if (chatIdSalvo) {
    if (String(chatId) !== String(chatIdSalvo)) {
      console.warn(`[telegram] mensagem ignorada de chat nao autorizado (${chatId})`);
      return;
    }
  } else if (!/^\/start\b/i.test(msg.text || "")) {
    return;
  }

  bot.processUpdate(update);
}

/** Envia mensagem sem nunca derrubar o servidor; se o Markdown falhar, reenvia como texto simples. */
async function responder(chatId, texto, opcoes) {
  if (!bot) return;
  try {
    await bot.sendMessage(chatId, texto, opcoes);
  } catch (err) {
    if (opcoes && opcoes.parse_mode && /parse entities/i.test(err.message)) {
      try {
        await bot.sendMessage(chatId, texto);
        return;
      } catch (err2) {
        err = err2;
      }
    }
    console.error("[telegram] falha ao enviar mensagem:", err.message);
  }
}

const MD = { parse_mode: "Markdown" };

/** Envia um alerta automatico para o dono. */
async function enviarAlerta(texto) {
  if (!chatIdSalvo) return;
  await responder(chatIdSalvo, texto, MD);
}

// ---------- Ligacoes com o resto do sistema (injetadas pelo server.js) ----------
let getUltimoRegistro = () => null;
function registrarFonteDeDados(fn) {
  getUltimoRegistro = fn;
}

let getLeituraViva = () => null;
function registrarLeituraViva(fn) {
  getLeituraViva = fn;
}

let perfilFns = {
  getPerfil: () => ({ temGNV: false, observacoes: [], kmAtual: null }),
  setTemGNV: () => {},
  addObservacao: () => {},
  setKmAtual: () => {},
};
function registrarPerfil(fns) {
  perfilFns = fns;
}

function formatarDuracao(segundos) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const AJUDA = [
  "🚗 *Comandos do Mecânico Pessoal*",
  "",
  "*Carro*",
  "/km 281900 — atualiza a quilometragem",
  "/gnv — marca o carro como tendo GNV (`/gnv off` desmarca)",
  "/obs texto — guarda uma observação",
  "/perfil — mostra o que está salvo",
  "",
  "*Leituras do scanner*",
  "/ultimo — último diagnóstico",
  "/vivo — última leitura de RPM, temperatura e velocidade",
  "",
  "*Combustível*",
  "/abastecer gasolina 32,5 6,29 — registra um abastecimento",
  "/combustivel — gastos, custo por km e consumo",
  "/desfazer — apaga o último abastecimento",
  "",
  "*Sistema*",
  "/status — confere banco de dados e IA",
  "",
  "Qualquer outra mensagem vai para a IA (ex: \"quando trocar o óleo?\").",
].join("\n");

const COMANDOS_CONHECIDOS =
  /^\/(start|ajuda|help|km|gnv|obs|perfil|vivo|[uú]ltimo|abastecer|combust[ií]vel|gastos|desfazer|status)\b/i;

if (bot) {
  /** Registra um comando. `padrao` e um trecho de regex (aceita variantes, como acentos). */
  function comando(padrao, tratador) {
    const re = new RegExp(`^\\/(?:${padrao})(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`, "i");
    bot.onText(re, (msg, match) => {
      const argumento = ((match && match[1]) || "").trim();
      Promise.resolve(tratador(msg, argumento)).catch((err) => {
        console.error(`[telegram] erro no comando "${msg.text}":`, err.message);
        responder(msg.chat.id, "Não consegui concluir esse comando agora. Tente de novo em instantes.");
      });
    });
  }

  comando("start", async (msg) => {
    const primeiraVez = !chatIdSalvo;
    chatIdSalvo = msg.chat.id;
    if (primeiraVez) await banco.salvar("chat_id", chatIdSalvo);
    console.log(`Chat ID autorizado: ${chatIdSalvo}`);
    await responder(
      msg.chat.id,
      "🚗 *Mecânico Pessoal conectado!*\nVocê vai receber alertas automáticos por aqui.\nUse /ajuda para ver todos os comandos.",
      MD
    );
  });

  comando("ajuda|help", (msg) => responder(msg.chat.id, AJUDA, MD));

  comando("gnv", (msg, arg) => {
    const ativar = arg.toLowerCase() !== "off";
    perfilFns.setTemGNV(ativar);
    return responder(
      msg.chat.id,
      ativar
        ? "✅ Perfil atualizado: carro marcado como *equipado com GNV*. Vou considerar isso nos diagnósticos de sensor de oxigênio."
        : "✅ Perfil atualizado: GNV desativado.",
      MD
    );
  });

  comando("km", (msg, arg) => {
    const km = parseInt(arg.replace(/\./g, ""), 10);
    if (!/^[\d.]+$/.test(arg) || !(km >= 0 && km <= 5000000)) {
      return responder(msg.chat.id, "Informe o KM assim: /km 281900");
    }
    perfilFns.setKmAtual(km);
    return responder(msg.chat.id, `📍 Quilometragem atualizada: *${km.toLocaleString("pt-BR")} km*`, MD);
  });

  comando("perfil", (msg) => {
    const perfil = perfilFns.getPerfil();
    const observacoes = perfil.observacoes.length
      ? perfil.observacoes.map((o) => `- ${o.texto}`).join("\n")
      : "Nenhuma observação registrada.";
    return responder(
      msg.chat.id,
      `🚗 *Perfil do carro:*\n` +
        `*KM atual:* ${perfil.kmAtual ? perfil.kmAtual.toLocaleString("pt-BR") + " km" : "não informado"}\n` +
        `*GNV:* ${perfil.temGNV ? "Sim" : "Não"}\n` +
        `*Observações:*\n${observacoes}`,
      MD
    );
  });

  comando("obs", (msg, arg) => {
    if (!arg) return responder(msg.chat.id, "Escreva a observação assim: /obs troquei as pastilhas de freio");
    perfilFns.addObservacao(arg);
    return responder(msg.chat.id, `📌 Observação salva: "${arg}"`);
  });

  comando("vivo", (msg) => {
    const l = getLeituraViva();
    if (!l) {
      return responder(msg.chat.id, "Nenhuma leitura ao vivo ainda. Ligue o interruptor no app.");
    }
    const fmt = (v, unid) => (v === null ? "sem dado" : `${v} ${unid}`.trim());
    const hora = new Date(l.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return responder(
      msg.chat.id,
      `📟 *Última leitura ao vivo* (${hora})\n*RPM:* ${fmt(l.rpm, "")}\n*Temperatura:* ${fmt(l.coolantTemp, "°C")}\n*Velocidade:* ${fmt(l.speed, "km/h")}`,
      MD
    );
  });

  comando("[uú]ltimo", (msg) => {
    const registro = getUltimoRegistro();
    if (!registro) return responder(msg.chat.id, "Nenhum registro salvo ainda.");
    return responder(msg.chat.id, montarTextoUltimo(registro, perfilFns.getPerfil()), MD);
  });

  // ---------- Combustivel ----------
  comando("abastecer", async (msg, arg) => {
    const chatId = msg.chat.id;
    if (!banco.ativo) {
      return responder(chatId, "⛽ O controle de combustível precisa do banco de dados (Supabase) configurado.");
    }
    const r = combustivel.interpretarAbastecimento(arg);
    if (!r.ok) return responder(chatId, `${r.erro}\n\n${combustivel.AJUDA_ABASTECER}`, MD);

    const perfil = perfilFns.getPerfil();
    let km = r.valor.km;
    let usouKmDoPerfil = false;
    if (!km && perfil.kmAtual) {
      km = perfil.kmAtual;
      usouKmDoPerfil = true;
    }

    const salvo = await banco.inserirAbastecimento({ ...r.valor, km: km || null });
    if (r.valor.km && (!perfil.kmAtual || r.valor.km > perfil.kmAtual)) perfilFns.setKmAtual(r.valor.km);

    return responder(chatId, combustivel.textoAbastecimentoSalvo(salvo, usouKmDoPerfil), MD);
  });

  comando("combust[ií]vel|gastos", async (msg) => {
    if (!banco.ativo) {
      return responder(msg.chat.id, "⛽ O controle de combustível precisa do banco de dados (Supabase) configurado.");
    }
    const lista = await banco.listarAbastecimentos(500);
    return responder(msg.chat.id, combustivel.formatarResumo(combustivel.calcularResumo(lista)), MD);
  });

  comando("desfazer", async (msg) => {
    if (!banco.ativo) {
      return responder(msg.chat.id, "⛽ O controle de combustível precisa do banco de dados (Supabase) configurado.");
    }
    const [ultimo] = await banco.listarAbastecimentos(1);
    if (!ultimo) return responder(msg.chat.id, "Não há abastecimento para desfazer.");
    await banco.removerAbastecimento(ultimo.id);
    return responder(
      msg.chat.id,
      `↩️ Abastecimento apagado:\n${combustivel.textoLinhaAbastecimento({
        ...ultimo,
        quantidade: Number(ultimo.quantidade),
        preco_unitario: Number(ultimo.preco_unitario),
        total: Number(ultimo.total),
        km: ultimo.km === null ? null : Number(ultimo.km),
        data: new Date(ultimo.data),
      })}`
    );
  });

  // ---------- Sistema ----------
  comando("status", async (msg) => {
    const t = await banco.testar();
    const textoBanco = !banco.ativo ? "não configurado" : t.ok ? `ok (${t.ms} ms)` : `com erro: ${t.erro}`;
    return responder(
      msg.chat.id,
      [
        "🔧 *Status do sistema*",
        `*Banco (Supabase):* ${textoBanco}`,
        `*IA (OpenRouter):* ${IA_ATIVADA ? "ativada" : "desativada"}`,
        `*Servidor ligado há:* ${formatarDuracao(process.uptime())}`,
      ].join("\n"),
      MD
    );
  });

  // ---------- Qualquer outra mensagem de texto ----------
  bot.on("message", async (msg) => {
    const texto = msg.text || "";
    const chatId = msg.chat.id;

    if (texto.startsWith("/")) {
      if (!COMANDOS_CONHECIDOS.test(texto)) {
        await responder(chatId, "Não conheço esse comando. Use /ajuda para ver a lista.");
      }
      return;
    }
    if (!texto) return;

    if (!IA_ATIVADA) {
      await responder(
        chatId,
        "Perguntas livres exigem uma chave da OpenRouter configurada (OPENROUTER_API_KEY). Por enquanto, use /ajuda para ver os comandos."
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
      `IMPORTANTE: você não tem capacidade de salvar, atualizar ou registrar nada no sistema - você só responde perguntas com base no contexto acima. Se o usuário pedir para atualizar algo, informe que ele deve usar um comando (ex: /km, /gnv, /obs, /abastecer) em vez de dizer que já foi feito.`;

    try {
      const systemPrompt = `Voce e um assistente de manutencao automotiva chamado Mecanico Pessoal. ${contexto} Responda em portugues do Brasil, curto e direto (max 4 frases), formatado para leitura no Telegram.`;
      const resposta = await perguntarIA(systemPrompt, texto);
      await responder(chatId, resposta || "Não consegui responder agora, tenta de novo em instantes.");
    } catch (err) {
      console.error("Erro ao responder no Telegram:", err.message);
      await responder(chatId, "Ocorreu um erro ao processar sua pergunta.");
    }
  });
}

module.exports = {
  bot,
  iniciar,
  configurarWebhook,
  webhookAutorizado,
  processarUpdate,
  enviarAlerta,
  registrarFonteDeDados,
  registrarPerfil,
  registrarLeituraViva,
};
