/**
 * Monta o texto do comando /ultimo do Telegram.
 *
 * Deixa claro de onde vem cada informacao:
 *  - "KM atual": vem do perfil (comando /km), sempre o valor mais recente
 *  - "KM na leitura": o KM que estava no perfil NO MOMENTO em que o scanner leu
 *    (so aparece se existia na hora)
 *  - "Lido em": data e hora da leitura
 *
 * @param {object} registro - ultimo registro de diagnostico
 * @param {object} perfil - perfil do carro ({ kmAtual, ... })
 * @param {string} fuso - fuso horario para exibir a data
 */
function montarTextoUltimo(registro, perfil = {}, fuso = "America/Sao_Paulo") {
  const fmtKm = (km) => `${Number(km).toLocaleString("pt-BR")} km`;

  const linhas = [`🚗 *Último diagnóstico:*`];

  if (registro.timestamp) {
    const quando = new Date(registro.timestamp).toLocaleString("pt-BR", {
      timeZone: fuso,
      dateStyle: "short",
      timeStyle: "short",
    });
    linhas.push(`*Lido em:* ${quando}`);
  }

  linhas.push(`*Códigos:* ${registro.codes.length ? registro.codes.join(", ") : "nenhum"}`);
  linhas.push(
    `*KM atual:* ${perfil.kmAtual ? fmtKm(perfil.kmAtual) : "não informado (use /km 123456)"}`
  );
  if (registro.km) {
    linhas.push(`*KM na leitura:* ${fmtKm(registro.km)}`);
  }
  linhas.push(`*Diagnóstico:* ${registro.resultado.diagnosis}`);
  linhas.push(`*Urgência:* ${registro.resultado.urgency}`);

  return linhas.join("\n");
}

module.exports = { montarTextoUltimo };
