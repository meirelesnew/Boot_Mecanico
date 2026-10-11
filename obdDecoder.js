/**
 * Decodifica a resposta bruta do comando "03" (codigos de falha armazenados)
 * de um adaptador ELM327 para uma lista de codigos DTC (ex: ["P0130"]).
 *
 * Formatos tratados:
 *  - KWP / ISO 9141 (sem contador): "43 01 30 00 00 00 00"  -> 7 bytes por quadro
 *  - CAN (com contador):            "43 01 01 30 00 00 00"  -> 8 bytes por quadro
 *  - Varios quadros seguidos (mais de 3 codigos) tambem sao suportados.
 *
 * Cada codigo ocupa 2 bytes (A e B):
 *  - 2 bits mais altos de A -> letra (P, C, B ou U)
 *  - proximos 2 bits de A   -> primeiro digito (0 a 3)
 *  - nibble baixo de A + byte B -> 3 digitos hexadecimais
 */

const LETRAS = ["P", "C", "B", "U"];

function bytesParaDTC(a, b) {
  const letra = LETRAS[(a >> 6) & 0x03];
  const digito1 = (a >> 4) & 0x03;
  const resto = (((a & 0x0f) << 8) | b).toString(16).toUpperCase().padStart(3, "0");
  return `${letra}${digito1}${resto}`;
}

/**
 * @param {string} bruto - texto devolvido pelo ELM327 (pode ter "SEARCHING...", quebras de linha, etc.)
 * @returns {{ codes: string[], valido: boolean }}
 */
function decodificarModo03(bruto) {
  if (typeof bruto !== "string") return { codes: [], valido: false };

  // Pega so tokens hexadecimais de 2 digitos (ignora "SEARCHING...", "OK", ">" etc.)
  const tokens = bruto
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => /^[0-9A-F]{2}$/.test(t));

  const inicio = tokens.indexOf("43");
  if (inicio === -1) return { codes: [], valido: false };

  const dados = tokens.slice(inicio);
  let quadros = [];

  if (dados.length % 8 === 0) {
    // CAN: 43 + contador + 6 bytes (3 codigos)
    for (let i = 0; i < dados.length; i += 8) {
      quadros.push(dados.slice(i + 2, i + 8));
    }
  } else if (dados.length % 7 === 0) {
    // KWP / ISO 9141: 43 + 6 bytes (3 codigos)
    for (let i = 0; i < dados.length; i += 7) {
      quadros.push(dados.slice(i + 1, i + 7));
    }
  } else {
    // Formato nao reconhecido: tenta ler tudo apos o primeiro 43 em pares
    quadros.push(dados.slice(1));
  }

  const codes = [];
  for (const quadro of quadros) {
    for (let i = 0; i + 1 < quadro.length; i += 2) {
      const a = parseInt(quadro[i], 16);
      const b = parseInt(quadro[i + 1], 16);
      if (a === 0 && b === 0) continue; // par vazio (preenchimento)
      const codigo = bytesParaDTC(a, b);
      if (!codes.includes(codigo)) codes.push(codigo);
    }
  }

  return { codes, valido: true };
}

module.exports = { decodificarModo03, bytesParaDTC };
