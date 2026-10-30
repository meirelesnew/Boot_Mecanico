/**
 * Controle de combustivel: interpreta o comando /abastecer, calcula os
 * resumos (gasto do mes, custo por km, consumo) e monta os textos.
 *
 * Tudo aqui e "puro" (nao acessa banco nem Telegram), entao e facil de testar.
 *
 * Limite honesto: o OBD2 nao mede o gasto de GNV (a central do carro so conhece
 * a injecao original). Por isso o controle e feito pelos abastecimentos que
 * voce registra, nao por leitura do carro.
 */

const FUSO = "America/Sao_Paulo";

const TIPOS = { gasolina: "gasolina", etanol: "etanol", alcool: "etanol", gnv: "gnv" };

const AJUDA_ABASTECER =
  "Use: `/abastecer <combustível> <quantidade> <preço> [km123456] [parcial]`\n\n" +
  "Exemplos:\n" +
  "`/abastecer gasolina 32,5 6,29`\n" +
  "`/abastecer gnv 12 4,89 km281900`\n" +
  "`/abastecer etanol 20 4,19 parcial`\n\n" +
  "Combustíveis: gasolina, etanol ou gnv. Quantidade em litros (m³ no GNV). " +
  "Se não informar o km, uso o KM atual do perfil. Use `parcial` se não encheu o tanque.";

const unidade = (tipo) => (tipo === "gnv" ? "m³" : "L");
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v, casas = 2) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas });

function semAcento(texto) {
  return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** "6,29" -> 6.29 | "6.29" -> 6.29 | "1.234,56" -> 1234.56 | invalido -> NaN */
function lerNumero(texto) {
  let s = String(texto).trim().replace(/^r\$/i, "");
  if (!/^[\d.,]+$/.test(s)) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** "281900" ou "281.900" -> 281900 */
function lerKm(texto) {
  const n = Number(String(texto).replace(/[.,]/g, ""));
  return Number.isInteger(n) && n >= 1000 && n <= 2000000 ? n : NaN;
}

/**
 * Interpreta o texto que vem depois de "/abastecer".
 * @returns {{ok: true, valor: object} | {ok: false, erro: string}}
 */
function interpretarAbastecimento(texto) {
  const partes = String(texto || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length < 3) {
    return { ok: false, erro: "Faltam informações (combustível, quantidade e preço)." };
  }

  const tipo = TIPOS[semAcento(partes[0]).toLowerCase()];
  if (!tipo) {
    return { ok: false, erro: `Não conheço o combustível "${partes[0]}". Use gasolina, etanol ou gnv.` };
  }

  const quantidade = lerNumero(partes[1]);
  if (!(quantidade >= 0.1 && quantidade <= 300)) {
    return { ok: false, erro: `Quantidade inválida: "${partes[1]}".` };
  }

  const preco = lerNumero(partes[2]);
  if (!(preco >= 0.5 && preco <= 50)) {
    return { ok: false, erro: `Preço inválido: "${partes[2]}". Informe o preço por litro (ou por m³).` };
  }

  let km = null;
  let cheio = true;

  for (let i = 3; i < partes.length; i++) {
    const t = partes[i].toLowerCase();
    let m;
    if (t === "parcial") {
      cheio = false;
    } else if (t === "cheio") {
      cheio = true;
    } else if ((m = t.match(/^km[:=]?(\d[\d.,]*)?$/))) {
      const valor = m[1] ? lerKm(m[1]) : lerKm(partes[++i] || "");
      if (Number.isNaN(valor)) return { ok: false, erro: "KM inválido. Exemplo: km281900." };
      km = valor;
    } else {
      return { ok: false, erro: `Não entendi "${partes[i]}".` };
    }
  }

  return {
    ok: true,
    valor: {
      tipo,
      quantidade,
      preco_unitario: preco,
      total: Math.round((quantidade * preco + Number.EPSILON) * 100) / 100,
      km,
      cheio,
    },
  };
}

/** Normaliza uma linha vinda do banco. */
function normalizar(linha) {
  return {
    ...linha,
    quantidade: Number(linha.quantidade),
    preco_unitario: Number(linha.preco_unitario),
    total: Number(linha.total),
    km: linha.km === null || linha.km === undefined ? null : Number(linha.km),
    data: new Date(linha.data),
  };
}

const mesDe = (data) => data.toLocaleDateString("en-CA", { timeZone: FUSO }).slice(0, 7); // "2026-10"

/**
 * Calcula os resumos a partir da lista de abastecimentos.
 * @param {object[]} lista - linhas da tabela abastecimentos (qualquer ordem)
 * @param {Date} agora - data de referencia (para testes)
 */
function calcularResumo(lista, agora = new Date()) {
  const itens = (lista || []).map(normalizar).sort((a, b) => a.data - b.data);

  // Mes atual
  const mesAtual = mesDe(agora);
  const doMes = itens.filter((i) => mesDe(i.data) === mesAtual);
  const porTipoMes = {};
  for (const i of doMes) {
    const t = (porTipoMes[i.tipo] ||= { quantidade: 0, total: 0 });
    t.quantidade += i.quantidade;
    t.total += i.total;
  }

  // Custo por km: gasto dos abastecimentos depois do primeiro / km rodados no periodo
  const comKm = itens.filter((i) => i.km !== null);
  let custoPorKm = null;
  if (comKm.length >= 2) {
    const distancia = comKm[comKm.length - 1].km - comKm[0].km;
    if (distancia > 0) {
      const gasto = comKm.slice(1).reduce((soma, i) => soma + i.total, 0);
      custoPorKm = { valor: gasto / distancia, distancia, abastecimentos: comKm.length };
    }
  }

  // Consumo: so entre dois abastecimentos SEGUIDOS, do mesmo combustivel, ambos com tanque cheio
  const acumulado = {};
  for (let i = 1; i < comKm.length; i++) {
    const anterior = comKm[i - 1];
    const atual = comKm[i];
    if (atual.tipo === anterior.tipo && atual.cheio && anterior.cheio && atual.km > anterior.km) {
      const a = (acumulado[atual.tipo] ||= { distancia: 0, quantidade: 0, amostras: 0 });
      a.distancia += atual.km - anterior.km;
      a.quantidade += atual.quantidade;
      a.amostras += 1;
    }
  }
  const consumo = {};
  for (const [tipo, a] of Object.entries(acumulado)) {
    consumo[tipo] = { kmPorUnidade: a.distancia / a.quantidade, amostras: a.amostras };
  }

  return {
    mes: { rotulo: mesAtual, total: doMes.reduce((s, i) => s + i.total, 0), quantidade: doMes.length, porTipo: porTipoMes },
    geral: { total: itens.reduce((s, i) => s + i.total, 0), quantidade: itens.length },
    custoPorKm,
    consumo,
    ultimos: [...itens].reverse().slice(0, 5),
  };
}

function textoLinhaAbastecimento(i) {
  const dia = i.data.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" });
  const km = i.km !== null ? ` (km ${num(i.km, 0)})` : "";
  return `• ${dia}: ${i.tipo} ${num(i.quantidade)} ${unidade(i.tipo)} × ${brl(i.preco_unitario)} = ${brl(i.total)}${km}`;
}

function formatarResumo(r) {
  if (r.geral.quantidade === 0) {
    return "⛽ Nenhum abastecimento registrado ainda.\n\n" + AJUDA_ABASTECER;
  }

  const [ano, mes] = r.mes.rotulo.split("-");
  const linhas = ["⛽ *Combustível*", ""];

  linhas.push(`*Mês atual (${mes}/${ano}):* ${brl(r.mes.total)} em ${r.mes.quantidade} abastecimento(s)`);
  for (const [tipo, t] of Object.entries(r.mes.porTipo)) {
    linhas.push(`  • ${tipo}: ${num(t.quantidade)} ${unidade(tipo)} — ${brl(t.total)}`);
  }
  linhas.push(`*Total registrado:* ${brl(r.geral.total)} em ${r.geral.quantidade} abastecimento(s)`);

  if (r.custoPorKm) {
    linhas.push(
      `*Custo por km (estimado):* ${brl(r.custoPorKm.valor)}/km, em ${num(r.custoPorKm.distancia, 0)} km`
    );
  }

  const tiposComConsumo = Object.entries(r.consumo);
  if (tiposComConsumo.length) {
    linhas.push("*Consumo médio:*");
    for (const [tipo, c] of tiposComConsumo) {
      linhas.push(`  • ${tipo}: ${num(c.kmPorUnidade)} km/${unidade(tipo)} (${c.amostras} medição/ões)`);
    }
  }

  linhas.push("", "*Últimos abastecimentos:*", ...r.ultimos.map(textoLinhaAbastecimento));
  return linhas.join("\n");
}

function textoAbastecimentoSalvo(registro, usouKmDoPerfil) {
  const r = normalizar(registro);
  const linhas = [
    "⛽ *Abastecimento salvo!*",
    `*Combustível:* ${r.tipo}`,
    `*Quantidade:* ${num(r.quantidade)} ${unidade(r.tipo)}`,
    `*Preço:* ${brl(r.preco_unitario)}/${unidade(r.tipo)}`,
    `*Total:* ${brl(r.total)}`,
    `*KM:* ${r.km !== null ? num(r.km, 0) + " km" : "não informado"}${usouKmDoPerfil ? " (usei o KM atual do perfil)" : ""}`,
    `*Tanque:* ${r.cheio ? "cheio" : "parcial"}`,
  ];
  return linhas.join("\n");
}

module.exports = {
  AJUDA_ABASTECER,
  interpretarAbastecimento,
  calcularResumo,
  formatarResumo,
  textoAbastecimentoSalvo,
  textoLinhaAbastecimento,
  lerNumero,
};
