/**
 * Interpretador de codigos DTC 100% gratuito, sem dependencia de API paga.
 * Usa uma tabela fixa com os codigos mais comuns.
 */

const TABELA_DTC = {
  P0300: { descricao: "Falha de ignição em cilindros aleatórios (perda de potência, motor trepidando)", urgency: "alto" },
  P0171: { descricao: "Mistura ar/combustível pobre (excesso de ar ou pouco combustível)", urgency: "medio" },
  P0172: { descricao: "Mistura ar/combustível rica (excesso de combustível)", urgency: "medio" },
  P0301: { descricao: "Falha de ignição no cilindro 1", urgency: "alto" },
  P0302: { descricao: "Falha de ignição no cilindro 2", urgency: "alto" },
  P0303: { descricao: "Falha de ignição no cilindro 3", urgency: "alto" },
  P0304: { descricao: "Falha de ignição no cilindro 4", urgency: "alto" },
  P0420: { descricao: "Eficiência do catalisador abaixo do esperado", urgency: "medio" },
  P0442: { descricao: "Pequeno vazamento no sistema de evaporação de combustível", urgency: "baixo" },
  P0455: { descricao: "Vazamento grande no sistema de evaporação (verificar tampa do tanque)", urgency: "baixo" },
  P0128: { descricao: "Termostato do motor não atinge temperatura adequada", urgency: "medio" },
  P0230: { descricao: "Falha no circuito da bomba de combustível", urgency: "alto" },
  P0016: { descricao: "Sincronismo entre virabrequim e comando de válvulas fora do padrão", urgency: "alto" },
  P0130: { descricao: "Falha no sensor de oxigênio (sonda lambda)", urgency: "medio", relacionadoO2: true },
  P0505: { descricao: "Falha no sistema de controle de marcha lenta", urgency: "medio" },
};

/**
 * Interpreta um conjunto de codigos DTC (ex: ["P0300", "P0171"])
 * consultando a tabela local. Retorna o mesmo formato que a versao com IA,
 * pra nao precisar mudar nada no server.js.
 *
 * @param {string[]} codes
 * @param {object} liveData - nao usado aqui, mantido por compatibilidade
 * @param {object} perfil - perfil do carro (ex: { temGNV: true }), opcional
 * @returns {Promise<{diagnosis: string, urgency: string}>}
 */
async function interpretDTC(codes, liveData = {}, perfil = {}) {
  if (!codes || codes.length === 0) {
    return { diagnosis: "Nenhum código de erro encontrado.", urgency: "ok" };
  }

  const encontrados = codes.map((code) => {
    const entrada = TABELA_DTC[code.toUpperCase()];
    if (entrada) {
      let texto = `${code}: ${entrada.descricao}`;
      if (entrada.relacionadoO2 && perfil.temGNV) {
        texto += " (⚠️ carro tem GNV — pode ser falso positivo, teste rodando só na gasolina antes de trocar peça)";
      }
      return texto;
    }
    return `${code}: código não catalogado ainda (verifique na tabela oficial OBD2)`;
  });

  // Urgencia geral = a mais alta entre os codigos encontrados
  const urgencias = codes.map((code) => TABELA_DTC[code.toUpperCase()]?.urgency || "desconhecido");
  const ordem = { alto: 3, medio: 2, baixo: 1, desconhecido: 0 };
  const urgenciaFinal = urgencias.reduce((max, atual) => (ordem[atual] > ordem[max] ? atual : max), "desconhecido");

  return {
    diagnosis: encontrados.join(" | "),
    urgency: urgenciaFinal,
  };
}

module.exports = { interpretDTC };
