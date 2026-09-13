/**
 * Cliente para a API da OpenRouter (compativel com o formato da OpenAI).
 * Usa o modelo "openrouter/free", que roteia automaticamente para
 * algum modelo gratuito disponivel no momento.
 *
 * Documentacao: https://openrouter.ai/docs
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

const IA_ATIVADA = Boolean(OPENROUTER_API_KEY);

if (!IA_ATIVADA) {
  console.warn(
    "OPENROUTER_API_KEY nao configurada - perguntas livres no Telegram ficarao desativadas (so /ultimo e alertas vao funcionar)."
  );
}

/**
 * Envia uma pergunta pro modelo gratuito da OpenRouter e retorna o texto da resposta.
 * Retorna null se a IA nao estiver configurada ou se algo der errado.
 *
 * @param {string} systemPrompt - instrucoes de contexto/persona
 * @param {string} userMessage - pergunta do usuario
 * @returns {Promise<string|null>}
 */
async function perguntarIA(systemPrompt, userMessage) {
  if (!IA_ATIVADA) return null;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      console.error("OpenRouter respondeu com erro:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("Erro ao chamar a OpenRouter:", err.message);
    return null;
  }
}

module.exports = { perguntarIA, IA_ATIVADA };
