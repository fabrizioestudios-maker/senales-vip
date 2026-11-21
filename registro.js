// TRADING INSTITUCIONAL | Registro y seguimiento de señales
// Anota cada señal publicada en la pestaña "Señales" de tu Google Sheet (vía Apps Script)
// y sigue el precio con velas de 1 minuto hasta TP1 o SL.
// Se activa solo si están cargadas SHEETS_URL y SHEETS_KEY en Railway; si no, no hace nada.
//
// Reglas de resultado (aprobadas):
// a) R oficial en TP1: +R de TP1 o -1R en SL. TP2/TP3 se anotan como "TP máx", sin cambiar el R.
// b) Si una misma vela toca SL y TP1, cuenta SL.
// c) LIMIT/STOP sin activarse en 24 h: Expirada. Si toca TP1 antes de activarse: Cancelada.
// d) Activa sin TP1 ni SL a las 72 h: Sin resolver (revisión manual).
// e) ESTADO ACTIVA: activada en la entrada, en el momento de publicarse.

const MIN = 60000;
const H24 = 24 * 60 * MIN;
const H72 = 72 * 60 * MIN;
const GRACIA = 30 * MIN; // margen antes de vencer plazos por reloj (datos demorados)
const CADA_BINGX = 5 * MIN;
const CADA_TD = 10 * MIN; // Twelve Data: como mucho 1 consulta cada 10 min entre todos los instrumentos
const REINTENTOS = [2000, 5000, 15000];

const ESTADO = {
  PEND: "Pendiente",
  ACT: "Activa",
  SIG: "Siguiendo TP2/TP3",
  CERR: "Cerrada",
  MANUAL: "Manual",
  PRUEBA: "Prueba",
};

let deps = {
  enviar: async () => {},
  owner: () => "",
  fuente: () => null,
  mercadoAbierto: () => true,
};

const abiertas = new Map(); // id -> señal en seguimiento
const ultimaRevision = new Map(); // clave de instrumento -> ms
let ultimaTD = 0;
let timer = null;
let revisando = false;
const avisados = new Set();

const activo = () => Boolean(process.env.SHEETS_URL && process.env.SHEETS_KEY);

// ---------- utilidades ----------
const fecha = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "");
const red = (x, d = 2) => Number(Number(x).toFixed(d));

// Mismo instrumento con distintos nombres: BTCUSDT.P / BTCUSDT -> BTCUSD.
function claveInstrumento(inst) {
  return String(inst || "")
    .toUpperCase()
    .replace(/\.P$/, "")
    .replace(/USDT$/, "USD");
}

function nuevoId(t, inst) {
  const d = new Date(t).toISOString();
  const azar = Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
  return `S-${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}-${claveInstrumento(inst).slice(0, 6)}-${azar}`;
}

// ---------- lectura del texto de la señal (el que arma armarSenal) ----------
function leerTexto(texto) {
  const t = String(texto || "");
  const numero = (re) => {
    const m = t.match(re);
    if (!m) return null;
    const n = parseFloat(m[1].replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const instrumento = (t.match(/Instrumento:\s*(\S+)/) || [])[1] || "";
  const dir = ((t.match(/Operación:\s*(BUY|SELL)/i) || [])[1] || "").toUpperCase();
  const entrada = numero(/Entrada:\s*([\d.,]+)/);
  const sl = numero(/Stop Loss:\s*([\d.,]+)/);
  const tp1 = numero(/Take Profit\s*:\s*([\d.,]+)/);
  const tp2 = numero(/Take Profit 2:\s*([\d.,]+)/);
  const tp3 = numero(/Take Profit 3:\s*([\d.,]+)/);
  const estadoTxt = ((t.match(/ESTADO:\s*([^\n]+)/) || [])[1] || "").trim().toUpperCase();
  const origen = ((t.match(/Tipo de señal:\s*([^\n]+)/) || [])[1] || "").trim().toUpperCase();

  if (!instrumento || !dir || entrada == null || sl == null || tp1 == null) return null;

  const tp = [tp1, tp2, tp3].filter((x) => x != null);
  const ini = estadoTxt === "ACTIVA" ? "ACTIVA" : estadoTxt === "STOP" ? "STOP" : "LIMIT PENDIENTE";

  return { instrumento, dir, entrada, sl, tp, ini, origen: origen || "SIN DATO" };
}

// ---------- lógica de resultado (pura, sin red: es la que se prueba) ----------
// Recorre las velas cerradas posteriores a s.desde y devuelve los eventos que ocurrieron.
// Modifica s (estado, tAct, resultado, r, tpMax, desde).
function evaluar(s, velas, ahora = Date.now()) {
  const eventos = [];
  const buy = s.dir === "BUY";
  const e = s.entrada;
  const tocaSL = (v) => (buy ? v.low <= s.sl : v.high >= s.sl);
  const tocaTP = (v, k) => (buy ? v.high >= s.tp[k] : v.low <= s.tp[k]);
  const activa = (v) =>
    s.ini === "STOP" ? (buy ? v.high >= e : v.low <= e) : buy ? v.low <= e : v.high >= e;
  const rTp1 = red(Math.abs(s.tp[0] - e) / Math.abs(e - s.sl));

  const cerrar = (t, resultado, r, nota) => {
    s.estado = ESTADO.CERR;
    if (resultado) s.resultado = resultado;
    if (r !== undefined) s.r = r;
    s.tCierre = t;
    eventos.push({ tipo: "cierre", t, nota });
  };

  const tpMaxEn = (v) => {
    let k = s.tpMax;
    while (k < s.tp.length && tocaTP(v, k)) k++;
    return k;
  };

  for (const v of velas) {
    if (s.estado === ESTADO.CERR) break;
    if (v.t < s.desde) continue;

    if (s.estado === ESTADO.PEND) {
      if (v.t >= s.t + H24) {
        cerrar(s.t + H24, "Expirada", null);
        break;
      }

      const act = activa(v);

      if (act && tocaSL(v)) {
        s.tAct = v.t;
        eventos.push({ tipo: "activada", t: v.t });
        cerrar(v.t, "SL", -1, "activada y SL en la misma vela");
        break;
      }

      if (tocaTP(v, 0)) {
        cerrar(v.t, "Cancelada", null, "tocó TP1 antes de activarse");
        break;
      }

      if (act) {
        s.estado = ESTADO.ACT;
        s.tAct = v.t;
        eventos.push({ tipo: "activada", t: v.t });
      }
    } else if (s.estado === ESTADO.ACT) {
      if (v.t >= s.tAct + H72) {
        cerrar(s.tAct + H72, "Sin resolver", null);
        break;
      }

      if (tocaSL(v)) {
        cerrar(v.t, "SL", -1);
        break;
      }

      if (tocaTP(v, 0)) {
        s.resultado = "TP1";
        s.r = rTp1;
        s.tpMax = tpMaxEn(v);

        if (s.tpMax >= s.tp.length) {
          cerrar(v.t, null, undefined);
          eventos[eventos.length - 1].tipo = "resultado_y_cierre";
        } else {
          s.estado = ESTADO.SIG;
          s.tCierre = v.t;
          eventos.push({ tipo: "resultado", t: v.t });
        }
      }
    } else if (s.estado === ESTADO.SIG) {
      if (v.t >= s.tAct + H72) {
        cerrar(s.tAct + H72, null, undefined, "fin del seguimiento (72 h)");
        break;
      }

      if (tocaSL(v)) {
        cerrar(v.t, null, undefined, "SL después de TP1");
        break;
      }

      const k = tpMaxEn(v);

      if (k > s.tpMax) {
        s.tpMax = k;

        if (k >= s.tp.length) {
          cerrar(v.t, null, undefined, `alcanzó TP${k}`);
          break;
        }

        eventos.push({ tipo: "tp", t: v.t });
      }
    }

    s.desde = v.t + 1;
  }

  // Plazos por reloj (por ejemplo, fin de semana sin velas).
  if (s.estado === ESTADO.PEND && ahora > s.t + H24 + GRACIA) cerrar(s.t + H24, "Expirada", null);
  else if (s.estado === ESTADO.ACT && ahora > s.tAct + H72 + GRACIA) cerrar(s.tAct + H72, "Sin resolver", null);
  else if (s.estado === ESTADO.SIG && ahora > s.tAct + H72 + GRACIA)
    cerrar(s.tAct + H72, null, undefined, "fin del seguimiento (72 h)");

  return eventos;
}

// ---------- Google Sheets (Apps Script) ----------
let cola = Promise.resolve();

async function llamarHoja(datos) {
  const r = await fetch(process.env.SHEETS_URL, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ ...datos, clave: process.env.SHEETS_KEY }),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });

  const j = await r.json().catch(() => null);

  if (!r.ok || !j || !j.ok) {
    throw new Error(`Hoja: ${(j && j.error) || `HTTP ${r.status}`}`);
  }

  return j;
}

async function conReintentos(datos) {
  let ultimo;

  for (let i = 0; i <= REINTENTOS.length; i++) {
    try {
      return await llamarHoja(datos);
    } catch (e) {
      ultimo = e;
      if (i < REINTENTOS.length) await new Promise((ok) => setTimeout(ok, REINTENTOS[i]));
    }
  }

  throw ultimo;
}

// Escrituras en orden (el alta siempre antes que sus actualizaciones).
function escribir(datos, siFalla) {
  // Devuelve true si se escribió, false si falló (ya avisado). Nunca rechaza.
  const paso = cola.then(
    () => conReintentos(datos).then(() => true),
    () => conReintentos(datos).then(() => true)
  ).catch(async (e) => {
    console.error("Registro:", e.message);
    await avisar(`Registro de señales: no pude escribir en la hoja (${e.message}).\n${siFalla}`);
    return false;
  });
  cola = paso;
  return paso;
}

async function avisar(texto) {
  const dueño = deps.owner();
  if (!dueño) return;
  await deps.enviar(dueño, texto).catch(() => {});
}

function fila(s) {
  return {
    ID: s.id,
    "Fecha UTC": fecha(s.t),
    ts: s.t,
    Origen: s.origen,
    Instrumento: s.instrumento,
    Dirección: s.dir,
    Entrada: s.entrada,
    SL: s.sl,
    TP1: s.tp[0],
    TP2: s.tp[1] ?? "",
    TP3: s.tp[2] ?? "",
    "Estado inicial": s.ini,
    Estado: s.estado,
    "Activación UTC": fecha(s.tAct),
    "ts activación": s.tAct || "",
    Resultado: s.resultado || "",
    "Cierre UTC": fecha(s.tCierre),
    R: s.r ?? "",
    "TP máx": s.tpMax || "",
    "Fuente de precios": s.fuente || "",
    Notas: s.notas || "",
  };
}

const resumenSenal = (s) => `${s.id} ${s.instrumento} ${s.dir} (entrada ${s.entrada}, SL ${s.sl}, TP1 ${s.tp[0]})`;

// ---------- alta ----------
async function registrar(texto, opciones = {}) {
  if (!activo()) return null;

  try {
    const d = leerTexto(texto);

    if (!d) {
      await avisar("Registro de señales: no pude leer la señal publicada, no quedó registrada.");
      return null;
    }

    const t = opciones.t || Date.now();
    const clave = claveInstrumento(d.instrumento);
    const prueba = Boolean(opciones.prueba);
    const seguible = !prueba && Boolean(deps.fuente(clave));

    const s = {
      ...d,
      id: nuevoId(t, d.instrumento),
      t,
      clave,
      estado: prueba ? ESTADO.PRUEBA : !seguible ? ESTADO.MANUAL : d.ini === "ACTIVA" ? ESTADO.ACT : ESTADO.PEND,
      tAct: null,
      tpMax: 0,
      resultado: prueba ? "" : seguible ? "" : "Sin seguimiento",
      r: null,
      desde: t,
      notas: prueba ? "PRUEBA: podés borrar esta fila" : seguible ? "" : "Instrumento sin fuente de precios: cerrala a mano",
    };

    if (prueba) s.origen = "PRUEBA";

    if (s.estado === ESTADO.ACT) s.tAct = t;

    s.escrito = await escribir({ accion: "alta", fila: fila(s) }, `Cargala a mano: ${resumenSenal(s)}`);

    if (s.estado === ESTADO.ACT || s.estado === ESTADO.PEND) abiertas.set(s.id, s);

    return s;
  } catch (e) {
    console.error("Registro (alta):", e.message);
    return null;
  }
}

// ---------- seguimiento ----------
function aplicar(s, velas, fuente) {
  const antes = s.estado;
  const eventos = evaluar(s, velas);

  if (fuente) s.fuente = fuente;

  if (!eventos.length) return;

  const campos = fila(s);
  delete campos.ID;

  escribir({ accion: "actualizar", id: s.id, campos }, `Actualizala a mano: ${resumenSenal(s)} -> ${s.estado} ${s.resultado || ""}`);

  for (const ev of eventos) {
    let txt = "";

    if (ev.tipo === "activada") txt = `Se activó ${fecha(ev.t)}`;
    else if (ev.tipo === "resultado") txt = `Resultado: TP1 (+${s.r}R). Sigo hasta TP${s.tp.length} o SL (máx. 72 h).`;
    else if (ev.tipo === "tp") txt = `Alcanzó TP${s.tpMax}`;
    else if (ev.tipo === "resultado_y_cierre") txt = `Resultado: TP1 (+${s.r}R). Cerrada: alcanzó TP${s.tpMax}.`;
    else if (ev.tipo === "cierre") {
      const r = s.r != null ? ` (${s.r > 0 ? "+" : ""}${s.r}R)` : "";
      txt = antes === ESTADO.SIG || s.resultado === "TP1"
        ? `Cerrada con TP1 (+${s.r}R), TP máx alcanzado: TP${s.tpMax}${ev.nota ? ` (${ev.nota})` : ""}`
        : `Resultado: ${s.resultado}${r}${ev.nota ? ` (${ev.nota})` : ""}`;
    }

    if (txt) avisar(`${s.id} ${s.instrumento} ${s.dir}\n${txt}`);
  }

  if (s.estado === ESTADO.CERR) abiertas.delete(s.id);
}

// Velas que el motor ya pidió (no gasta consultas extra).
function alVelas(instrumento, velas, fuente) {
  if (!activo() || !Array.isArray(velas) || !velas.length) return;

  const clave = claveInstrumento(instrumento);
  const lista = [...abiertas.values()].filter((s) => s.clave === clave);

  if (!lista.length) return;

  let cubiertas = true;

  for (const s of lista) {
    // Si las velas no llegan hasta el inicio pendiente, se deja para el seguimiento propio.
    if (velas[0].t > s.desde + MIN) {
      cubiertas = false;
      continue;
    }

    aplicar(s, velas, fuente);
  }

  if (cubiertas) ultimaRevision.set(clave, Date.now());
}

async function revisar() {
  if (revisando || !activo() || !abiertas.size) return;
  revisando = true;

  try {
    const ahora = Date.now();
    const grupos = new Map();

    for (const s of abiertas.values()) {
      if (!grupos.has(s.clave)) grupos.set(s.clave, []);
      grupos.get(s.clave).push(s);
    }

    // El que hace más tiempo que no se revisa va primero.
    const orden = [...grupos.keys()].sort((a, b) => (ultimaRevision.get(a) || 0) - (ultimaRevision.get(b) || 0));

    for (const clave of orden) {
      const lista = grupos.get(clave);
      const f = deps.fuente(clave);
      const ult = ultimaRevision.get(clave) || 0;

      if (!f) {
        for (const s of lista) aplicar(s, [], null);
        continue;
      }

      const esperar = f.tipo === "bingx" ? CADA_BINGX : CADA_TD;
      if (ahora - ult < esperar) continue;

      if (f.tipo === "td") {
        if (ahora - ultimaTD < CADA_TD) continue;

        if (!f.cripto && !deps.mercadoAbierto()) {
          for (const s of lista) aplicar(s, [], null); // solo plazos
          continue;
        }
      }

      const desde = Math.min(...lista.map((s) => s.desde));
      const minutos = Math.ceil((ahora - desde) / MIN) + 5;
      const [intervalo, cantidad] = minutos > 2800 ? ["5min", Math.ceil(minutos / 5) + 2] : ["1min", minutos];

      ultimaRevision.set(clave, ahora);
      if (f.tipo === "td") ultimaTD = ahora;

      try {
        const r = await f.traer(intervalo, Math.min(cantidad, 5000));

        // BingX cayó a Twelve Data: se cuenta como consulta de Twelve Data.
        if (/^Twelve/.test(r.fuente || "")) {
          ultimaTD = ahora;
          ultimaRevision.set(clave, ahora + CADA_BINGX);
        }

        for (const s of lista) {
          if (r.velas.length && r.velas[0].t > s.desde + 2 * (r.ms || MIN) && !/hueco/.test(s.notas || "")) {
            s.notas = `${s.notas ? s.notas + " " : ""}Posible hueco de datos al inicio del seguimiento.`;
          }

          aplicar(s, r.velas, r.fuente);
        }

        avisados.delete(clave);
      } catch (e) {
        console.error(`Seguimiento ${clave}:`, e.message);

        if (!avisados.has(clave)) {
          avisados.add(clave);
          avisar(`Seguimiento de señales ${clave}: no pude traer precios (${e.message}). Sigo intentando.`);
        }

        for (const s of lista) aplicar(s, [], null);
      }
    }
  } finally {
    revisando = false;
  }
}

// ---------- arranque: retoma las señales abiertas de la hoja ----------
async function iniciar(opc) {
  deps = { ...deps, ...opc };

  if (!activo()) {
    console.log("Registro de señales desactivado (faltan SHEETS_URL / SHEETS_KEY)");
    return;
  }

  try {
    const j = await conReintentos({ accion: "abiertas" });
    let n = 0;

    for (const f of j.filas || []) {
      const t = Number(f.ts);
      const estado = String(f.Estado || "");
      if (!f.ID || !Number.isFinite(t) || ![ESTADO.PEND, ESTADO.ACT, ESTADO.SIG].includes(estado)) continue;

      const tp = [f.TP1, f.TP2, f.TP3]
        .filter((x) => x !== "" && x != null)
        .map(Number)
        .filter((x) => Number.isFinite(x) && x > 0);
      const tAct = Number(f["ts activación"]) || null;

      const s = {
        id: String(f.ID),
        t,
        instrumento: String(f.Instrumento || ""),
        clave: claveInstrumento(f.Instrumento),
        dir: String(f.Dirección || "").toUpperCase(),
        entrada: Number(f.Entrada),
        sl: Number(f.SL),
        tp,
        ini: String(f["Estado inicial"] || "LIMIT PENDIENTE").toUpperCase(),
        origen: String(f.Origen || ""),
        estado,
        tAct,
        tpMax: Number(f["TP máx"]) || 0,
        resultado: String(f.Resultado || ""),
        r: f.R === "" || f.R == null ? null : Number(f.R),
        tCierre: null,
        desde: estado === ESTADO.PEND ? t : tAct || t,
        fuente: String(f["Fuente de precios"] || ""),
        notas: String(f.Notas || ""),
      };

      if (estado !== ESTADO.PEND && !tAct) continue;
      if (!["BUY", "SELL"].includes(s.dir) || !tp.length || !Number.isFinite(s.entrada) || !Number.isFinite(s.sl)) continue;

      abiertas.set(s.id, s);
      n++;
    }

    console.log(`Registro de señales activo: ${n} señales abiertas retomadas`);
  } catch (e) {
    console.error("Registro (inicio):", e.message);
    await avisar(`Registro de señales: no pude leer las señales abiertas de la hoja (${e.message}). Las nuevas se registran igual.`);
  }

  clearInterval(timer);
  timer = setInterval(() => revisar().catch((e) => console.error("Seguimiento:", e.message)), MIN);
}

// ---------- /resultados ----------
function estadisticas(filas, desde) {
  const f = filas.filter((x) => Number(x.ts) >= desde && x.Estado !== ESTADO.PRUEBA);
  const cuenta = (res) => f.filter((x) => x.Resultado === res).length;
  const tp1 = cuenta("TP1");
  const sl = cuenta("SL");
  const rTotal = f
    .filter((x) => x.Resultado === "TP1" || x.Resultado === "SL")
    .reduce((acc, x) => acc + (Number(x.R) || 0), 0);

  return {
    total: f.length,
    tp1,
    sl,
    expiradas: cuenta("Expirada") + cuenta("Cancelada"),
    sinResolver: cuenta("Sin resolver") + cuenta("Sin seguimiento"),
    abiertas: f.filter((x) => [ESTADO.PEND, ESTADO.ACT].includes(x.Estado)).length,
    efectividad: tp1 + sl ? Math.round((tp1 / (tp1 + sl)) * 100) : null,
    r: red(rTotal),
  };
}

function textoEstadisticas(nombre, e) {
  return (
    `${nombre}\n` +
    `Señales: ${e.total}\n` +
    `TP1: ${e.tp1} · SL: ${e.sl}` +
    (e.efectividad != null ? ` · TP1 sobre cerradas: ${e.efectividad}%` : "") +
    `\nR acumulado: ${e.r > 0 ? "+" : ""}${e.r}R\n` +
    `Expiradas/canceladas: ${e.expiradas} · Sin resolver/manual: ${e.sinResolver} · Abiertas: ${e.abiertas}`
  );
}

async function resumen(chat) {
  if (!activo()) {
    await deps.enviar(chat, "El registro de señales está apagado: faltan SHEETS_URL y SHEETS_KEY en Railway.");
    return;
  }

  const ahora = Date.now();
  let filas;

  try {
    const j = await conReintentos({ accion: "desde", ts: ahora - 30 * H24 });
    filas = j.filas || [];
  } catch (e) {
    await deps.enviar(chat, `No pude leer la hoja de señales: ${e.message}`);
    return;
  }

  const texto =
    `Resultados (R oficial en TP1, precios de Twelve Data/BingX, sin spread)\n\n` +
    textoEstadisticas("Últimos 7 días", estadisticas(filas, ahora - 7 * H24)) +
    `\n\n` +
    textoEstadisticas("Últimos 30 días", estadisticas(filas, ahora - 30 * H24));

  await deps.enviar(chat, texto);
}

module.exports = {
  iniciar,
  registrar,
  alVelas,
  resumen,
  activo,
  // para pruebas
  _test: { leerTexto, evaluar, estadisticas, claveInstrumento, ESTADO, abiertas, revisar, setDeps: (d) => (deps = { ...deps, ...d }) },
};
