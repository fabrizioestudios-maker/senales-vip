// TRADING INSTITUCIONAL | Panel de ajustes del bot (Telegram)
// Cambia las variables de entorno en caliente (process.env) y las guarda.
// Persistencia: archivo (si hay volumen en /data queda permanente) + respaldo en un mensaje fijado en tu chat con el bot.
const fs = require("fs");
const path = require("path");

const SI = ["1", "true", "si", "sí", "on"];
const MARCA = "TI_PANEL ";
const RUTA =
  process.env.PANEL_ARCHIVO || (fs.existsSync("/data") ? "/data/panel.json" : path.join(__dirname, "panel.json"));

const GRUPOS = [
  { n: "Envío y destinos", d: "Qué se publica solo y adónde sale. Para apagar un destino, dejalo vacío con '-'." },
  { n: "Seguridad", d: "Controles que descartan señales con datos raros." },
  { n: "Datos de mercado", d: "Velas de Twelve Data. El instrumento cambia símbolo, mintick y decimales juntos (US100 usa el índice NDX, que Twelve Data da solo en planes pagos). Cambiar intervalo o frecuencia reinicia el ciclo." },
  { n: "Motor V.2", d: "Señales automáticas por velas. Tiene que coincidir con los settings del Pine de Bias Toolkit V.2." },
  { n: "V.3 Estructura", d: "Botón Analizar entradas: estructura y timeframe superior." },
  { n: "V.3 Entrada y salida", d: "Botón Analizar entradas: dónde entra, SL y TP del plan." },
  { n: "V.3 Liquidez y filtros", d: "Botón Analizar entradas: liquidez (LQ) y filtros que habilitan la entrada." },
  { n: "Capturas (Gemini)", d: "Modelos que leen las capturas de TradingView. Si Google da de baja un modelo, corregí el nombre acá." },
];

// Instrumentos: cambian símbolo de datos, etiqueta, mintick y decimales juntos.
const PRESETS = {
  XAUUSD: { TV_SYMBOL: "XAU/USD", INSTRUMENTO_DEFECTO: "XAUUSD", TV_MINTICK: "0.01", TV_DECIMALES: "2" },
  EURUSD: { TV_SYMBOL: "EUR/USD", INSTRUMENTO_DEFECTO: "EURUSD", TV_MINTICK: "0.00001", TV_DECIMALES: "5" },
  US100: { TV_SYMBOL: "NDX", INSTRUMENTO_DEFECTO: "US100", TV_MINTICK: "0.01", TV_DECIMALES: "2" },
};

// Activos del botón "Analizar": símbolo de Twelve Data y decimales. Solo afectan al análisis, no a las señales automáticas.
const ACTIVOS = {
  XAUUSD: { simbolo: "XAU/USD", decimales: 2 },
  BTCUSD: { simbolo: "BTC/USD", decimales: 2 },
  EURUSD: { simbolo: "EUR/USD", decimales: 5 },
  GBPUSD: { simbolo: "GBP/USD", decimales: 5 },
  USDJPY: { simbolo: "USD/JPY", decimales: 3 },
  ETHUSD: { simbolo: "ETH/USD", decimales: 2 },
};

const B = (g, k, n, def, pos) => ({ g, k, n, t: "bool", def, pos });
const E = (g, k, n, def, op) => ({ g, k, n, t: "enum", def, op });
const N = (g, k, n, def, paso, min, max) => ({ g, k, n, t: "num", def, paso, min, max });
const T = (g, k, n, def = "") => ({ g, k, n, t: "txt", def });

const PARAMS = [
  // 0 Envío y destinos
  B(0, "AUTO_TV", "Auto-publicar", "0", true),
  E(0, "ESTADO_TV", "Estado auto", "mercado", ["mercado", "LIMIT PENDIENTE", "STOP"]),
  E(0, "MODO", "Manuales", "auto", ["auto", "confirmar"]),
  B(0, "AVISO_SENAL", "Aviso sin precios", "1", false),
  T(0, "VIP_WHATSAPP_CHAT_ID", "WA VIP"),
  T(0, "WA_AVISOS_CHAT_ID", "WA Avisos"),
  T(0, "TELEGRAM_VIP_CHAT_ID", "TG VIP"),
  // 1 Seguridad
  N(1, "MAX_DIST_PCT", "Dist. SL/TP %", 3, 0.5, 0.1, 50),
  N(1, "MAX_DIST_PRECIO_PCT", "Dist. precio % (0=off)", 2, 0.5, 0, 50),
  N(1, "TV_MAX_EDAD_MIN", "Edad máx. min", 20, 5, 1, 240),
  // 2 Datos de mercado
  E(2, "TV_INTERVAL", "Intervalo", "1min", ["1min", "5min", "15min", "30min", "1h"]),
  N(2, "TV_POLL_SEG", "Consulta cada (s)", 180, 30, 10, 3600),
  N(2, "TV_VELAS", "Velas", 1500, 250, 300, 5000),
  N(2, "TV_DECIMALES", "Decimales cálculo", 2, 1, 0, 6),
  E(2, "DECIMALES", "Decimales texto", "auto", ["auto", "1", "2", "3", "4", "5"]),
  N(2, "TV_MINTICK", "Mintick", 0.01, 0, 0.00001, 10),
  // 3 Motor V.2
  N(3, "SWING_LEN", "Swing pivot", 12, 1, 2, 200),
  N(3, "INTERNAL_LEN", "Internal pivot", 4, 1, 2, 50),
  E(3, "BREAK_SOURCE", "Ruptura", "Close", ["Close", "Wick"]),
  N(3, "ZONA_1", "Zona 1", 0.618, 0.01, 0.1, 1),
  N(3, "ZONA_2", "Zona 2", 0.7, 0.01, 0.1, 1),
  N(3, "SOLAPE_PCT", "Solape mín. %", 50, 5, 1, 100),
  N(3, "SL_BUFFER", "SL buffer", 0, 0.5, 0, 100),
  N(3, "TP1_R", "TP1 (R)", 1, 0.5, 0.1, 20),
  N(3, "TP2_R", "TP2 (R)", 2, 0.5, 0.1, 20),
  N(3, "TP3_R", "TP3 (R)", 3, 0.5, 0.1, 20),
  E(3, "TV_ENTRY", "Entrada", "nivel", ["nivel", "close"]),
  // 4 V.3 Estructura
  N(4, "V3_SWING", "Swing pivot", 50, 5, 3, 500),
  N(4, "V3_INTERNAL", "Internal pivot", 5, 1, 2, 100),
  E(4, "V3_RANGO", "Rango del plan", "swing", ["swing", "internal"]),
  E(4, "V3_HTF", "Timeframe superior", "15min", ["5min", "15min", "30min", "1h"]),
  E(4, "V3_HTF_ESTRUCTURA", "Estructura HTF", "internal", ["internal", "swing"]),
  // 5 V.3 Entrada y salida
  E(5, "V3_ENTRADA", "Entrada en", "lq", ["lq", "fib"]),
  N(5, "V3_ENTRY_RATIO", "Fib entrada", 0.7, 0.01, 0.1, 1),
  N(5, "V3_FIB2", "Fib zona", 0.618, 0.01, 0.1, 1),
  E(5, "V3_TP", "TP en", "equilibrium", ["equilibrium", "objetivo"]),
  N(5, "V3_SL_BUFFER", "SL buffer", 0, 0.5, 0, 100),
  // 6 V.3 Liquidez y filtros
  N(6, "V3_LQ_MAX", "LQ máximas", 10, 1, 1, 50),
  N(6, "V3_LQ_VENTANA", "Ventana LQ (velas)", 30, 5, 1, 500),
  E(6, "V3_LQ_SWEEP", "Barrido LQ", "mecha", ["mecha", "cierre"]),
  B(6, "V3_F_ALINEACION", "Filtro alineación", "1", false),
  B(6, "V3_F_HTF", "Filtro HTF", "1", false),
  B(6, "V3_F_ZONA", "Filtro zona", "1", false),
  // Agregados después (van al final para no mover los botones de paneles ya abiertos)
  { ...E(2, "INSTRUMENTO_DEFECTO", "Instrumento", "XAUUSD", Object.keys(PRESETS)), preset: PRESETS, top: true },
  T(2, "TV_SYMBOL", "Símbolo datos", "XAU/USD"),
  T(7, "GEMINI_MODEL", "Modelo 1", "gemini-3.8-flash"),
  T(7, "GEMINI_MODEL_2", "Modelo 2", "gemini-3.6-flash"),
  E(2, "ACTIVO_ANALISIS", "Activo del análisis", "XAUUSD", Object.keys(ACTIVOS)),
];

const base = {}; // valores originales (Railway) para poder restablecer
let cfg = {}; // ajustes cambiados desde el panel
let tg = null;
let owner = () => "";
let alCambiar = () => {};
let esperando = null;
let fijadoId = null;

// ---------- lectura de valores ----------
const P = (k) => PARAMS.find((p) => p.k === k);
const crudo = (p) => {
  const v = process.env[p.k];
  return v === undefined || v === "" ? undefined : v;
};
const redondear = (x) => Number(Number(x).toFixed(6));

function activo(p) {
  const v = process.env[p.k] === undefined ? p.def : process.env[p.k];
  return p.pos ? SI.includes(String(v).toLowerCase()) : String(v).toLowerCase() !== "0";
}

function idxEnum(p) {
  const v = String(crudo(p) ?? p.def).toLowerCase();
  return p.op.findIndex((o) => o.toLowerCase() === v);
}

function numero(p) {
  const v = crudo(p);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : p.def;
}

function ver(p) {
  if (p.t === "bool") return activo(p) ? "SÍ" : "NO";
  if (p.t === "enum") {
    const j = idxEnum(p);
    return j >= 0 ? p.op[j] : String(crudo(p));
  }
  if (p.t === "num") return String(redondear(numero(p)));
  const v = process.env[p.k] || p.def;
  if (!v) return "apagado";
  return v.length > 22 ? v.slice(0, 10) + "…" + v.slice(-8) : v;
}

function defecto(p) {
  const b = base[p.k];
  if (b !== undefined && b !== "") return b;
  if (p.t === "bool") return p.def === "1" ? "SÍ" : "NO";
  return p.t === "txt" ? p.def || "vacío" : String(p.def);
}

// ---------- cambios ----------
function fijar(i, valor) {
  const p = PARAMS[i];
  cfg[p.k] = String(valor);
  process.env[p.k] = String(valor);
  guardar();
  alCambiar(p.k);
}

function restablecer(i) {
  const p = PARAMS[i];
  const claves = p.preset ? Object.keys(Object.values(p.preset)[0]) : [p.k];

  for (const k of claves) {
    delete cfg[k];
    if (base[k] === undefined) delete process.env[k];
    else process.env[k] = base[k];
  }

  guardar();
  alCambiar(claves.includes("TV_SYMBOL") ? "TV_SYMBOL" : p.k);
}

function fijarPreset(p, nombre) {
  for (const [k, v] of Object.entries(p.preset[nombre])) {
    cfg[k] = v;
    process.env[k] = v;
  }

  guardar();
  alCambiar("TV_SYMBOL");
}

// ---------- persistencia ----------
async function leerFijado() {
  const c = await tg("getChat", { chat_id: owner() });
  const m = c && c.pinned_message;
  if (m && typeof m.text === "string" && m.text.startsWith(MARCA)) {
    fijadoId = m.message_id;
    return JSON.parse(m.text.slice(MARCA.length));
  }
  return null;
}

async function guardarFijado() {
  const texto = MARCA + JSON.stringify(cfg);

  if (fijadoId) {
    try {
      await tg("editMessageText", { chat_id: owner(), message_id: fijadoId, text: texto });
      return;
    } catch (e) {
      if (/not modified/i.test(e.message)) return;
      fijadoId = null;
    }
  }

  const m = await tg("sendMessage", { chat_id: owner(), text: texto, disable_notification: true });
  fijadoId = m.message_id;
  await tg("pinChatMessage", { chat_id: owner(), message_id: m.message_id, disable_notification: true });
}

let cola = Promise.resolve();

function guardar() {
  cola = cola.then(async () => {
    try {
      fs.writeFileSync(RUTA, JSON.stringify(cfg, null, 1));
    } catch (e) {
      console.error("Panel (archivo):", e.message);
    }

    try {
      await guardarFijado();
    } catch (e) {
      console.error("Panel (respaldo):", e.message);
    }
  });
}

async function iniciar(opc) {
  tg = opc.tg;
  owner = opc.owner;
  alCambiar = opc.alCambiar || (() => {});

  for (const p of PARAMS) base[p.k] = process.env[p.k];

  let datos = null;

  try {
    datos = JSON.parse(fs.readFileSync(RUTA, "utf8"));
  } catch {}

  let fijado = null;

  try {
    fijado = await leerFijado();
  } catch (e) {
    console.error("Panel (lectura del respaldo):", e.message);
  }

  if (!datos) datos = fijado;

  if (datos && typeof datos === "object") {
    for (const p of PARAMS) {
      if (typeof datos[p.k] === "string") {
        cfg[p.k] = datos[p.k];
        process.env[p.k] = datos[p.k];
      }
    }
  }

  console.log(`Panel: ${Object.keys(cfg).length} ajustes cargados`);
}

// ---------- pantallas ----------
async function pintar(chat, mid, texto, filas) {
  const cuerpo = { chat_id: chat, text: texto, reply_markup: { inline_keyboard: filas } };

  if (mid) {
    try {
      await tg("editMessageText", { ...cuerpo, message_id: mid });
      return mid;
    } catch (e) {
      if (/not modified/i.test(e.message)) return mid;
    }
  }

  const m = await tg("sendMessage", cuerpo);
  return m.message_id;
}

function principal(chat, mid) {
  const filas = [];

  for (let g = 0; g < GRUPOS.length; g += 2) {
    filas.push(GRUPOS.slice(g, g + 2).map((x, o) => ({ text: x.n, callback_data: `p:g:${g + o}` })));
  }

  filas.push([{ text: "Analizar entradas", callback_data: "analizar" }]);
  filas.push([{ text: "Cerrar", callback_data: "p:x" }]);

  const texto =
    `Ajustes del bot\n\n` +
    `Auto-publicar: ${ver(P("AUTO_TV"))} · Manuales: ${ver(P("MODO"))} · Intervalo: ${ver(P("TV_INTERVAL"))}\n\n` +
    `Los cambios se guardan y se aplican en la próxima consulta.`;

  return pintar(chat, mid, texto, filas);
}

function grupo(chat, mid, g, nota) {
  const filas = [];

  const orden = PARAMS.map((p, i) => i).sort((a, b) => Number(!!PARAMS[b].top) - Number(!!PARAMS[a].top) || a - b);

  orden.forEach((i) => {
    const p = PARAMS[i];
    if (p.g !== g) return;

    const etiqueta = { text: `${p.n}: ${ver(p)}`, callback_data: `p:${p.t === "num" || p.t === "txt" ? "e" : "t"}:${i}` };

    if (p.t === "num" && p.paso) {
      filas.push([{ text: "-", callback_data: `p:d:${i}` }, etiqueta, { text: "+", callback_data: `p:u:${i}` }]);
    } else {
      filas.push([etiqueta]);
    }
  });

  filas.push([
    { text: "Restablecer sección", callback_data: `p:R:${g}` },
    { text: "Volver", callback_data: "p:m" },
  ]);

  return pintar(chat, mid, `${GRUPOS[g].n}\n${GRUPOS[g].d}${nota ? "\n\n" + nota : ""}`, filas);
}

function pedirValor(chat, mid, i) {
  const p = PARAMS[i];

  const rango =
    p.t === "num"
      ? `Escribí un número entre ${p.min} y ${p.max}.`
      : "Escribí el valor nuevo. Con '-' queda vacío (apagado).";

  const texto = `${p.n} (${p.k})\nActual: ${ver(p)}\nPor defecto: ${defecto(p)}\n\n${rango}`;

  return pintar(chat, mid, texto, [
    [{ text: "Volver al valor por defecto", callback_data: `p:z:${i}` }],
    [{ text: "Cancelar", callback_data: `p:g:${p.g}` }],
  ]);
}

// ---------- entradas ----------
async function abrir(chat) {
  esperando = null;
  await principal(chat, null);
}

async function alBoton(cb) {
  const [, acc, arg] = String(cb.data).split(":");
  const chat = cb.message.chat.id;
  const mid = cb.message.message_id;
  const i = Number(arg);
  const p = PARAMS[i];
  let aviso = "";

  try {
    if (acc === "m") {
      esperando = null;
      await principal(chat, mid);
    } else if (acc === "g" && GRUPOS[i]) {
      esperando = null;
      await grupo(chat, mid, i);
    } else if (acc === "x") {
      esperando = null;
      await tg("deleteMessage", { chat_id: chat, message_id: mid }).catch(() => {});
    } else if (acc === "t" && p) {
      if (p.t === "bool") fijar(i, activo(p) ? "0" : "1");
      else if (p.preset) fijarPreset(p, p.op[(idxEnum(p) + 1) % p.op.length]);
      else fijar(i, p.op[(idxEnum(p) + 1) % p.op.length]);
      aviso = `${p.n}: ${ver(p)}`;
      await grupo(chat, mid, p.g);
    } else if ((acc === "d" || acc === "u") && p) {
      const actual = numero(p);
      const nuevo = Math.min(p.max, Math.max(p.min, redondear(actual + (acc === "u" ? p.paso : -p.paso))));

      if (nuevo === actual) {
        aviso = acc === "u" ? "Ya está en el máximo" : "Ya está en el mínimo";
      } else {
        fijar(i, nuevo);
        aviso = `${p.n}: ${ver(p)}`;
        await grupo(chat, mid, p.g);
      }
    } else if (acc === "e" && p) {
      esperando = { i, chat, mid, t: Date.now() };
      await pedirValor(chat, mid, i);
    } else if (acc === "z" && p) {
      esperando = null;
      restablecer(i);
      aviso = `${p.n}: ${ver(p)}`;
      await grupo(chat, mid, p.g);
    } else if (acc === "R" && GRUPOS[i]) {
      await pintar(chat, mid, `¿Restablecer "${GRUPOS[i].n}" a los valores por defecto (los de Railway, o los del código si no hay)?`, [
        [
          { text: "Sí, restablecer", callback_data: `p:Q:${i}` },
          { text: "Cancelar", callback_data: `p:g:${i}` },
        ],
      ]);
    } else if (acc === "Q" && GRUPOS[i]) {
      PARAMS.forEach((q, k) => {
        if (q.g === i && q.k in cfg) restablecer(k);
      });
      aviso = "Sección restablecida";
      await grupo(chat, mid, i);
    }
  } catch (e) {
    aviso = `Error: ${e.message}`.slice(0, 190);
  }

  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: aviso }).catch(() => {});
}

// Devuelve true si el mensaje era la respuesta a un pedido de valor.
async function alTexto(m, texto) {
  if (!esperando) return false;

  if (Date.now() - esperando.t > 300000 || texto.startsWith("/")) {
    esperando = null;
    return false;
  }

  const { i, chat, mid } = esperando;
  const p = PARAMS[i];
  const entrada = texto.trim();

  if (/^(def|reset|defecto)$/i.test(entrada)) {
    restablecer(i);
  } else if (p.t === "num") {
    const n = Number(entrada.replace(",", "."));

    if (!entrada || !Number.isFinite(n) || n < p.min || n > p.max) {
      await tg("sendMessage", { chat_id: chat, text: `Valor inválido. Tiene que ser un número entre ${p.min} y ${p.max}. Probá de nuevo o tocá Cancelar.` });
      return true;
    }

    fijar(i, redondear(n));
  } else {
    fijar(i, entrada === "-" ? "" : entrada);
  }

  esperando = null;

  // Borra tu mensaje para que el chat quede limpio (si Telegram no deja, no pasa nada).
  await tg("deleteMessage", { chat_id: chat, message_id: m.message_id }).catch(() => {});
  await grupo(chat, mid, p.g, `Actualizado: ${p.n} = ${ver(p)}`);

  return true;
}

function fijarValor(k, valor) {
  const i = PARAMS.findIndex((p) => p.k === k);
  if (i >= 0) fijar(i, valor);
}

module.exports = { iniciar, abrir, alBoton, alTexto, fijarValor, ACTIVOS };
