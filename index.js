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
