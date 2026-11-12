// TRADING INSTITUCIONAL | Bot de señales VIP (Cloudflare Worker, plan gratuito)
//
// Flujo: le mandás al bot de Telegram la captura de TradingView con la herramienta de
// posición (o un comando de texto) -> Gemini lee dirección, entrada, SL y TP -> el bot
// valida los niveles, arma la señal con tu formato y la publica en Señales VIP
// (WhatsApp vía Green API y, si querés, un grupo de Telegram).
//
// Variables y secretos (Cloudflare > tu Worker > Settings > Variables and Secrets):
//   TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, OWNER_ID, GEMINI_API_KEY,
//   GREENAPI_URL, GREENAPI_ID, GREENAPI_TOKEN, VIP_WHATSAPP_CHAT_ID
//   Opcionales: TELEGRAM_VIP_CHAT_ID, MODO ("confirmar" por defecto, o "auto"),
//   INSTRUMENTO_DEFECTO ("XAUUSD"), DECIMALES ("auto" o un número), GEMINI_MODEL, GEMINI_MODEL_2

// ----------------------------------------------------------------- TEXTOS (editables)
const TITULO = "*TRADING INSTITUCIONAL | SIGNALS VIP*";
const AVISO_RIESGO =
  "Recordá utilizar un riesgo máximo del 1% de tu capital en esta operación y calcular el tamaño de la posición según la distancia al Stop Loss.";
const AVISO_SL = "Respetá el Stop Loss y evitá aumentar el riesgo durante la operación.";
const FIRMA = "*Trading Institucional* 🏛📈";

const PROMPT = `Sos un lector de capturas de TradingView (modo oscuro). En la captura hay dibujada la herramienta "posición larga/corta".

La herramienta son DOS rectángulos apilados que comparten un borde horizontal, que es la ENTRADA:
- un rectángulo marrón/naranja translúcido: la zona de ganancia (va hacia el take profit);
- un rectángulo gris azulado: la zona de pérdida (va hacia el stop loss).
Dirección:
- marrón ARRIBA de la entrada y gris ABAJO = "BUY" (take profit arriba, stop loss abajo);
- gris ARRIBA de la entrada y marrón ABAJO = "SELL" (stop loss arriba, take profit abajo).
Niveles: el borde del rectángulo marrón que está más lejos de la entrada es el take_profit_1; el borde del gris más lejos de la entrada es el stop_loss; el borde que comparten es la entrada.

Precios: cada nivel de la herramienta tiene pegada, junto a su borde derecho, una etiqueta gris redondeada con el precio (con un circulito). Usá exactamente esos valores. Si no se ven, leé el precio en la escala de la derecha según la posición vertical del borde. Ignorá las demás etiquetas de la escala y las líneas o textos de indicadores (por ejemplo LQ, POI, TARGET, 0.7).
- precio_actual: el último precio, que es la etiqueta de la escala derecha con cuenta regresiva (mm:ss) o resaltada. Si no se distingue, null.
- take_profit_2 y take_profit_3: solo si hay líneas o textos rotulados "TP2" o "TP3" en el gráfico. Si no, null.
- instrumento: el símbolo que aparece en la captura (por ejemplo XAUUSD), sin espacios ni barras. Si no se lee, "".
- Si hay más de una herramienta de posición, usá la más reciente (la más a la derecha) y poné varias_posiciones en true.

Escribí los números con punto decimal y sin separador de miles (por ejemplo 4042.89). No inventes ni redondees valores: si no podés leer un dato con certeza, poné null y explicalo en "observaciones".

Devolvé SOLO un JSON válido con estas claves:
{"instrumento": "", "direccion": "BUY" | "SELL" | "", "entrada": 0, "stop_loss": 0, "take_profit_1": 0, "take_profit_2": null, "take_profit_3": null, "precio_actual": null, "varias_posiciones": false, "observaciones": ""}`;

const AYUDA = `Mandame la captura de TradingView con la herramienta de posición (mejor como foto, con la herramienta seleccionada para que se vean los precios) y armo la señal.

Opcional, en el texto de la foto:
tp2 4060 tp3 4070 (más take profits)
mercado, limit o stop (cambia el ESTADO)
GBPUSD (cambia el instrumento)

Sin imagen:
/s buy 4043 4039 4054
/s sell 4026 4031 4016 4010 mercado
(dirección, entrada, stop loss, TP1 y, si querés, TP2 y TP3)`;

// ----------------------------------------------------------------- ENTRADA
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/setup") return setup(url, env);
    if (url.pathname === "/telegram" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response("bad request", { status: 400 });
      }
      ctx.waitUntil(procesar(update, env)); // se responde 200 ya; el trabajo sigue en segundo plano
      return new Response("ok");
    }
    return new Response("Bot de señales activo");
  },
};

// Registra el webhook de Telegram: abrir https://TU-WORKER.workers.dev/setup?key=TU_WEBHOOK_SECRET
async function setup(url, env) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const r = await tg(env, "setWebhook", {
    url: `${url.origin}/telegram`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  return new Response(`Webhook configurado: ${JSON.stringify(r)}`);
}

// ----------------------------------------------------------------- TELEGRAM
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

const enviar = (env, chat, text, extra = {}) =>
  tg(env, "sendMessage", { chat_id: chat, text, disable_web_page_preview: true, ...extra });

function aHtml(texto) {
  const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*(.+?)\*/g, "<b>$1</b>");
}

// ----------------------------------------------------------------- FLUJO
async function procesar(update, env) {
  const dueño = String(env.OWNER_ID || "");
  try {
    if (update.callback_query) return await alTocarBoton(update.callback_query, env, dueño);
    const m = update.message;
    if (!m || !m.from) return;
    const uid = String(m.from.id);
    const texto = (m.text || m.caption || "").trim();

    if (/^\/(start|id)\b/i.test(texto)) {
      await enviar(
        env,
        m.chat.id,
        `Tu ID de Telegram: ${uid}\nID de este chat: ${m.chat.id}\nEl primero va como OWNER_ID; si este chat es el grupo VIP de Telegram, el segundo va como TELEGRAM_VIP_CHAT_ID.`,
      );
      return;
    }
    if (uid !== dueño) return; // solo vos podés publicar señales

    const foto = m.photo
      ? m.photo[m.photo.length - 1]
      : m.document && /^image\//.test(m.document.mime_type || "")
        ? m.document
        : null;
    if (foto) return await deImagen(env, m.chat.id, foto, m.caption || "");
    if (/^\/(s|senal|señal)\b/i.test(texto)) return await deTexto(env, m.chat.id, texto);
    await enviar(env, m.chat.id, AYUDA);
  } catch (e) {
    if (dueño) await enviar(env, dueño, `No pude armar la señal: ${e.message}`).catch(() => {});
  }
}

async function deImagen(env, chat, foto, caption) {
  await tg(env, "sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
  const f = await tg(env, "getFile", { file_id: foto.file_id });
  const resp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if (!resp.ok) throw new Error("No pude bajar la imagen de Telegram");
  const buf = await resp.arrayBuffer();
  const mime = /\.png$/i.test(f.file_path) ? "image/png" : "image/jpeg";
  const lectura = await leerGrafico(env, aBase64(buf), mime);
  const ajustes = leerCaption(caption);
  await entregar(env, chat, armarSenal(env, lectura, ajustes), lectura);
}

async function deTexto(env, chat, texto) {
  const p = leerManual(texto);
  if (!p.direccion || p.nums.length < 3) {
    throw new Error("Formato: /s buy 4043 4039 4054 (dirección, entrada, stop loss y TP1; TP2 y TP3 opcionales)");
  }
  const [entrada, sl, tp1, tp2, tp3] = p.nums;
  const lectura = {
    instrumento: p.instrumento || "",
    direccion: p.direccion,
    entrada,
    stop_loss: sl,
    take_profit_1: tp1,
    take_profit_2: tp2 ?? null,
    take_profit_3: tp3 ?? null,
    precio_actual: null,
    varias_posiciones: false,
    observaciones: "",
  };
  const err = validar(lectura);
  if (err) throw new Error(err);
  await entregar(env, chat, armarSenal(env, lectura, { estado: p.estado }), lectura);
}

async function entregar(env, chat, senal, lectura) {
  const aviso = [];
  if (lectura.varias_posiciones) aviso.push("Había más de una posición en la imagen: usé la más reciente.");
  if (lectura.observaciones) aviso.push(`Nota de la lectura: ${lectura.observaciones}`);
  const resumen = `Lectura: ${senal.direccion} ${senal.instrumento}\n${senal.detalle}${aviso.length ? "\n" + aviso.join("\n") : ""}`;

  if ((env.MODO || "confirmar").toLowerCase() === "auto") {
    const res = await publicar(env, senal.texto);
    await enviar(env, chat, `${resumen}\n\n${senal.texto}`);
    await enviar(env, chat, resultadoTexto(res));
    return;
  }
  await enviar(env, chat, resumen);
  await enviar(env, chat, senal.texto, {
    reply_markup: {
      inline_keyboard: [[
        { text: "Publicar en Señales VIP", callback_data: "pub" },
        { text: "Cancelar", callback_data: "cancel" },
      ]],
    },
  });
}

const yaPublicados = new Set(); // evita el doble toque dentro de una misma instancia

async function alTocarBoton(cb, env, dueño) {
  const responder = (t) => tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: t }).catch(() => {});
  if (String(cb.from.id) !== dueño || !cb.message) return responder("No autorizado");
  const chat = cb.message.chat.id;
  const mid = cb.message.message_id;
  const quitarBotones = () =>
    tg(env, "editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [] } }).catch(() => {});

  if (cb.data === "cancel") {
    await responder("Cancelada");
    await quitarBotones();
    return;
  }
  if (cb.data !== "pub") return responder("");
  const texto = cb.message.text || "";
  if (!texto.startsWith(TITULO)) return responder("Mensaje no válido");
  const clave = `${chat}:${mid}`;
  if (yaPublicados.has(clave)) return responder("Ya se publicó");
  yaPublicados.add(clave);
  await responder("Publicando...");
  await quitarBotones();
  const res = await publicar(env, texto);
  await enviar(env, chat, resultadoTexto(res));
}

const resultadoTexto = (res) =>
  res.map(([dest, ok, err]) => (ok ? `${dest}: publicada` : `${dest}: ERROR (${err})`)).join("\n");

// ----------------------------------------------------------------- PUBLICAR
async function publicar(env, texto) {
  const res = [];
  const chats = String(env.VIP_WHATSAPP_CHAT_ID || "").split(/[,\s;]+/).filter(Boolean);
  if (env.GREENAPI_ID && env.GREENAPI_TOKEN && chats.length) {
    const base = String(env.GREENAPI_URL || "https://api.green-api.com").replace(/\/+$/, "");
    for (const chatId of chats) {
      try {
        const r = await fetch(`${base}/waInstance${env.GREENAPI_ID}/sendMessage/${env.GREENAPI_TOKEN}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatId, message: texto }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.idMessage) throw new Error(`Green API ${r.status}`);
        res.push(["WhatsApp Señales VIP", true]);
      } catch (e) {
        res.push(["WhatsApp Señales VIP", false, e.message]);
      }
    }
  }
  if (env.TELEGRAM_VIP_CHAT_ID) {
    try {
      await enviar(env, env.TELEGRAM_VIP_CHAT_ID, aHtml(texto), { parse_mode: "HTML" });
      res.push(["Telegram VIP", true]);
    } catch (e) {
      res.push(["Telegram VIP", false, e.message]);
    }
  }
  if (!res.length) throw new Error("No hay destinos configurados (VIP_WHATSAPP_CHAT_ID / TELEGRAM_VIP_CHAT_ID)");
  return res;
}

// ----------------------------------------------------------------- LECTURA CON GEMINI
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function aBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gemini(env, modelo, b64, mime) {
  const cuerpo = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 1024 },
  });
  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: cuerpo,
    });
    if (r.ok) {
      const j = await r.json();
      const partes = j.candidates?.[0]?.content?.parts || [];
      const texto = partes.map((p) => p.text || "").join("");
      if (!texto) throw new Error("Gemini no devolvió respuesta");
      return texto;
    }
    if ([429, 500, 502, 503, 504].includes(r.status) && intento === 0) {
      await esperar(2500);
      continue;
    }
    throw new Error(`Gemini ${modelo} respondió ${r.status}`);
  }
}

async function leerGrafico(env, b64, mime) {
  const modelos = [env.GEMINI_MODEL || "gemini-3.5-flash-lite", env.GEMINI_MODEL_2 || "gemini-3.5-flash"];
  let ultimo = new Error("No se pudo leer la imagen");
  for (const modelo of modelos) {
    try {
      const d = normalizar(await gemini(env, modelo, b64, mime));
      const err = validar(d);
      if (!err) return d;
      ultimo = new Error(err);
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

function normalizar(texto) {
  const i = texto.indexOf("{");
  const j = texto.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("La lectura no devolvió datos");
  const d = JSON.parse(texto.slice(i, j + 1));
  const dir = String(d.direccion || "").trim().toUpperCase();
  return {
    instrumento: String(d.instrumento || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    direccion: dir === "BUY" || dir === "SELL" ? dir : "",
    entrada: numero(d.entrada),
    stop_loss: numero(d.stop_loss),
    take_profit_1: numero(d.take_profit_1),
    take_profit_2: numero(d.take_profit_2),
    take_profit_3: numero(d.take_profit_3),
    precio_actual: numero(d.precio_actual),
    varias_posiciones: d.varias_posiciones === true,
    observaciones: String(d.observaciones || "").trim().slice(0, 200),
  };
}

// ----------------------------------------------------------------- NÚMEROS Y VALIDACIÓN
function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 4.043 / 4.042,89
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", "."); // 4042,89
  else s = s.replace(/,/g, ""); // 4,042.89
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validar(d) {
  if (!d.direccion) return "No pude distinguir si es BUY o SELL. Revisá que se vea la herramienta de posición.";
  const { entrada: e, stop_loss: sl, take_profit_1: t1 } = d;
  if (![e, sl, t1].every((x) => typeof x === "number" && x > 0)) {
    return "No pude leer con certeza la entrada, el stop loss o el TP1. Dejá la herramienta seleccionada para que se vean los precios.";
  }
  const buy = d.direccion === "BUY";
  const ordenOk = buy ? sl < e && e < t1 : t1 < e && e < sl;
  if (!ordenOk) {
    return `Los niveles no tienen sentido para un ${d.direccion}: entrada ${e}, SL ${sl}, TP1 ${t1}.`;
  }
  const tps = [t1, d.take_profit_2, d.take_profit_3].filter((x) => x !== null);
  for (let k = 1; k < tps.length; k++) {
    if (buy ? tps[k] <= tps[k - 1] : tps[k] >= tps[k - 1]) return "Los take profits no están en orden creciente de distancia.";
  }
  if (Math.abs(e - sl) / e > 0.05 || Math.abs(t1 - e) / e > 0.1) {
    return `Los niveles están demasiado lejos entre sí (entrada ${e}, SL ${sl}, TP1 ${t1}): posible error de lectura.`;
  }
  if (d.precio_actual && Math.abs(e - d.precio_actual) / d.precio_actual > 0.05) {
    return `La entrada (${e}) está muy lejos del precio actual (${d.precio_actual}): posible error de lectura.`;
  }
  return null;
}

// ----------------------------------------------------------------- AJUSTES DEL USUARIO
function leerCaption(texto) {
  const aj = { tp: {}, instrumento: "", estado: "" };
  const t = String(texto || "");
  for (const k of ["1", "2", "3"]) {
    const m = t.match(new RegExp(`\\btp\\s*${k}\\s*[:=]?\\s*([\\d.,]+)`, "i"));
    if (m) aj.tp[k] = numero(m[1]);
  }
  if (/\bmercado\b/i.test(t)) aj.estado = "MERCADO";
  else if (/\blimit\b/i.test(t)) aj.estado = "LIMIT";
  else if (/\bstop\b/i.test(t)) aj.estado = "STOP";
  const inst = t.toUpperCase().match(/\b([A-Z]{6}|[A-Z]{2,5}\d{2,3})\b/);
  if (inst && !/^(BUY|SELL)/.test(inst[1])) aj.instrumento = inst[1];
  return aj;
}

function leerManual(texto) {
  const toks = texto.replace(/^\/\S+\s*/, "").split(/\s+/).filter(Boolean);
  const p = { direccion: "", nums: [], instrumento: "", estado: "" };
  for (const k of toks) {
    const u = k.toUpperCase();
    if (/^(BUY|COMPRA|LONG)$/.test(u)) p.direccion = "BUY";
    else if (/^(SELL|VENTA|SHORT)$/.test(u)) p.direccion = "SELL";
    else if (u === "MERCADO") p.estado = "MERCADO";
    else if (u === "LIMIT") p.estado = "LIMIT";
    else if (u === "STOP") p.estado = "STOP";
    else if (/^([A-Z]{6}|[A-Z]{2,5}\d{2,3})$/.test(u)) p.instrumento = u;
    else {
      const n = numero(k);
      if (n !== null) p.nums.push(n);
    }
  }
  return p;
}

// ----------------------------------------------------------------- ARMADO DE LA SEÑAL
function decimalesAuto(p) {
  return p >= 1000 ? 0 : p >= 10 ? 3 : 5;
}

function fmt(n, d) {
  const s = Math.abs(n).toFixed(d);
  const [ent, dec] = s.split(".");
  return (n < 0 ? "-" : "") + ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dec ? "," + dec : "");
}

// Entrada y TP al valor más cercano; el SL se redondea hacia afuera (más margen).
function redondear(dir, e, sl, tps, d) {
  const f = 10 ** d;
  const cerca = (x) => Math.round(x * f + 1e-9) / f;
  const afuera = (x) => (dir === "BUY" ? Math.floor(x * f + 1e-6) / f : Math.ceil(x * f - 1e-6) / f);
  return { e: cerca(e), sl: afuera(sl), tps: tps.map(cerca) };
}

function armarSenal(env, lec, aj) {
  const dir = lec.direccion;
  const instrumento = aj.instrumento || lec.instrumento || env.INSTRUMENTO_DEFECTO || "XAUUSD";
  const tps = [lec.take_profit_1, lec.take_profit_2, lec.take_profit_3];
  for (const k of [1, 2, 3]) if (aj.tp && aj.tp[k] != null) tps[k - 1] = aj.tp[k];
  const lista = tps.filter((x) => x !== null && x !== undefined);
  const err = validar({ ...lec, take_profit_1: lista[0], take_profit_2: lista[1] ?? null, take_profit_3: lista[2] ?? null });
  if (err) throw new Error(err);

  const cfg = String(env.DECIMALES || "auto").toLowerCase();
  let d = cfg === "auto" ? decimalesAuto(lec.entrada) : Number(cfg);
  let r = redondear(dir, lec.entrada, lec.stop_loss, lista, d);
  const buy = dir === "BUY";
  const ok = (x) => (buy ? x.sl < x.e && x.e < x.tps[0] : x.tps[0] < x.e && x.e < x.sl);
  if (!ok(r)) {
    d += 2; // el redondeo achicó demasiado los niveles: se usan más decimales
    r = redondear(dir, lec.entrada, lec.stop_loss, lista, d);
  }

  // Estado de la orden según el precio actual (o lo que indiques en el texto).
  const actual = lec.precio_actual;
  let estado = "LIMIT PENDIENTE";
  if (aj.estado === "MERCADO") estado = "ENTRADA A MERCADO";
  else if (aj.estado === "STOP") estado = "STOP PENDIENTE";
  else if (aj.estado === "LIMIT") estado = "LIMIT PENDIENTE";
  else if (actual) {
    if (Math.abs(lec.entrada - actual) <= actual * 0.0001) estado = "ENTRADA A MERCADO";
    else estado = (buy ? lec.entrada < actual : lec.entrada > actual) ? "LIMIT PENDIENTE" : "STOP PENDIENTE";
  }

  const tpTexto =
    r.tps.length === 1
      ? `Take Profit : ${fmt(r.tps[0], d)}`
      : r.tps.map((t, i) => `Take Profit ${i + 1}: ${fmt(t, d)}`).join("\n");
  const texto = [
    TITULO,
    "",
    `Instrumento: ${instrumento}`,
    `Operación:  ${dir}`,
    `Entrada: ${fmt(r.e, d)}`,
    `Stop Loss: ${fmt(r.sl, d)}`,
    tpTexto,
    "",
    `ESTADO: ${estado}`,
    "",
    AVISO_RIESGO,
    "",
    AVISO_SL,
    "",
    FIRMA,
  ].join("\n");

  const riesgo = Math.abs(lec.entrada - lec.stop_loss);
  const rr = (x) => (Math.abs(x - lec.entrada) / riesgo).toFixed(1);
  const dx = Math.max(2, d);
  const detalle =
    `Entrada ${lec.entrada.toFixed(dx)} | SL ${lec.stop_loss.toFixed(dx)} | ` +
    lista.map((t, i) => `TP${i + 1} ${t.toFixed(dx)} (1:${rr(t)})`).join(" | ") +
    `\nRiesgo ${riesgo.toFixed(dx)} | Precio actual ${actual ? actual.toFixed(dx) : "no detectado"} | ${estado}`;
  return { texto, detalle, direccion: dir, instrumento };
}
