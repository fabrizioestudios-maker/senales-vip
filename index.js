// TRADING INSTITUCIONAL | Bot de señales VIP (Railway)
const express = require("express");
const app = express();
app.use(express.json({ limit: "10mb" }));

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
(dirección, entrada, stop loss, TP1 y, si querés, TP2 y TP3)\n\n/grupos (lista tus grupos de WhatsApp con su ID)`;

const PORT = process.env.PORT || 3000;

// Publicación automática de las señales que genera el bot solo
// (alertas de TradingView y señales por velas). Las fotos y /s siguen
// el valor de MODO (confirmar por defecto).
const autoTV = () =>
  ["1", "true", "si", "sí", "on"].includes(String(process.env.AUTO_TV || "").toLowerCase());

// Estado por defecto de las señales automáticas: la entrada ya se tocó
// cuando se dispara la señal, por eso sale como ACTIVA.
const estadoAuto = () => process.env.ESTADO_TV || "mercado";

app.get("/", (req, res) => res.send("Bot de señales activo"));
app.get("/setup", setup);

app.post("/telegram", async (req, res) => {
  const secret = req.headers["x-telegram-bot-api-secret-token"];

  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).send("forbidden");
  }

  res.send("ok");

  try {
    await procesar(req.body);
  } catch (e) {
    console.error(e);
  }
});

// --- TradingView: alertas del indicador Bias Toolkit V.2 ---
const tvRecientes = new Map();

app.post("/tradingview", express.text({ type: "*/*", limit: "100kb" }), async (req, res) => {
  if (!process.env.TRADINGVIEW_KEY || req.query.key !== process.env.TRADINGVIEW_KEY) {
    return res.status(403).send("forbidden");
  }

  res.send("ok");

  const dueño = String(process.env.OWNER_ID || "");

  try {
    const d = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const lectura = {
      instrumento: String(d.symbol || ""),
      direccion: String(d.side || "").toUpperCase(),
      entrada: num(d.entry),
      stop_loss: num(d.sl),
      take_profit_1: num(d.tp1),
      take_profit_2: num(d.tp2),
      take_profit_3: num(d.tp3),
      precio_actual: null,
      varias_posiciones: false,
      observaciones: "",
    };

    const err = validar(lectura);
    if (err) throw new Error(err);

    const clave = [lectura.instrumento, d.tf, lectura.direccion, lectura.entrada, lectura.stop_loss].join("|");
    const ahora = Date.now();

    // Limpia entradas viejas para que el Map no crezca sin límite.
    for (const [k, t] of tvRecientes) {
      if (ahora - t > 600000) tvRecientes.delete(k);
    }

    if (ahora - (tvRecientes.get(clave) || 0) < 120000) return;
    tvRecientes.set(clave, ahora);

    const senal = armarSenal(lectura, { estado: estadoAuto(), origen: "automática" });
    await entregar(dueño, senal, lectura, autoTV());
  } catch (e) {
    console.error(e);
    if (dueño) {
      await enviar(dueño, `Alerta de TradingView no procesada: ${e.message}`).catch(() => {});
    }
  }
});

// Prueba: abrila desde Chrome. Manda un ejemplo solo a tu Telegram, no publica nada.
app.get("/tradingview/test", async (req, res) => {
  if (!process.env.TRADINGVIEW_KEY || req.query.key !== process.env.TRADINGVIEW_KEY) {
    return res.status(403).send("forbidden");
  }

  const l = {
    instrumento: "XAUUSD",
    direccion: "SELL",
    entrada: 4043,
    stop_loss: 4047,
    take_profit_1: 4039,
    take_profit_2: 4035,
    take_profit_3: 4031,
  };

  try {
    await enviar(String(process.env.OWNER_ID || ""), armarSenal(l, { estado: estadoAuto(), origen: "automática" }).texto);
    res.send("Prueba enviada a tu Telegram");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.listen(PORT, () => console.log(`Bot escuchando en puerto ${PORT}`));

async function setup(req, res) {
  // Clave propia para /setup (SETUP_KEY). Si no existe, usa WEBHOOK_SECRET como antes.
  const claveSetup = process.env.SETUP_KEY || process.env.WEBHOOK_SECRET;

  if (!process.env.WEBHOOK_SECRET || !claveSetup || req.query.key !== claveSetup) {
    return res.status(403).send("forbidden");
  }

  const url = `https://${req.get("host")}/telegram`;

  try {
    const r = await tg("setWebhook", {
      url,
      secret_token: process.env.WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });

    res.send(`Webhook configurado: ${JSON.stringify(r)}`);
  } catch (e) {
    res.status(500).send(e.message);
  }
}

async function tg(method, body) {
  const r = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!j.ok) {
    throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  }

  return j.result;
}

const enviar = (chat, text, extra = {}) =>
  tg("sendMessage", {
    chat_id: chat,
    text,
    disable_web_page_preview: true,
    ...extra,
  });

function aHtml(texto) {
  const esc = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return esc.replace(/\*(.+?)\*/g, "<b>$1</b>");
}

async function procesar(update) {
  const dueño = String(process.env.OWNER_ID || "");

  try {
    if (update.callback_query) {
      return await alTocarBoton(update.callback_query, dueño);
    }

    const m = update.message;

    if (!m || !m.from) return;

    const uid = String(m.from.id);
    const texto = (m.text || m.caption || "").trim();

    if (/^\/(start|id)\b/i.test(texto)) {
      await enviar(
        m.chat.id,
        `Tu ID de Telegram: ${uid}\nID de este chat: ${m.chat.id}\nEl primero va como OWNER_ID; si este chat es el grupo VIP de Telegram, el segundo va como TELEGRAM_VIP_CHAT_ID.`
      );
      return;
    }

    if (uid !== dueño) return;

    const foto = m.photo
      ? m.photo[m.photo.length - 1]
      : m.document && /^image\//.test(m.document.mime_type || "")
        ? m.document
        : null;

    if (foto) {
      return await deImagen(m.chat.id, foto, m.caption || "");
    }

    if (/^\/grupos\b/i.test(texto)) {
      return await listarGrupos(m.chat.id);
    }

    if (/^\/(s|senal|señal)\b/i.test(texto)) {
      return await deTexto(m.chat.id, texto);
    }

    await enviar(m.chat.id, AYUDA);
  } catch (e) {
    if (dueño) {
      await enviar(dueño, `No pude armar la señal: ${e.message}`).catch(() => {});
    }
  }
}

async function deImagen(chat, foto, caption) {
  await tg("sendChatAction", {
    chat_id: chat,
    action: "typing",
  }).catch(() => {});

  const f = await tg("getFile", {
    file_id: foto.file_id,
  });

  const resp = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`
  );

  if (!resp.ok) {
    throw new Error("No pude bajar la imagen de Telegram");
  }

  const buf = await resp.arrayBuffer();
  const mime = /\.png$/i.test(f.file_path) ? "image/png" : "image/jpeg";

  const lectura = await leerGrafico(aBase64(buf), mime);
  const ajustes = leerCaption(caption);

  await entregar(chat, armarSenal(lectura, { ...ajustes, origen: "manual" }), lectura);
}

async function deTexto(chat, texto) {
  const p = leerManual(texto);

  if (!p.direccion || p.nums.length < 3) {
    throw new Error(
      "Formato: /s buy 4043 4039 4054 (dirección, entrada, stop loss y TP1; TP2 y TP3 opcionales)"
    );
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

  if (err) {
    throw new Error(err);
  }

  await entregar(chat, armarSenal(lectura, { estado: p.estado, origen: "manual" }), lectura);
}

// forzarAuto = true publica directo en los canales VIP sin pedir confirmación.
async function entregar(chat, senal, lectura, forzarAuto = false) {
  const aviso = [];

  if (lectura.varias_posiciones) {
    aviso.push("Había más de una posición en la imagen: usé la más reciente.");
  }

  if (lectura.observaciones) {
    aviso.push(`Nota de la lectura: ${lectura.observaciones}`);
  }

  const resumen = `Lectura: ${senal.direccion} ${senal.instrumento}\n${senal.detalle}${aviso.length ? "\n" + aviso.join("\n") : ""}`;

  if (forzarAuto || (process.env.MODO || "confirmar").toLowerCase() === "auto") {
    let resultado;

    try {
      resultado = resultadoTexto(await publicar(senal.texto));
    } catch (e) {
      resultado = `No se pudo publicar: ${e.message}`;
    }

    // Copia para el dueño: siempre llega, aunque la publicación falle.
    await enviar(chat, `${resumen}\n\n${senal.texto}`);
    await enviar(chat, resultado);

    return;
  }

  await enviar(chat, resumen);

  await enviar(chat, senal.texto, {
    reply_markup: {
      inline_keyboard: [[
        { text: "Publicar en Señales VIP", callback_data: "pub" },
        { text: "Cancelar", callback_data: "cancel" },
      ]],
    },
  });
}

const yaPublicados = new Set();

async function alTocarBoton(cb, dueño) {
  const responder = (t) =>
    tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: t,
    }).catch(() => {});

  if (String(cb.from.id) !== dueño || !cb.message) {
    return responder("No autorizado");
  }

  const chat = cb.message.chat.id;
  const mid = cb.message.message_id;

  const quitarBotones = () =>
    tg("editMessageReplyMarkup", {
      chat_id: chat,
      message_id: mid,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});

  if (cb.data === "cancel") {
    await responder("Cancelada");
    await quitarBotones();
    return;
  }

  if (cb.data !== "pub") {
    return responder("");
  }

  const texto = cb.message.text || "";

  if (!texto.startsWith(TITULO)) {
    return responder("Mensaje no válido");
  }

  const clave = `${chat}:${mid}`;

  if (yaPublicados.has(clave)) {
    return responder("Ya se publicó");
  }

  yaPublicados.add(clave);

  await responder("Publicando...");
  await quitarBotones();

  const res = await publicar(texto);

  await enviar(chat, resultadoTexto(res));
}

const resultadoTexto = (res) =>
  res
    .map(([dest, ok, err]) =>
      ok ? `${dest}: publicada` : `${dest}: ERROR (${err})`
    )
    .join("\n");

const waBase = () =>
  String(process.env.GREENAPI_URL || "https://api.green-api.com").replace(/\/+$/, "");

const waListo = () => Boolean(process.env.GREENAPI_ID && process.env.GREENAPI_TOKEN);

const listaChats = (variable) =>
  String(process.env[variable] || "")
    .split(/[,\s;]+/)
    .filter(Boolean);

async function waEnviar(chatId, texto) {
  const r = await fetch(
    `${waBase()}/waInstance${process.env.GREENAPI_ID}/sendMessage/${process.env.GREENAPI_TOKEN}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, message: texto }),
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || !j.idMessage) {
    throw new Error(`Green API ${r.status}`);
  }
}

async function publicar(texto) {
  const res = [];

  // --- Señal completa: grupo Señales VIP (WhatsApp) ---
  if (waListo()) {
    for (const chatId of listaChats("VIP_WHATSAPP_CHAT_ID")) {
      try {
        await waEnviar(chatId, texto);
        res.push(["WhatsApp Señales VIP", true]);
      } catch (e) {
        res.push(["WhatsApp Señales VIP", false, e.message]);
      }
    }
  }

  // --- Señal completa: Telegram VIP ---
  if (process.env.TELEGRAM_VIP_CHAT_ID) {
    try {
      await enviar(
        process.env.TELEGRAM_VIP_CHAT_ID,
        aHtml(texto),
        { parse_mode: "HTML" }
      );

      res.push(["Telegram VIP", true]);
    } catch (e) {
      res.push(["Telegram VIP", false, e.message]);
    }
  }

  if (!res.length) {
    throw new Error(
      "No hay destinos configurados (VIP_WHATSAPP_CHAT_ID / TELEGRAM_VIP_CHAT_ID)"
    );
  }

  // --- Aviso SIN precios en el grupo de Avisos (WA_AVISOS_CHAT_ID) ---
  // Solo si la señal salió en algún destino. Se desactiva con AVISO_SENAL=0.
  if (waListo() && process.env.AVISO_SENAL !== "0" && res.some(([, ok]) => ok)) {
    const avisos = listaChats("WA_AVISOS_CHAT_ID");

    if (avisos.length) {
      const inst = (texto.match(/Instrumento:\s*(\S+)/) || [])[1] || "";

      const aviso =
        `🚨 *Nueva señal publicada en SEÑALES VIP*\n\n` +
        (inst ? `Instrumento: ${inst}\n\n` : "") +
        `Los niveles de entrada, Stop Loss y Take Profit son solo para miembros del grupo VIP.\n\n` +
        FIRMA;

      for (const chatId of avisos) {
        try {
          await waEnviar(chatId, aviso);
          res.push(["WhatsApp Avisos", true]);
        } catch (e) {
          res.push(["WhatsApp Avisos", false, e.message]);
        }
      }
    }
  }

  return res;
}

// /grupos: lista tus grupos de WhatsApp con su ID, para cargarlos en las variables.
async function listarGrupos(chat) {
  if (!waListo()) {
    throw new Error("Faltan GREENAPI_ID / GREENAPI_TOKEN");
  }

  const r = await fetch(
    `${waBase()}/waInstance${process.env.GREENAPI_ID}/getContacts/${process.env.GREENAPI_TOKEN}`
  );

  const j = await r.json().catch(() => null);

  if (!r.ok || !Array.isArray(j)) {
    throw new Error(`Green API getContacts ${r.status}`);
  }

  const grupos = j.filter((c) => String(c.id || "").endsWith("@g.us"));

  if (!grupos.length) {
    await enviar(chat, "No encontré grupos en la cuenta de WhatsApp conectada.");
    return;
  }

  const bloques = grupos.map((g) => `${g.name || "(sin nombre)"}\n${g.id}`);

  // Telegram admite hasta 4096 caracteres por mensaje.
  let actual = "Grupos de WhatsApp (nombre e ID):\n";

  for (const b of bloques) {
    if ((actual + "\n" + b).length > 3500) {
      await enviar(chat, actual);
      actual = "";
    }

    actual += (actual ? "\n" : "") + b + "\n";
  }

  if (actual.trim()) await enviar(chat, actual);
}

function aBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + 0x8000)
    );
  }

  return btoa(s);
}

async function gemini(modelo, b64, mime) {
  const cuerpo = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { text: PROMPT },
        {
          inline_data: {
            mime_type: mime,
            data: b64,
          },
        },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
      // Margen amplio: los modelos nuevos pueden gastar tokens pensando
      // y cortar el JSON si el límite es muy bajo.
      maxOutputTokens: 4096,
    },
  });

  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: cuerpo,
      }
    );

    if (r.ok) {
      const j = await r.json();
      const partes = j.candidates?.[0]?.content?.parts || [];
      const texto = partes.map((p) => p.text || "").join("");

      try {
        return JSON.parse(texto);
      } catch {
        throw new Error("Gemini no devolvió JSON válido");
      }
    }

    if (r.status === 429 || r.status >= 500) {
      await new Promise((ok) => setTimeout(ok, 1200 * (intento + 1)));
    } else {
      const err = await r.text().catch(() => "");
      throw new Error(`Gemini ${modelo} ${r.status}: ${err.slice(0, 200)}`);
    }
  }

  throw new Error("Gemini falló después de reintentos");
}

async function leerGrafico(b64, mime) {
  // gemini-2.0-flash y gemini-1.5-flash ya fueron dados de baja por Google.
  // Si algún modelo cambia de nombre, se ajusta con GEMINI_MODEL / GEMINI_MODEL_2 en Railway.
  const modelos = [
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    process.env.GEMINI_MODEL_2 || "gemini-3.6-flash",
  ];

  let ultimoError;

  for (const m of modelos) {
    try {
      return await gemini(m, b64, mime);
    } catch (e) {
      ultimoError = e;
    }
  }

  throw ultimoError || new Error("No pude leer el gráfico");
}

function num(v) {
  if (v == null || v === "") return null;

  if (typeof v === "number") return v;

  const s = String(v).trim().replace(",", ".");
  const n = parseFloat(s);

  return Number.isFinite(n) ? n : null;
}

function validar(l) {
  const dir = (l.direccion || "").toUpperCase();

  if (dir !== "BUY" && dir !== "SELL") {
    return "Dirección inválida";
  }

  const entrada = num(l.entrada);
  const sl = num(l.stop_loss);
  const tp1 = num(l.take_profit_1);

  if (entrada == null || sl == null || tp1 == null) {
    return "Faltan entrada, SL o TP1";
  }

  if (dir === "BUY" && !(sl < entrada && entrada < tp1)) {
    return "Para BUY debe ser SL < Entrada < TP";
  }

  if (dir === "SELL" && !(tp1 < entrada && entrada < sl)) {
    return "Para SELL debe ser TP < Entrada < SL";
  }

  return null;
}

function fmt(n) {
  if (n == null) return "";

  const d = process.env.DECIMALES;

  if (d && d !== "auto") {
    return Number(n).toFixed(Number(d));
  }

  return String(n);
}

function armarSenal(lectura, ajustes = {}) {
  const dir = (lectura.direccion || "").toUpperCase();

  const instrumento = (
    ajustes.instrumento ||
    lectura.instrumento ||
    process.env.INSTRUMENTO_DEFECTO ||
    "XAUUSD"
  ).toUpperCase();

  const entrada = num(lectura.entrada);
  const sl = num(lectura.stop_loss);
  const tp1 = num(lectura.take_profit_1);
  const tp2 = num(ajustes.tp2 ?? lectura.take_profit_2);
  const tp3 = num(ajustes.tp3 ?? lectura.take_profit_3);

  let estado = (ajustes.estado || "LIMIT PENDIENTE").toUpperCase();

  if (String(ajustes.estado || "").toLowerCase() === "mercado") {
    estado = "ACTIVA";
  }

  // Tipo de señal: AUTOMÁTICA (la genera el bot) o MANUAL (la mandás vos).
  const origen = String(ajustes.origen || "").toUpperCase();

  let texto = `${TITULO}\n\n`;
  if (origen) {
    texto += `Tipo de señal: ${origen}\n`;
  }
  texto += `Instrumento: ${instrumento}\n`;
  texto += `Operación:  ${dir}\n`;
  texto += `Entrada: ${fmt(entrada)}\n`;
  texto += `Stop Loss: ${fmt(sl)}\n`;
  texto += `Take Profit : ${fmt(tp1)}`;

  if (tp2 != null) {
    texto += `\nTake Profit 2: ${fmt(tp2)}`;
  }

  if (tp3 != null) {
    texto += `\nTake Profit 3: ${fmt(tp3)}`;
  }

  texto += `\n\nESTADO: ${estado}\n\n`;
  texto += `${AVISO_RIESGO}\n\n${AVISO_SL}\n\n${FIRMA}`;

  const detalle = `Entrada ${fmt(entrada)} | SL ${fmt(sl)} | TP ${fmt(tp1)}`;

  return {
    texto,
    direccion: dir,
    instrumento,
    detalle,
  };
}

function leerCaption(caption) {
  const t = (caption || "").toLowerCase();
  const out = {};

  const mTp2 = t.match(/tp2\s*[:=]?\s*([\d.,]+)/i);
  const mTp3 = t.match(/tp3\s*[:=]?\s*([\d.,]+)/i);

  if (mTp2) out.tp2 = mTp2[1];
  if (mTp3) out.tp3 = mTp3[1];

  if (/\bmercado\b/.test(t)) out.estado = "mercado";
  if (/\blimit\b/.test(t)) out.estado = "LIMIT PENDIENTE";
  // "stop" solo cuenta como tipo de orden; "stop loss" no cambia el estado.
  if (/\bstop\b(?!\s*loss)/.test(t)) out.estado = "STOP";

  // Instrumento: solo símbolos reales, no cualquier palabra del texto
  // (antes "mercado" o "limit" terminaban como instrumento).
  const mInst = t.match(
    /\b(x(?:au|ag)usd|[a-z]{3,4}usdt?|[a-z]{3}(?:jpy|eur|gbp|chf|cad|aud|nzd)|us30|us100|us500|nas100|spx500|ger40|dxy)\b/i
  );

  if (mInst) {
    out.instrumento = mInst[1].toUpperCase();
  }

  return out;
}

function leerManual(texto) {
  const partes = texto.trim().split(/\s+/);
  const out = {
    nums: [],
    estado: "LIMIT PENDIENTE",
  };

  for (const p of partes.slice(1)) {
    const low = p.toLowerCase();

    if (low === "buy" || low === "sell") {
      out.direccion = low.toUpperCase();
    } else if (low === "mercado") {
      out.estado = "mercado";
    } else if (low === "limit") {
      out.estado = "LIMIT PENDIENTE";
    } else if (low === "stop") {
      out.estado = "STOP";
    } else if (/^[A-Za-z]{3,10}$/.test(p)) {
      out.instrumento = p.toUpperCase();
    } else {
      const n = num(p);
      if (n != null) out.nums.push(n);
    }
  }

  return out;
}

// =====================================================================
// SEÑALES AUTOMÁTICAS POR VELAS (sin webhook de TradingView)
// Porta la lógica de señales de Bias Toolkit V.2.
// =====================================================================

const TV_INTERVALOS = {
  "1min": 60000,
  "5min": 300000,
  "15min": 900000,
  "30min": 1800000,
  "1h": 3600000,
};

function tvConfig() {
  const n = (k, d) => {
    const v = process.env[k];
    return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d;
  };

  return {
    swingLen: n("SWING_LEN", 12),
    internalLen: n("INTERNAL_LEN", 4),
    mintick: n("TV_MINTICK", 0.01),
    decimales: n("TV_DECIMALES", 2),
    zonaA: n("ZONA_1", 0.618),
    zonaB: n("ZONA_2", 0.7),
    solapePct: n("SOLAPE_PCT", 50),
    slBuffer: n("SL_BUFFER", 0),
    tp: [n("TP1_R", 1), n("TP2_R", 2), n("TP3_R", 3)],
    mecha: String(process.env.BREAK_SOURCE || "Close").toLowerCase() === "wick",
  };
}

function pivote(arr, i, len, alto) {
  const c = i - len;
  if (c - len < 0) return null;

  const v = arr[c];

  for (let k = 1; k <= len; k++) {
    const izq = arr[c - k];
    const der = arr[c + k];

    if (alto ? izq > v || der >= v : izq < v || der <= v) return null;
  }

  return v;
}

function biasToolkit(velas, cfg) {
  const z1 = Math.min(cfg.zonaA, cfg.zonaB);
  const z2 = Math.max(cfg.zonaA, cfg.zonaB);
  const altos = velas.map((v) => v.high);
  const bajos = velas.map((v) => v.low);
  const redondear = (x) => Number(x.toFixed(cfg.decimales));

  let ultSPH = null, ultSPL = null, ultSPHBar = null, ultSPLBar = null;
  let sHigh = null, sLow = null, sHighBar = null, sLowBar = null;
  let sHighFija = false, sLowFija = false, sTrend = 0;

  let ultIPH = null, ultIPL = null, ultIPHBar = null, ultIPLBar = null;
  let iHigh = null, iLow = null, iHighBar = null, iLowBar = null;
  let iHighFija = false, iLowFija = false, iTrend = 0;

  let senalDisparada = false;
  let confluenciaDisparada = false;

  const salida = [];

  for (let i = 0; i < velas.length; i++) {
    const { open, high, low, close } = velas[i];

    const sPH = pivote(altos, i, cfg.swingLen, true);
    const sPL = pivote(bajos, i, cfg.swingLen, false);
    const iPH = pivote(altos, i, cfg.internalLen, true);
    const iPL = pivote(bajos, i, cfg.internalLen, false);

    // --- Pivotes mayores ---
    if (sPH !== null) {
      ultSPH = sPH;
      ultSPHBar = i - cfg.swingLen;

      if (sTrend === 0) {
        if (sHigh === null) {
          sHigh = sPH;
          sHighBar = ultSPHBar;
          sHighFija = true;
        }
      } else if (sTrend === 1 && !sHighFija && sPH >= sHigh - cfg.mintick) {
        sHigh = sPH;
        sHighBar = ultSPHBar;
        sHighFija = true;
      }
    }

    if (sPL !== null) {
      ultSPL = sPL;
      ultSPLBar = i - cfg.swingLen;

      if (sTrend === 0) {
        if (sLow === null) {
          sLow = sPL;
          sLowBar = ultSPLBar;
          sLowFija = true;
        }
      } else if (sTrend === -1 && !sLowFija && sPL <= sLow + cfg.mintick) {
        sLow = sPL;
        sLowBar = ultSPLBar;
        sLowFija = true;
      }
    }

    // --- Pivotes internos ---
    if (iPH !== null) {
      ultIPH = iPH;
      ultIPHBar = i - cfg.internalLen;

      if (iTrend === 0) {
        if (iHigh === null) {
          iHigh = iPH;
          iHighBar = ultIPHBar;
          iHighFija = true;
        }
      } else if (iTrend === 1 && !iHighFija && iPH >= iHigh - cfg.mintick) {
        iHigh = iPH;
        iHighBar = ultIPHBar;
        iHighFija = true;
      }
    }

    if (iPL !== null) {
      ultIPL = iPL;
      ultIPLBar = i - cfg.internalLen;

      if (iTrend === 0) {
        if (iLow === null) {
          iLow = iPL;
          iLowBar = ultIPLBar;
          iLowFija = true;
        }
      } else if (iTrend === -1 && !iLowFija && iPL <= iLow + cfg.mintick) {
        iLow = iPL;
        iLowBar = ultIPLBar;
        iLowFija = true;
      }
    }

    // --- Rupturas ---
    const fuenteSup = cfg.mecha ? high : close;
    const fuenteInf = cfg.mecha ? low : close;

    let sBull = sHigh !== null && fuenteSup > sHigh && (sTrend <= 0 || sHighFija);
    let sBear = sLow !== null && fuenteInf < sLow && (sTrend >= 0 || sLowFija);
    let iBull = iHigh !== null && fuenteSup > iHigh && (iTrend <= 0 || iHighFija);
    let iBear = iLow !== null && fuenteInf < iLow && (iTrend >= 0 || iLowFija);

    if (sBull && sBear) {
      sBull = close >= open;
      sBear = !sBull;
    }

    if (iBull && iBear) {
      iBull = close >= open;
      iBear = !iBull;
    }

    // --- Transiciones swing ---
    if (sBull) {
      sTrend = 1;

      if (ultSPL !== null && ultSPLBar < i) {
        sLow = ultSPL;
        sLowBar = ultSPLBar;
        sLowFija = true;
      }

      sHigh = high;
      sHighBar = i;
      sHighFija = false;
      confluenciaDisparada = false;
    }

    if (sBear) {
      sTrend = -1;

      if (ultSPH !== null && ultSPHBar < i) {
        sHigh = ultSPH;
        sHighBar = ultSPHBar;
        sHighFija = true;
      }

      sLow = low;
      sLowBar = i;
      sLowFija = false;
      confluenciaDisparada = false;
    }

    if (sTrend === 1 && !sHighFija && (sHigh === null || high > sHigh)) {
      sHigh = high;
      sHighBar = i;
      confluenciaDisparada = false;
    }

    if (sTrend === -1 && !sLowFija && (sLow === null || low < sLow)) {
      sLow = low;
      sLowBar = i;
      confluenciaDisparada = false;
    }

    // --- Transiciones internas ---
    if (iBull) {
      iTrend = 1;

      if (ultIPL !== null) {
        iLow = ultIPL;
        iLowBar = ultIPLBar;
        iLowFija = true;
      }

      iHigh = high;
      iHighBar = i;
      iHighFija = false;
      senalDisparada = false;
      confluenciaDisparada = false;
    }

    if (iBear) {
      iTrend = -1;

      if (ultIPH !== null) {
        iHigh = ultIPH;
        iHighBar = ultIPHBar;
        iHighFija = true;
      }

      iLow = low;
      iLowBar = i;
      iLowFija = false;
      senalDisparada = false;
      confluenciaDisparada = false;
    }

    if (iTrend === 1 && !iHighFija && (iHigh === null || high > iHigh)) {
      iHigh = high;
      iHighBar = i;
      senalDisparada = false;
      confluenciaDisparada = false;
    }

    if (iTrend === -1 && !iLowFija && (iLow === null || low < iLow)) {
      iLow = low;
      iLowBar = i;
      senalDisparada = false;
      confluenciaDisparada = false;
    }

    // --- Rangos y zonas ---
    const validoI =
      iHigh !== null && iLow !== null && iHighBar !== null && iLowBar !== null && iHigh > iLow;
    const validoS =
      sHigh !== null && sLow !== null && sHighBar !== null && sLowBar !== null && sHigh > sLow;

    let iSegundo = null, iTop = null, iBot = null;
    let sTop = null, sBot = null;

    if (validoI && iTrend !== 0) {
      const tam = iHigh - iLow;
      const a = iTrend === 1 ? iHigh - tam * z1 : iLow + tam * z1;
      const b = iTrend === 1 ? iHigh - tam * z2 : iLow + tam * z2;
      iSegundo = b;
      iTop = Math.max(a, b);
      iBot = Math.min(a, b);
    }

    if (validoS && sTrend !== 0) {
      const tam = sHigh - sLow;
      const a = sTrend === 1 ? sHigh - tam * z1 : sLow + tam * z1;
      const b = sTrend === 1 ? sHigh - tam * z2 : sLow + tam * z2;
      sTop = Math.max(a, b);
      sBot = Math.min(a, b);
    }

    // --- Señales ---
    const swingMid = validoS ? (sHigh + sLow) / 2 : null;
    const profundo = iSegundo;
    const alineadas = sTrend !== 0 && sTrend === iTrend;
    const alineadasBajista = sTrend === -1 && iTrend === -1;
    const alineadasAlcista = sTrend === 1 && iTrend === 1;

    const sellSignal =
      !senalDisparada && alineadasBajista && profundo !== null && swingMid !== null &&
      profundo > swingMid && high >= profundo;
    const buySignal =
      !senalDisparada && alineadasAlcista && profundo !== null && swingMid !== null &&
      profundo < swingMid && low <= profundo;

    let solapeInf = null, solapeSup = null, coinciden = false;

    if (iTop !== null && sTop !== null) {
      solapeInf = Math.max(sBot, iBot);
      solapeSup = Math.min(sTop, iTop);
      const solape = solapeSup - solapeInf;
      const menor = Math.min(sTop - sBot, iTop - iBot);
      coinciden = alineadas && solape >= 0 && solape >= (menor * cfg.solapePct) / 100;
    }

    const confSell = !confluenciaDisparada && coinciden && sTrend === -1 && high >= solapeInf;
    const confBuy = !confluenciaDisparada && coinciden && sTrend === 1 && low <= solapeSup;

    if (sellSignal || buySignal) senalDisparada = true;
    if (confSell || confBuy) confluenciaDisparada = true;

    const sellAny = sellSignal || confSell;
    const buyAny = buySignal || confBuy;

    const emitir = (side, entry, sl, tipo) => {
      const riesgo = Math.abs(entry - sl);
      const dir = side === "BUY" ? 1 : -1;

      salida.push({
        t: velas[i].t,
        side,
        tipo,
        entry: redondear(entry),
        sl: redondear(sl),
        tp: cfg.tp.map((r) => redondear(entry + dir * riesgo * r)),
      });
    };

    if (sellAny) {
      const entry = sellSignal ? profundo : solapeInf;
      const sl = iHigh !== null ? iHigh + cfg.slBuffer : null;

      if (entry !== null && sl !== null && sl > entry) {
        emitir("SELL", entry, sl, sellSignal ? "estructura" : "confluencia");
      }
    }

    if (buyAny) {
      const entry = buySignal ? profundo : solapeSup;
      const sl = iLow !== null ? iLow - cfg.slBuffer : null;

      if (entry !== null && sl !== null && sl < entry) {
        emitir("BUY", entry, sl, buySignal ? "estructura" : "confluencia");
      }
    }
  }

  return salida;
}

async function traerVelas() {
  const intervalo = process.env.TV_INTERVAL || "1min";
  const ms = TV_INTERVALOS[intervalo];

  if (!ms) throw new Error(`Intervalo no soportado: ${intervalo}`);
  if (!process.env.TWELVEDATA_KEY) throw new Error("Falta TWELVEDATA_KEY");

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", process.env.TV_SYMBOL || "XAU/USD");
  url.searchParams.set("interval", intervalo);
  url.searchParams.set("outputsize", process.env.TV_VELAS || "1500");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", process.env.TWELVEDATA_KEY);

  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));

  if (!r.ok || j.status === "error" || !Array.isArray(j.values)) {
    throw new Error(`Twelve Data: ${j.message || r.status}`);
  }

  const ahora = Date.now();

  const velas = j.values
    .map((v) => ({
      t: Date.parse(String(v.datetime).replace(" ", "T") + "Z"),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .filter((v) => Number.isFinite(v.t) && Number.isFinite(v.close))
    .sort((a, b) => a.t - b.t)
    .filter((v) => v.t + ms <= ahora); // descarta la vela en formación

  return { velas, ms, intervalo };
}

function mercadoAbierto() {
  const d = new Date();
  const dia = d.getUTCDay();
  const h = d.getUTCHours();

  if (dia === 6) return false;
  if (dia === 5 && h >= 22) return false;
  if (dia === 0 && h < 22) return false;

  return true;
}

let tvUltimaVela = null;
let tvOcupado = false;
let tvErrorAvisado = false;

async function revisarVelas() {
  if (tvOcupado || !mercadoAbierto()) return;

  tvOcupado = true;
  const dueño = String(process.env.OWNER_ID || "");

  try {
    const { velas, intervalo } = await traerVelas();

    if (velas.length < 100) throw new Error("Pocas velas para calcular");

    const senales = biasToolkit(velas, tvConfig());
    const ultimaT = velas[velas.length - 1].t;

    tvErrorAvisado = false;

    // Primera corrida: solo fija el punto de partida, no manda el historial.
    if (tvUltimaVela === null) {
      tvUltimaVela = ultimaT;
      return;
    }

    const nuevas = senales.filter((s) => s.t > tvUltimaVela);
    tvUltimaVela = ultimaT;

    // Seguro para la publicación automática: si el bot estuvo sin datos un rato,
    // no publica señales viejas. Edad máxima en minutos (TV_MAX_EDAD_MIN, 20 por defecto).
    const maxEdadMin = Number(process.env.TV_MAX_EDAD_MIN || 20);

    for (const s of nuevas) {
      if (Number.isFinite(maxEdadMin) && ultimaT - s.t > maxEdadMin * 60000) {
        console.error("Señal descartada por antigua:", new Date(s.t).toISOString());
        continue;
      }

      try {
        const lectura = {
          instrumento: "XAUUSD",
          direccion: s.side,
          entrada: s.entry,
          stop_loss: s.sl,
          take_profit_1: s.tp[0],
          take_profit_2: s.tp[1],
          take_profit_3: s.tp[2],
          precio_actual: null,
          varias_posiciones: false,
          observaciones: `Automática ${intervalo}, ${s.tipo}, vela ${new Date(s.t)
            .toISOString()
            .slice(11, 16)} UTC`,
        };

        const err = validar(lectura);

        if (err) {
          console.error("Señal descartada:", err);
          continue;
        }

        await entregar(
          dueño,
          armarSenal(lectura, { estado: estadoAuto(), origen: "automática" }),
          lectura,
          autoTV()
        );
      } catch (e) {
        // Un error en una señal no debe frenar las que siguen.
        console.error("Error entregando señal:", e.message);

        if (dueño) {
          await enviar(dueño, `Señal automática no entregada: ${e.message}`).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("Velas:", e.message);

    if (dueño && !tvErrorAvisado) {
      tvErrorAvisado = true;
      await enviar(dueño, `Señales automáticas: ${e.message}`).catch(() => {});
    }
  } finally {
    tvOcupado = false;
  }
}

function iniciarVelas() {
  if (!process.env.TWELVEDATA_KEY) {
    console.log("Señales por velas desactivadas (falta TWELVEDATA_KEY)");
    return;
  }

  const ms = TV_INTERVALOS[process.env.TV_INTERVAL || "1min"] || 60000;
  const cada = Math.max(ms, Number(process.env.TV_POLL_SEG || 120) * 1000);

  setTimeout(revisarVelas, 5000);
  setInterval(revisarVelas, cada);

  console.log(
    `Señales por velas activas (cada ${Math.round(cada / 1000)} s, publicación automática: ${autoTV() ? "SÍ" : "no"})`
  );
}

// Validación: lista las últimas señales que calcula el motor (hora UTC).
app.get("/velas/senales", async (req, res) => {
  if (!process.env.TRADINGVIEW_KEY || req.query.key !== process.env.TRADINGVIEW_KEY) {
    return res.status(403).send("forbidden");
  }

  try {
    const { velas, intervalo } = await traerVelas();
    const lista = biasToolkit(velas, tvConfig()).slice(-15);
    const hora = (t) => new Date(t).toISOString().replace("T", " ").slice(0, 16);

    const lineas = lista.map(
      (x) =>
        `${hora(x.t)} UTC | ${x.side} | ${x.tipo} | entrada ${x.entry} | SL ${x.sl} | TP ${x.tp.join(" / ")}`
    );

    res
      .type("text/plain")
      .send(
        `Velas: ${velas.length} (${intervalo}) de ${hora(velas[0].t)} a ${hora(
          velas[velas.length - 1].t
        )} UTC\n\n` + (lineas.join("\n") || "Sin señales en el período")
      );
  } catch (e) {
    res.status(500).send(e.message);
  }
});

iniciarVelas();
