/**
 * Limitador simples: devolve uma funcao que diz se ja pode disparar de novo.
 * Usado pra nao encher o Telegram de alertas repetidos quando o app
 * envia leituras a cada poucos segundos.
 *
 * @param {number} intervaloMs - tempo minimo entre dois disparos
 * @param {() => number} agora - relogio (injetavel pra testes)
 */
function criarLimitador(intervaloMs, agora = Date.now) {
  let ultimo = null;
  return function podeDisparar() {
    const t = agora();
    if (ultimo === null || t - ultimo >= intervaloMs) {
      ultimo = t;
      return true;
    }
    return false;
  };
}

module.exports = { criarLimitador };
