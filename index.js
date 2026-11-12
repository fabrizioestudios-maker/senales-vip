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
(dirección, entrada, stop loss, TP1 y, si querés, TP2 y TP3)`;

const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => console.log(`Bot escuchando en puerto ${PORT}`));

async function setup(req, res) {
  if (!process.env.WEBHOOK_SECRET || req.query.key !== process.env.WEBHOOK_SECRET) {
    return res.status(403).send("forbidden");
  }
  const url = `\( {req.protocol}:// \){req.get("host")}/telegram`;
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
  const r = await fetch(`https://api.telegram.org/bot\( {process.env.TELEGRAM_BOT_TOKEN}/ \){method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

const enviar = (chat, text, extra = {}) =>
  tg("sendMessage", { chat_id: chat, text, disable_web_page_preview: true, ...extra });

function aHtml(texto) {
  const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*(.+?)\*/g, "<b>$1</b>");
}

async function procesar(update) {
  const dueño = String(process.env.OWNER_ID || "");
  try {
    if (update.callback_query) return await alTocarBoton(update.callback_query, dueño);
    const m = update.message;
    if (!m || !m.from) return;
    const uid = String(m.from.id);
    const texto = (m.text || m.caption || "").trim();

    if (/^\/(start|id)\b/i.test(texto)) {
      await enviar(
        m.chat.id,
        `Tu ID de Telegram: ${uid}\nID de este chat: ${m.chat.id}\nEl primero va como OWNER_ID; si este chat es el grupo VIP de Telegram, el segundo va como TELEGRAM_VIP_CHAT_ID.`,
      );
      return;
    }
    if (uid !== dueño) return;

    const foto = m.photo
      ? m.photo[m.photo.length - 1]
      : m.document && /^image\//.test(m.document.mime_type || "")
        ? m.document
        : null;
    if (foto) return await deImagen(m.chat.id, foto, m.caption || "");
    if (/^\/(s|senal|señal)\b/i.test(texto)) return await deTexto(m.chat.id, texto);
    await enviar(m.chat.id, AYUDA);
  } catch (e) {
    if (dueño) await enviar(dueño, `No pude armar la señal: ${e.message}`).catch(() => {});
  }
}

async function deImagen(chat, foto, caption) {
  await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
  const f = await tg("getFile", { file_id: foto.file_id });
  const resp = await fetch(`https://api.telegram.org/file/bot\( {process.env.TELEGRAM_BOT_TOKEN}/ \){f.file_path}`);
  if (!resp.ok) throw new Error("No pude bajar la imagen de Telegram");
  const buf = await resp.arrayBuffer();
  const mime = /\.png$/i.test(f.file_path) ? "image/png" : "image/jpeg";
  const lectura = await leerGrafico(aBase64(buf), mime);
  const ajustes = leerCaption(caption);
  await entregar(chat, armarSenal(lectura, ajustes), lectura);
}

async function deTexto(chat, texto) {
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
  await entregar(chat, armarSenal(lectura, { estado: p.estado }), lectura);
}

async function entregar(chat, senal, lectura) {
  const aviso = [];
  if (lectura.varias_posiciones) aviso.push("Había más de una posición en la imagen: usé la más reciente.");
  if (lectura.observaciones) aviso.push(`Nota de la lectura: ${lectura.observaciones}`);
  const resumen = `Lectura: ${senal.direccion} \( {senal.instrumento}\n \){senal.detalle}${aviso.length ? "\n" + aviso.join("\n") : ""}`;

  if ((process.env.MODO || "confirmar").toLowerCase() === "auto") {
    const res = await publicar(senal.texto);
    await enviar(chat, `\( {resumen}\n\n \){senal.texto}`);
    await enviar(chat, resultadoTexto(res));
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
  const responder = (t) => tg("answerCallbackQuery", { callback_query_id: cb.id, text: t }).catch(() => {});
  if (String(cb.from.id) !== dueño || !cb.message) return responder("No autorizado");
  const chat = cb.message.chat.id;
  const mid = cb.message.message_id;
  const quitarBotones = () =>
    tg("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [] } }).catch(() => {});

  if (cb.data === "cancel") {
    await responder("Cancelada");
    await quitarBotones();
    return;
  }
  if (cb.data !== "pub") return responder("");
  const texto = cb.message.text || "";
  if (!texto.startsWith(TITULO)) return responder("Mensaje no válido");
  const clave = `\( {chat}: \){mid}`;
  if (yaPublicados.has(clave)) return responder("Ya se publicó");
  yaPublicados.add(clave);
  await responder("Publicando...");
  await quitarBotones();
  const res = await publicar(texto);
  await enviar(chat, resultadoTexto(res));
}

const resultadoTexto = (res) =>
  res.map(([dest, ok, err]) => (ok ? `\( {dest}: publicada` : ` \){dest}: ERROR (${err})`)).join("\n");

async function publicar(texto) {
  const res = [];
  const chats = String(process.env.VIP_WHATSAPP_CHAT_ID || "").split(/[,\s;]+/).filter(Boolean);
  if (process.env.GREENAPI_ID && process.env.GREENAPI_TOKEN && chats.length) {
    const base = String(process.env.GREENAPI_URL || "https://api.green-api.com").replace(/\/+$/, "");
    for (const chatId of chats) {
      try {
        const r = await fetch(`\( {base}/waInstance \){process.env.GREENAPI_ID}/sendMessage/${process.env.GREENAPI_TOKEN}`, {
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
  if (process.env.TELEGRAM_VIP_CHAT_ID) {
    try {
      await enviar(process.env.TELEGRAM_VIP_CHAT_ID, aHtml(texto), { parse_mode: "HTML" });
      res.push(["Telegram VIP", true]);
    } catch (e) {
      res.push(["Telegram VIP", false, e.message]);
    }
  }
  if (!res.length) throw new Error("No hay destinos configurados (VIP_WHATSAPP_CHAT_ID / TELEGRAM_VIP_CHAT_ID)");
  return res;
}

function aBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gemini(modelo, b64, mime) {
  const cuerpo = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 1024 },
  });
  for (let intento = 0; intento < 2; intento++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: cuerpo,
    });
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
    if (r.status === 429 || r.status >= 500) await new Promise((r) => setTimeout(r, 1200 * (intento + 1)));
    else {
      const err = await r.text().catch(() => "");
      throw new Error(`Gemini ${r.status}: ${err.slice(0, 200)}`);
    }
  }
  throw new Error("Gemini falló después de reintentos");
}

async function leerGrafico(b64, mime) {
  const modelos = [
    process.env.GEMINI_MODEL || "gemini-2.0-flash",
    process.env.GEMINI_MODEL_2 || "gemini-1.5-flash",
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
  if (dir !== "BUY" && dir !== "SELL") return "Dirección inválida";
  const entrada = num(l.entrada);
  const sl = num(l.stop_loss);
  const tp1 = num(l.take_profit_1);
  if (entrada == null || sl == null || tp1 == null) return "Faltan entrada, SL o TP1";
  if (dir === "BUY" && !(sl < entrada && entrada < tp1)) return "Para BUY debe ser SL < Entrada < TP";
  if (dir === "SELL" && !(tp1 < entrada && entrada < sl)) return "Para SELL debe ser TP < Entrada < SL";
  return null;
}

function fmt(n) {
  if (n == null) return "";
  const d = process.env.DECIMALES;
  if (d && d !== "auto") return Number(n).toFixed(Number(d));
  return String(n);
}

function armarSenal(lectura, ajustes = {}) {
  const dir = (lectura.direccion || "").toUpperCase();
  const instrumento = (ajustes.instrumento || lectura.instrumento || process.env.INSTRUMENTO_DEFECTO || "XAUUSD").toUpperCase();
  const entrada = num(lectura.entrada);
  const sl = num(lectura.stop_loss);
  const tp1 = num(lectura.take_profit_1);
  const tp2 = num(lectura.take_profit_2);
  const tp3 = num(lectura.take_profit_3);

  let estado = (ajustes.estado || "LIMIT PENDIENTE").toUpperCase();
  if (ajustes.estado === "mercado") estado = "ACTIVA";

  let texto = `${TITULO}\n\n`;
  texto += `Instrumento: ${instrumento}\n`;
  texto += `Operación:  ${dir}\n`;
  texto += `Entrada: ${fmt(entrada)}\n`;
  texto += `Stop Loss: ${fmt(sl)}\n`;
  texto += `Take Profit : ${fmt(tp1)}`;
  if (tp2 != null) texto += `\nTake Profit 2: ${fmt(tp2)}`;
  if (tp3 != null) texto += `\nTake Profit 3: ${fmt(tp3)}`;
  texto += `\n\nESTADO: ${estado}\n\n`;
  texto += `\( {AVISO_RIESGO}\n\n \){AVISO_SL}\n\n${FIRMA}`;

  const detalle = `Entrada ${fmt(entrada)} | SL ${fmt(sl)} | TP ${fmt(tp1)}`;
  return { texto, direccion: dir, instrumento, detalle };
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
  if (/\bstop\b/.test(t)) out.estado = "STOP";
  const mInst = t.match(/\b([A-Z]{3,10}(?:USD|USDT|JPY|EUR|GBP)?)\b/i);
  if (mInst) out.instrumento = mInst[1].toUpperCase();
  return out;
}

function leerManual(texto) {
  const partes = texto.trim().split(/\s+/);
  const out = { nums: [], estado: "LIMIT PENDIENTE" };
  for (const p of partes.slice(1)) {
    const low = p.toLowerCase();
    if (low === "buy" || low === "sell") out.direccion = low.toUpperCase();
    else if (low === "mercado") out.estado = "mercado";
    else if (low === "limit") out.estado = "LIMIT PENDIENTE";
    else if (low === "stop") out.estado = "STOP";
    else if (/^[A-Za-z]{3,10}$/.test(p)) out.instrumento = p.toUpperCase();
    else {
      const n = num(p);
      if (n != null) out.nums.push(n);
    }
  }
  return out;
}
