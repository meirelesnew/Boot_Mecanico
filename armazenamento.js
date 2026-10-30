/**
 * Acesso ao banco de dados (Supabase) pela API REST, usando so o fetch do Node.
 * Nao precisa instalar nenhuma biblioteca nova.
 *
 * Variaveis de ambiente:
 *   SUPABASE_URL         ex: https://abcdxyz.supabase.co
 *   SUPABASE_SECRET_KEY  chave SECRETA (sb_secret_...). Nunca a "publishable".
 *
 * Se as variaveis nao estiverem definidas, `ativo` fica false e o sistema
 * continua funcionando so com a memoria (como antes).
 */

/**
 * Aceita a URL do jeito que o painel do Supabase mostra e corrige enganos comuns:
 * barra no fim e "/rest/v1" colado no endereco (o codigo ja acrescenta esse caminho,
 * e duplicado o Supabase responde "PGRST125 Invalid path").
 */
function normalizarUrl(bruto) {
  const original = (bruto || "").trim();
  let url = original.replace(/\/+$/, "");
  url = url.replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");
  if (url !== original) {
    console.warn(`[banco] SUPABASE_URL tinha caminho/barra a mais; usando "${url}". Corrija a variavel para ficar so o endereco.`);
  }
  return url;
}

const URL_BASE = normalizarUrl(process.env.SUPABASE_URL);
const CHAVE = (process.env.SUPABASE_SECRET_KEY || "").trim();
const ativo = Boolean(URL_BASE && CHAVE);

if (ativo) {
  // Mostra so o endereco (nunca a chave) para ajudar a conferir a configuracao nos logs.
  console.log(`[banco] usando Supabase em ${URL_BASE}`);
}

function cabecalhos(extra = {}) {
  const h = { apikey: CHAVE, "Content-Type": "application/json", ...extra };
  // As chaves novas (sb_secret_...) vao SO no cabecalho "apikey": se forem repetidas
  // no Authorization, o Supabase tenta ler como JWT e recusa ("Invalid JWT").
  // Ja a chave antiga (service_role) e um JWT (comeca com "eyJ") e pode ir nos dois.
  if (CHAVE.startsWith("eyJ")) h.Authorization = `Bearer ${CHAVE}`;
  return h;
}

async function requisicao(metodo, caminho, { corpo, extraHeaders, timeoutMs = 6000 } = {}) {
  const controle = new AbortController();
  const temporizador = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resp = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
      method: metodo,
      headers: cabecalhos(extraHeaders),
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: controle.signal,
    });
    const texto = await resp.text();
    if (!resp.ok) {
      throw new Error(`Supabase respondeu ${resp.status}: ${texto.slice(0, 200)}`);
    }
    return texto ? JSON.parse(texto) : null;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Supabase nao respondeu a tempo");
    throw err;
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------- Estado geral (tabela kv) ----------

/** Guarda (ou atualiza) um valor. Nunca lanca erro: devolve true/false. */
async function salvar(chave, valor) {
  if (!ativo) return false;
  try {
    await requisicao("POST", "kv?on_conflict=key", {
      corpo: { key: chave, value: valor, updated_at: new Date().toISOString() },
      extraHeaders: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    return true;
  } catch (err) {
    console.error(`[banco] erro ao salvar "${chave}":`, err.message);
    return false;
  }
}

/** Le um valor guardado. Devolve null se nao existir ou se der erro. */
async function carregar(chave) {
  if (!ativo) return null;
  try {
    const linhas = await requisicao("GET", `kv?key=eq.${encodeURIComponent(chave)}&select=value`);
    return linhas && linhas.length ? linhas[0].value : null;
  } catch (err) {
    console.error(`[banco] erro ao carregar "${chave}":`, err.message);
    return null;
  }
}

// ---------- Combustivel (tabela abastecimentos) ----------

async function inserirAbastecimento(registro) {
  if (!ativo) throw new Error("banco nao configurado");
  const linhas = await requisicao("POST", "abastecimentos", {
    corpo: registro,
    extraHeaders: { Prefer: "return=representation" },
  });
  return linhas[0];
}

async function listarAbastecimentos(limite = 500) {
  if (!ativo) throw new Error("banco nao configurado");
  return (
    (await requisicao("GET", `abastecimentos?select=*&order=data.desc&limit=${Number(limite) || 500}`)) || []
  );
}

async function removerAbastecimento(id) {
  if (!ativo) throw new Error("banco nao configurado");
  const linhas = await requisicao("DELETE", `abastecimentos?id=eq.${Number(id)}`, {
    extraHeaders: { Prefer: "return=representation" },
  });
  return linhas && linhas[0];
}

// ---------- Diagnostico ----------

/** Acesso leve ao banco. Serve de teste e tambem conta como "atividade" no Supabase. */
async function testar() {
  if (!ativo) return { ok: false, ms: 0, erro: "nao configurado" };
  const inicio = Date.now();
  try {
    await requisicao("GET", "kv?select=key&limit=1", { timeoutMs: 5000 });
    return { ok: true, ms: Date.now() - inicio };
  } catch (err) {
    return { ok: false, ms: Date.now() - inicio, erro: err.message };
  }
}

module.exports = {
  ativo,
  salvar,
  carregar,
  inserirAbastecimento,
  listarAbastecimentos,
  removerAbastecimento,
  testar,
};
