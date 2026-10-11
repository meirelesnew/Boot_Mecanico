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


/**
 * Decodifica dados ao vivo (modo 01) do ELM327.
 * O app envia as respostas separadas por "|", por exemplo:
 *   "SEARCHING... 41 0C 0B B8|41 05 84|41 0D 00"
 *
 *  - 010C (RPM):          41 0C A B -> (A*256 + B) / 4
 *  - 0105 (temp. motor):  41 05 A   -> A - 40  (graus C)
 *  - 010D (velocidade):   41 0D A   -> A  (km/h)
 *
 * Campos que nao vieram (NO DATA, erro, etc.) ficam null.
 */
const PIDS_VIVOS = {
  "0C": { campo: "rpm", bytes: 2, calc: (a, b) => (a * 256 + b) / 4 },
  "05": { campo: "coolantTemp", bytes: 1, calc: (a) => a - 40 },
  "0D": { campo: "speed", bytes: 1, calc: (a) => a },
};

function decodificarDadosVivos(bruto) {
  const resultado = { rpm: null, coolantTemp: null, speed: null };
  if (typeof bruto !== "string") return resultado;

  for (const trecho of bruto.split("|")) {
    const tokens = trecho
      .toUpperCase()
      .split(/\s+/)
      .filter((t) => /^[0-9A-F]{2}$/.test(t));

    for (let i = 0; i < tokens.length - 1; i++) {
      const pid = PIDS_VIVOS[tokens[i + 1]];
      if (tokens[i] !== "41" || !pid) continue;

      const dados = tokens.slice(i + 2, i + 2 + pid.bytes).map((t) => parseInt(t, 16));
      if (dados.length < pid.bytes) continue;

      resultado[pid.campo] = pid.calc(...dados);
      break; // usa so a primeira resposta valida de cada trecho
    }
  }
  return resultado;
}

module.exports = { decodificarModo03, bytesParaDTC, decodificarDadosVivos };
