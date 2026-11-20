// TRADING INSTITUCIONAL | Bot de señales VIP (Railway)
const express = require("express");
const crypto = require("crypto");
const Panel = require("./panel");
const app = express();
app.use(express.json({ limit: "10mb" }));

// Comparación en tiempo constante. Devuelve false si falta alguno de los dos valores
// (antes, con WEBHOOK_SECRET sin definir, "undefined !== undefined" dejaba pasar a cualquiera).
function igual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// fetch con tiempo máximo: un pedido colgado no debe trabar el bot (ni dejar tvOcupado en true).
const fetchT = (url, opts = {}, ms = 45000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

const TITULO = "*TRADING INSTITUCIONAL | SIGNALS VIP*";
const AVISO_RIESGO =
  "Recordá utilizar un riesgo máximo del 1% de tu capital en esta operación y calcular el tamaño de la posición según la distancia al Stop Loss.";
const AVISO_SL = "Respetá el Stop Loss y evitá aumentar el riesgo durante la operación.";
const FIRMA = "*Trading Institucional* 🏛📈";

const PROMPT = `Sos un lector de capturas de TradingView (modo oscuro). En la captura hay dibujada la herramienta "posición larga/corta".

La herramienta son DOS rectángulos apilados que comparten un borde horizontal, que es la ENTRADA:
- un rectángulo marrón/naranja translúcido (o verde, según el tema): la zona de ganancia (va hacia el take profit);
- un rectángulo gris azulado (o rojo, según el tema): la zona de pérdida (va hacia el stop loss).
Dirección:
- zona de ganancia ARRIBA de la entrada y zona de pérdida ABAJO = "BUY" (take profit arriba, stop loss abajo);
- zona de pérdida ARRIBA de la entrada y zona de ganancia ABAJO = "SELL" (stop loss arriba, take profit abajo).
- Los colores pueden estar invertidos o cambiados. NO te guíes por el color: si el stop loss está ARRIBA de la entrada es "SELL"; si está ABAJO es "BUY".
Niveles: el borde del rectángulo de ganancia que está más lejos de la entrada es el take_profit_1; el borde del de pérdida más lejos de la entrada es el stop_loss; el borde que comparten es la entrada.

Precios: cada nivel de la herramienta tiene pegada, junto a su borde derecho, una etiqueta gris redondeada con el precio (con un circulito). Usá exactamente esos valores. Si no se ven, leé el precio en la escala de la derecha según la posición vertical del borde. Ignorá las demás etiquetas de la escala y las líneas o textos de indicadores (por ejemplo LQ, POI, TARGET, 0.7).
- precio_actual: el último precio, que es la etiqueta de la escala derecha con cuenta regresiva (mm:ss) o resaltada. Si no se distingue, null.
- take_profit_2 y take_profit_3: solo si hay líneas o textos rotulados "TP2" o "TP3" en el gráfico. Si no, null.
- instrumento: el símbolo que aparece en la captura (por ejemplo XAUUSD), sin espacios ni barras. Si no se lee, "".
- Si hay más de una herramienta de posición, usá la más reciente (la más a la derecha) y poné varias_posiciones en true.

Escribí los números con punto decimal y sin separador de miles (por ejemplo 4042.89). No inventes ni redondees valores: si no podés leer un dato con certeza, poné null y explicalo en "observaciones".

Devolvé SOLO un JSON válido con estas claves:
{"instrumento": "", "direccion": "BUY" | "SELL" | "", "entrada": 0, "stop_loss": 0, "take_profit_1": 0, "take_profit_2": null, "take_profit_3": null, "precio_actual": null, "varias_posiciones": false, "observaciones": ""}`;

const AYUDA = `Mandame la captura de TradingView con la herramienta de posición (mejor como foto, con la herramienta seleccionada para que se vean los precios) y armo la señal. Se publica automáticamente en los grupos VIP.

Opcional, en el texto de la foto:
tp2 4060 tp3 4070 (más take profits)
mercado, limit o stop (cambia el ESTADO)
GBPUSD (cambia el instrumento)

Sin imagen:
/s buy 4043 4039 4054
/s sell 4026 4031 4016 4010 mercado
(dirección, entrada, stop loss, TP1 y, si querés, TP2 y TP3)\n\n/grupos (lista tus grupos de WhatsApp con su ID)\n\n/analizar (o el botón): busca entradas con Bias Toolkit V.3`;

// Botón "Analizar entradas" (también con /menu o /analizar)
const TECLADO_MENU = {
  inline_keyboard: [
    [{ text: "🔍 Analizar entradas", callback_data: "analizar" }],
    [{ text: "Ajustes", callback_data: "p:m" }],
  ],
};

const PORT = process.env.PORT || 3000;

// Publicación automática de las señales que genera el bot solo
// (alertas de TradingView y señales por velas).
const autoTV = () =>
  ["1", "true", "si", "sí", "on"].includes(String(process.env.AUTO_TV || "").toLowerCase());

// Estado por defecto de las señales automáticas: la entrada ya se tocó
// cuando se dispara la señal, por eso sale como ACTIVA.
const estadoAuto = () => process.env.ESTADO_TV || "mercado";

app.get("/", (req, res) => res.send("Bot de señales activo"));
app.get("/setup", setup);

app.post("/telegram", async (req, res) => {
  const secret = req.headers["x-telegram-bot-api-secret-token"];

  if (!igual(secret, process.env.WEBHOOK_SECRET)) {
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

// Antirrebote: true si la misma clave ya se vio dentro de la ventana (en ms).
function repetida(clave, ventanaMs) {
  const ahora = Date.now();

  // Limpia entradas viejas para que el Map no crezca sin límite.
  for (const [k, t] of tvRecientes) {
    if (ahora - t > 600000) tvRecientes.delete(k);
  }

  if (ahora - (tvRecientes.get(clave) || 0) < ventanaMs) return true;

  tvRecientes.set(clave, ahora);
  return false;
}

app.post("/tradingview", express.text({ type: "*/*", limit: "100kb" }), async (req, res) => {
  if (!igual(req.query.key, process.env.TRADINGVIEW_KEY)) {
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

    if (repetida(clave, 120000)) return;

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
  if (!igual(req.query.key, process.env.TRADINGVIEW_KEY)) {
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

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

async function setup(req, res) {
  // Clave propia para /setup (SETUP_KEY). Si no existe, usa WEBHOOK_SECRET como antes.
  const claveSetup = process.env.SETUP_KEY || process.env.WEBHOOK_SECRET;

  if (!process.env.WEBHOOK_SECRET || !igual(req.query.key, claveSetup)) {
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
  const r = await fetchT(
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

    if (/^\/analizar\b/i.test(texto)) {
      return await analizarSeguro(m.chat.id);
    }

    if (/^\/menu\b/i.test(texto)) {
      return await enviar(m.chat.id, "Panel de señales:", { reply_markup: TECLADO_MENU });
    }

    if (/^\/panel\b/i.test(texto)) {
      return await Panel.abrir(m.chat.id);
    }

    if (await Panel.alTexto(m, texto)) return;

    await enviar(m.chat.id, AYUDA, { reply_markup: TECLADO_MENU });
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

  const resp = await fetchT(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`
  );

  if (!resp.ok) {
    throw new Error("No pude bajar la imagen de Telegram");
  }

  const buf = await resp.arrayBuffer();
  const ext = ((f.file_path.match(/\.(\w+)$/) || [])[1] || "").toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const lectura = await leerGrafico(aBase64(buf), mime);
  const ajustes = leerCaption(caption);

  // TP2 y TP3 del texto de la foto pasan a la lectura para validarlos junto con el resto.
  if (ajustes.tp2 != null) lectura.take_profit_2 = num(ajustes.tp2);
  if (ajustes.tp3 != null) lectura.take_profit_3 = num(ajustes.tp3);
  delete ajustes.tp2;
  delete ajustes.tp3;

  // La dirección sale de los niveles, no de lo que diga el modelo.
  const e = num(lectura.entrada);
  const sl = num(lectura.stop_loss);

  if (e != null && sl != null && e !== sl) {
    const dirNiveles = sl > e ? "SELL" : "BUY";

    if ((lectura.direccion || "").toUpperCase() !== dirNiveles) {
      lectura.observaciones =
        `${lectura.observaciones || ""} Dirección corregida a ${dirNiveles} según los niveles.`.trim();
    }

    lectura.direccion = dirNiveles;
  }

  // Si la lectura es incoherente no se publica nada.
  const err = validar(lectura);
  if (err) {
    throw new Error(`Lectura inconsistente (${err}). No publiqué nada.`);
  }

  // Si la entrada está lejos del precio actual que se ve en la captura, casi siempre es un dígito mal leído.
  // MAX_DIST_PRECIO_PCT (2 por defecto); con 0 se desactiva.
  const precio = num(lectura.precio_actual);
  const rawMax = process.env.MAX_DIST_PRECIO_PCT;
  const maxPrecio = rawMax !== undefined && rawMax !== "" && Number.isFinite(Number(rawMax)) ? Number(rawMax) : 2;

  if (maxPrecio > 0 && precio != null && precio > 0) {
    const pct = (Math.abs(num(lectura.entrada) - precio) / precio) * 100;

    if (pct > maxPrecio) {
      throw new Error(
        `La entrada (${lectura.entrada}) está a ${pct.toFixed(1)}% del precio actual leído (${precio}): posible error de lectura. No publiqué nada.`
      );
    }
  }

  const claveFoto = [
    "foto",
    ajustes.instrumento || lectura.instrumento,
    lectura.direccion,
    lectura.entrada,
    lectura.stop_loss,
    lectura.take_profit_1,
  ].join("|");

  if (repetida(claveFoto, 120000)) {
    throw new Error("Señal repetida: la misma lectura salió hace menos de 2 minutos. No la publiqué de nuevo.");
  }

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

  const claveTexto = ["texto", lectura.instrumento, lectura.direccion, entrada, sl, tp1].join("|");

  if (repetida(claveTexto, 120000)) {
    throw new Error("Señal repetida: la misma señal salió hace menos de 2 minutos. No la publiqué de nuevo.");
  }

  await entregar(chat, armarSenal(lectura, { estado: p.estado, origen: "manual" }), lectura);
}

// directo = true  -> publica en los canales VIP sin pedir confirmación.
// directo = false -> pide confirmación con botones (señales automáticas con AUTO_TV apagado).
// directo = null  -> decide MODO (señales manuales): "auto" por defecto publica directo; MODO=confirmar pide botón.
async function entregar(chat, senal, lectura, directo = null) {
  const aviso = [];

  if (lectura.varias_posiciones) {
    aviso.push("Había más de una posición en la imagen: usé la más reciente.");
  }

  if (lectura.observaciones) {
    aviso.push(`Nota de la lectura: ${lectura.observaciones}`);
  }

  const resumen = `Lectura: ${senal.direccion} ${senal.instrumento}\n${senal.detalle}${aviso.length ? "\n" + aviso.join("\n") : ""}`;

  const publicarYa = directo !== null ? directo : (process.env.MODO || "auto").toLowerCase() === "auto";

  if (publicarYa) {
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

  if (String(cb.data || "").startsWith("p:")) return Panel.alBoton(cb);

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

  if (cb.data === "analizar") {
    await responder("Analizando...");
    await analizarSeguro(chat);
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

  let res;

  try {
    res = await publicar(texto);
  } catch (e) {
    // Si falla, se libera para poder reintentar reenviando la señal.
    yaPublicados.delete(clave);
    await enviar(chat, `No se pudo publicar: ${e.message}. Reenviá la señal para reintentar.`);
    return;
  }

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

// Sin repetidos: el mismo chat dos veces gastaría cupo de Green API.
const listaChats = (variable) => [
  ...new Set(
    String(process.env[variable] || "")
      .split(/[,\s;]+/)
      .filter(Boolean)
  ),
];

async function waEnviar(chatId, texto) {
  const r = await fetchT(
    `${waBase()}/waInstance${process.env.GREENAPI_ID}/sendMessage/${process.env.GREENAPI_TOKEN}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, message: texto }),
    }
  );

  const j = await r.json().catch(() => ({}));

  if (!r.ok || !j.idMessage) {
    if (r.status === 466) {
      throw new Error("Green API 466: límite del plan Developer (3 chats por mes), hace falta el plan Business");
    }

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

      await pausa(1500);
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

        await pausa(1500);
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

  // group=true: solo grupos (sin el filtro devuelve todos los contactos, que puede ser enorme).
  const r = await fetchT(
    `${waBase()}/waInstance${process.env.GREENAPI_ID}/getContacts/${process.env.GREENAPI_TOKEN}?group=true`
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
  return Buffer.from(buf).toString("base64");
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
    const r = await fetchT(
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
  const tp2 = num(l.take_profit_2);
  const tp3 = num(l.take_profit_3);

  if (entrada == null || sl == null || tp1 == null) {
    return "Faltan entrada, SL o TP1";
  }

  if (entrada <= 0) {
    return "Entrada inválida";
  }

  if (dir === "BUY" && !(sl < entrada && entrada < tp1)) {
    return "Para BUY debe ser SL < Entrada < TP";
  }

  if (dir === "SELL" && !(tp1 < entrada && entrada < sl)) {
    return "Para SELL debe ser TP < Entrada < SL";
  }

  // TP2 y TP3, si existen, tienen que estar del lado de la ganancia.
  for (const tp of [tp2, tp3]) {
    if (tp == null) continue;

    if (dir === "BUY" && !(tp > entrada)) return "Para BUY los TP deben estar sobre la entrada";
    if (dir === "SELL" && !(tp < entrada)) return "Para SELL los TP deben estar bajo la entrada";
  }

  // TP1, TP2 y TP3 tienen que alejarse de la entrada en ese orden.
  const cadena = [tp1, tp2, tp3].filter((x) => x != null);

  for (let i = 1; i < cadena.length; i++) {
    if (dir === "BUY" ? cadena[i] <= cadena[i - 1] : cadena[i] >= cadena[i - 1]) {
      return "Los take profits deben alejarse de la entrada en orden (TP1, TP2, TP3)";
    }
  }

  // Control de cordura: un nivel muy lejos de la entrada suele ser un dígito mal leído.
  const maxPct = Number(process.env.MAX_DIST_PCT || 3);

  for (const n of [sl, tp1, tp2, tp3]) {
    if (n == null) continue;

    if ((Math.abs(n - entrada) / entrada) * 100 > maxPct) {
      return `El nivel ${n} está demasiado lejos de la entrada (posible error de lectura)`;
    }
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

  const instrumento =
    String(
      ajustes.instrumento ||
        lectura.instrumento ||
        process.env.INSTRUMENTO_DEFECTO ||
        "XAUUSD"
    )
      .replace(/^.*:/, "")
      .replace(/[^A-Za-z0-9._]/g, "")
      .toUpperCase() || "XAUUSD";

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
    // "nivel": entra en el 0.7 / zona de confluencia (como hasta ahora). "close": cierre de la vela, igual que el webhook del Pine.
    entrada: String(process.env.TV_ENTRY || "nivel").toLowerCase() === "close" ? "close" : "nivel",
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

// Estado de una estructura (swing o interna). Mismos campos que el tipo Structure del Pine.
function nuevaEstructura() {
  return {
    hi: null, lo: null, hiBar: null, loBar: null,
    hiFija: false, loFija: false, trend: 0,
    ultPH: null, ultPL: null, ultPHBar: null, ultPLBar: null,
    brkBar: null,
  };
}

// Port línea por línea de f_updateStructure del Pine. Devuelve true si se abrió un rango nuevo.
function actualizarEstructura(s, i, v, pivH, pivL, len, srcUp, srcDn, permiteContinuar, tick) {
  let nuevoRango = false;

  if (pivH !== null) {
    s.ultPH = pivH;
    s.ultPHBar = i - len;

    if (s.trend === 0) {
      s.hi = pivH; s.hiBar = s.ultPHBar; s.hiFija = true;
    } else if (s.trend === 1 && pivH >= s.hi - tick) {
      s.hi = pivH; s.hiBar = s.ultPHBar; s.hiFija = true;
    }
  }

  if (pivL !== null) {
    s.ultPL = pivL;
    s.ultPLBar = i - len;

    if (s.trend === 0) {
      s.lo = pivL; s.loBar = s.ultPLBar; s.loFija = true;
    } else if (s.trend === -1 && pivL <= s.lo + tick) {
      s.lo = pivL; s.loBar = s.ultPLBar; s.loFija = true;
    }
  }

  let bull = s.hi !== null && srcUp > s.hi && (s.trend <= 0 || (permiteContinuar && s.hiFija));
  let bear = s.lo !== null && srcDn < s.lo && (s.trend >= 0 || (permiteContinuar && s.loFija));

  if (bull && bear) {
    bull = v.close >= v.open;
    bear = !bull;
  }

  if (bull) {
    s.trend = 1;

    if (s.ultPL !== null && s.ultPLBar < i) {
      s.lo = s.ultPL; s.loBar = s.ultPLBar; s.loFija = true;
    }

    s.hi = v.high; s.hiBar = i; s.hiFija = false;
    s.brkBar = i;
    nuevoRango = true;
  } else if (bear) {
    s.trend = -1;

    if (s.ultPH !== null && s.ultPHBar < i) {
      s.hi = s.ultPH; s.hiBar = s.ultPHBar; s.hiFija = true;
    }

    s.lo = v.low; s.loBar = i; s.loFija = false;
    s.brkBar = i;
    nuevoRango = true;
  }

  if (s.trend === 1 && (s.hi === null || v.high > s.hi)) {
    if (s.ultPL !== null && s.hiBar !== null && s.ultPLBar > s.hiBar) {
      s.lo = s.ultPL; s.loBar = s.ultPLBar; s.loFija = true;
      s.brkBar = i;
      nuevoRango = true;
    }

    s.hi = v.high; s.hiBar = i; s.hiFija = false;
  }

  if (s.trend === -1 && (s.lo === null || v.low < s.lo)) {
    if (s.ultPH !== null && s.loBar !== null && s.ultPHBar > s.loBar) {
      s.hi = s.ultPH; s.hiBar = s.ultPHBar; s.hiFija = true;
      s.brkBar = i;
      nuevoRango = true;
    }

    s.lo = v.low; s.loBar = i; s.loFija = false;
  }

  return nuevoRango;
}

// Zona dorada de una estructura (f_zoneBounds del Pine). p2 es el nivel del ratio mayor (0.7).
function zonaDorada(s, z1, z2) {
  if (s.trend === 0 || s.hi === null || s.lo === null || !(s.hi > s.lo)) return null;

  const rng = s.hi - s.lo;
  const p1 = s.trend === 1 ? s.hi - rng * z1 : s.lo + rng * z1;
  const p2 = s.trend === 1 ? s.hi - rng * z2 : s.lo + rng * z2;

  return { top: Math.max(p1, p2), bot: Math.min(p1, p2), p2 };
}

// Señales de Bias Toolkit V.2. Replica la lógica del indicador Pine (estructura swing + interna,
// señal por estructura y por confluencia de zonas, una sola señal por rango, sin señales en la misma
// vela de una ruptura). Si cambiás el Pine, cambiá esto igual.
function biasToolkit(velas, cfg) {
  const z1 = Math.min(cfg.zonaA, cfg.zonaB);
  const z2 = Math.max(cfg.zonaA, cfg.zonaB);
  const altos = velas.map((v) => v.high);
  const bajos = velas.map((v) => v.low);
  const redondear = (x) => Number(x.toFixed(cfg.decimales));

  const sw = nuevaEstructura();
  const it = nuevaEstructura();

  let estructuraUsada = false;
  let confluenciaUsada = false;

  const salida = [];

  for (let i = 0; i < velas.length; i++) {
    const v = velas[i];
    const srcUp = cfg.mecha ? v.high : v.close;
    const srcDn = cfg.mecha ? v.low : v.close;

    const nuevoSw = actualizarEstructura(
      sw, i, v,
      pivote(altos, i, cfg.swingLen, true), pivote(bajos, i, cfg.swingLen, false),
      cfg.swingLen, srcUp, srcDn, true, cfg.mintick
    );

    const nuevoIt = actualizarEstructura(
      it, i, v,
      pivote(altos, i, cfg.internalLen, true), pivote(bajos, i, cfg.internalLen, false),
      cfg.internalLen, srcUp, srcDn, false, cfg.mintick
    );

    // Solo un rango nuevo libera otra señal (no cualquier máximo o mínimo nuevo).
    if (nuevoSw || nuevoIt) {
      estructuraUsada = false;
      confluenciaUsada = false;
    }

    const zi = zonaDorada(it, z1, z2);
    const zs = zonaDorada(sw, z1, z2);
    const alineadas = sw.trend !== 0 && sw.trend === it.trend;
    const asentada = i > Math.max(sw.brkBar ?? 0, it.brkBar ?? 0);
    const swMid = sw.hi !== null && sw.lo !== null ? (sw.hi + sw.lo) / 2 : null;
    const p2 = zi ? zi.p2 : null;

    const structSell =
      alineadas && it.trend === -1 && p2 !== null && swMid !== null && p2 > swMid && v.high >= p2;
    const structBuy =
      alineadas && it.trend === 1 && p2 !== null && swMid !== null && p2 < swMid && v.low <= p2;

    let ovTop = null, ovBot = null, solapan = false;

    if (zi && zs) {
      ovTop = Math.min(zs.top, zi.top);
      ovBot = Math.max(zs.bot, zi.bot);

      const alto = ovTop - ovBot;
      const menor = Math.min(zs.top - zs.bot, zi.top - zi.bot);

      solapan = alineadas && alto > 0 && menor > 0 && (alto / menor) * 100 >= cfg.solapePct;
    }

    const confSell = solapan && it.trend === -1 && v.high >= ovBot && v.low <= ovTop;
    const confBuy = solapan && it.trend === 1 && v.low <= ovTop && v.high >= ovBot;

    const sellEstr = structSell && !estructuraUsada && asentada;
    const buyEstr = structBuy && !estructuraUsada && asentada;
    const sellConf = confSell && !confluenciaUsada && asentada;
    const buyConf = confBuy && !confluenciaUsada && asentada;

    if (sellEstr || buyEstr) estructuraUsada = true;
    if (sellConf || buyConf) confluenciaUsada = true;

    const esBuy = buyEstr || buyConf;
    const esSell = sellEstr || sellConf;

    if (!esBuy && !esSell) continue;

    const porEstructura = esBuy ? buyEstr : sellEstr;
    const nivel = porEstructura ? p2 : esBuy ? ovTop : ovBot;
    const entry = cfg.entrada === "close" ? v.close : nivel;
    const sl = esBuy ? it.lo - cfg.slBuffer : it.hi + cfg.slBuffer;

    if (esBuy ? !(sl < entry) : !(sl > entry)) continue;

    const riesgo = Math.abs(entry - sl);
    const dir = esBuy ? 1 : -1;

    salida.push({
      t: v.t,
      side: esBuy ? "BUY" : "SELL",
      tipo: porEstructura ? "estructura" : "confluencia",
      entry: redondear(entry),
      sl: redondear(sl),
      tp: cfg.tp.map((r) => redondear(entry + dir * riesgo * r)),
    });
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

  const r = await fetchT(url);
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
    const ultimoCierre = velas[velas.length - 1].close;

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

      // Si el precio ya tocó el SL o el TP1 desde que se generó la señal, no se publica.
      const yaTocada =
        (s.side === "BUY" && (ultimoCierre <= s.sl || ultimoCierre >= s.tp[0])) ||
        (s.side === "SELL" && (ultimoCierre >= s.sl || ultimoCierre <= s.tp[0]));

      if (yaTocada) {
        console.error(
          "Señal descartada: el precio ya tocó SL o TP1",
          new Date(s.t).toISOString(),
          `cierre ${ultimoCierre}`
        );
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

let tvTimer = null;

function iniciarVelas() {
  if (!process.env.TWELVEDATA_KEY) {
    console.log("Señales por velas desactivadas (falta TWELVEDATA_KEY)");
    return;
  }

  const ms = TV_INTERVALOS[process.env.TV_INTERVAL || "1min"] || 60000;
  // 180 s por defecto: ~480 consultas por día de mercado, dentro del cupo gratis de Twelve Data (800).
  const cada = Math.max(ms, Number(process.env.TV_POLL_SEG || 180) * 1000);

  setTimeout(revisarVelas, 5000);
  clearInterval(tvTimer);
  tvTimer = setInterval(revisarVelas, cada);

  console.log(
    `Señales por velas activas (cada ${Math.round(cada / 1000)} s, publicación automática: ${autoTV() ? "SÍ" : "no"})`
  );
}

// Validación: lista las últimas señales que calcula el motor (hora UTC).
app.get("/velas/senales", async (req, res) => {
  if (!igual(req.query.key, process.env.TRADINGVIEW_KEY)) {
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

// =====================================================================
// BIAS TOOLKIT V.3 (lo usa el botón "Analizar entradas")
// =====================================================================

async function traerVelasDe(intervalo, cantidad) {
  const ms = TV_INTERVALOS[intervalo];

  if (!ms) throw new Error(`Intervalo no soportado: ${intervalo}`);
  if (!process.env.TWELVEDATA_KEY) throw new Error("Falta TWELVEDATA_KEY");

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", process.env.TV_SYMBOL || "XAU/USD");
  url.searchParams.set("interval", intervalo);
  url.searchParams.set("outputsize", String(cantidad));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", process.env.TWELVEDATA_KEY);

  const r = await fetchT(url);
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
    .filter((v) => v.t + ms <= ahora);

  return { velas, ms, intervalo };
}

function v3Config() {
  const n = (k, d) => {
    const v = process.env[k];
    return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d;
  };
  const s = (k, d) => String(process.env[k] || d).toLowerCase();

  return {
    swingLen: n("V3_SWING", 50),
    internalLen: n("V3_INTERNAL", 5),
    lqMax: n("V3_LQ_MAX", 10),
    lqWindow: n("V3_LQ_VENTANA", 30),
    lqCierre: s("V3_LQ_SWEEP", "mecha") === "cierre",
    planInterno: s("V3_RANGO", "swing") === "internal",
    entradaFib: s("V3_ENTRADA", "lq") === "fib",
    tpObjetivo: s("V3_TP", "equilibrium") === "objetivo",
    entryRatio: n("V3_ENTRY_RATIO", 0.7),
    fib2: n("V3_FIB2", 0.618),
    slBuffer: n("V3_SL_BUFFER", 0),
    fAlinear: s("V3_F_ALINEACION", "1") !== "0",
    fHtf: s("V3_F_HTF", "1") !== "0",
    fZona: s("V3_F_ZONA", "1") !== "0",
    htf: process.env.V3_HTF || "15min",
    htfInterno: s("V3_HTF_ESTRUCTURA", "internal") !== "swing",
    decimales: n("TV_DECIMALES", 2),
  };
}

// Pierna (leg) de LuxAlgo. Devuelve el cambio de pierna: 1 = pivote bajo, -1 = pivote alto.
function v3Leg(velas, i, len, est) {
  const c = i - len;

  if (c >= 0) {
    let max = -Infinity;
    let min = Infinity;

    for (let k = i - len + 1; k <= i; k++) {
      if (velas[k].high > max) max = velas[k].high;
      if (velas[k].low < min) min = velas[k].low;
    }

    if (velas[c].high > max) est.leg = 0;
    else if (velas[c].low < min) est.leg = 1;
  }

  const cambio = est.leg - est.prev;
  est.prev = est.leg;
  return cambio;
}

// Tendencia de estructura del timeframe superior (f_structureBias del Pine).
function v3BiasEstructura(velas, len) {
  const leg = { leg: 0, prev: 0 };
  let hi = null, lo = null, hiAnt = null, loAnt = null;
  let hiCr = false, loCr = false, bias = 0;

  for (let i = 0; i < velas.length; i++) {
    const cambio = v3Leg(velas, i, len, leg);

    if (cambio === 1) { lo = velas[i - len].low; loCr = false; }
    else if (cambio === -1) { hi = velas[i - len].high; hiCr = false; }

    const c = velas[i].close;
    const cp = i > 0 ? velas[i - 1].close : null;
    const up = hi !== null && hiAnt !== null && cp !== null && c > hi && cp <= hiAnt;
    const dn = lo !== null && loAnt !== null && cp !== null && c < lo && cp >= loAnt;

    if (up && !hiCr) { hiCr = true; bias = 1; }
    if (dn && !loCr) { loCr = true; bias = -1; }

    hiAnt = hi;
    loAnt = lo;
  }

  return bias;
}

// Motor de estructura de Bias Toolkit V.3 (LuxAlgo + LQ + PROTEGIDO/OBJETIVO + zona 0.618).
function biasV3(velas, cfg) {
  const piv = () => ({ lvl: null, ant: null, crossed: false, idx: null });
  const sH = piv(), sL = piv(), iH = piv(), iL = piv();
  const swT = { bias: 0 }, inT = { bias: 0 };
  const tr = { top: null, bottom: null };
  const itr = { top: null, bottom: null };
  const legSw = { leg: 0, prev: 0 };
  const legIn = { leg: 0, prev: 0 };
  const lqs = [];

  let roleOverride = 0, lqHighBar = null, lqLowBar = null;
  let zoneTouched = false, planBias = 0, planTop = null, planBottom = null;
  let dirNow = 0, hiNow = null, loNow = null;

  const addLq = (pv, esAlto) => {
    const ultimo = esAlto ? lqHighBar : lqLowBar;

    if (pv.lvl !== null && pv.idx !== null && (ultimo ?? -1) !== pv.idx) {
      lqs.push({ lvl: pv.lvl, side: esAlto ? 1 : -1, neut: -1 });
      while (lqs.length > cfg.lqMax) lqs.shift();

      if (esAlto) lqHighBar = pv.idx;
      else lqLowBar = pv.idx;
    }
  };

  for (let i = 0; i < velas.length; i++) {
    const v = velas[i];
    const cp = i > 0 ? velas[i - 1].close : null;

    // 1) extremos (trailing)
    for (const t of [tr, itr]) {
      if (t.top !== null && v.high >= t.top) t.top = v.high;
      if (t.bottom !== null && v.low <= t.bottom) t.bottom = v.low;
    }

    // 2) pivotes
    const pivotes = (len, leg, pH, pL, t) => {
      const cambio = v3Leg(velas, i, len, leg);

      if (cambio === 1) {
        pL.lvl = velas[i - len].low; pL.crossed = false; pL.idx = i - len;
        t.bottom = pL.lvl;
      } else if (cambio === -1) {
        pH.lvl = velas[i - len].high; pH.crossed = false; pH.idx = i - len;
        t.top = pH.lvl;
      }
    };

    pivotes(cfg.swingLen, legSw, sH, sL, tr);
    pivotes(cfg.internalLen, legIn, iH, iL, itr);

    // 3) BOS / CHoCH (primero interna, después swing)
    const estructura = (interna) => {
      const hi = interna ? iH : sH;
      const lo = interna ? iL : sL;
      const T = interna ? inT : swT;

      const cruzaArriba =
        hi.lvl !== null && hi.ant !== null && cp !== null && v.close > hi.lvl && cp <= hi.ant;
      const extraH = interna ? iH.lvl !== sH.lvl : true;

      if (cruzaArriba && !hi.crossed && extraH) {
        const tag = T.bias === -1 ? "CHOCH" : "BOS";
        hi.crossed = true;
        T.bias = 1;

        if (interna && tag === "BOS") { roleOverride = 1; addLq(iL, false); }
        else roleOverride = 0;
      }

      const cruzaAbajo =
        lo.lvl !== null && lo.ant !== null && cp !== null && v.close < lo.lvl && cp >= lo.ant;
      const extraL = interna ? iL.lvl !== sL.lvl : true;

      if (cruzaAbajo && !lo.crossed && extraL) {
        const tag = T.bias === 1 ? "CHOCH" : "BOS";
        lo.crossed = true;
        T.bias = -1;

        if (interna && tag === "BOS") { roleOverride = -1; addLq(iH, true); }
        else roleOverride = 0;
      }
    };

    estructura(true);
    estructura(false);

    // 4) neutralización de LQ
    for (const q of lqs) {
      if (q.neut >= 0) continue;
      const alto = q.side === 1;
      const barrido = cfg.lqCierre
        ? (alto ? v.close > q.lvl : v.close < q.lvl)
        : (alto ? v.high > q.lvl : v.low < q.lvl);

      if (barrido) q.neut = i;
    }

    // 5) rango y dirección del plan + "precio llegó al 0.618"
    const roleBias = roleOverride !== 0 ? roleOverride : swT.bias;
    const dir = cfg.planInterno ? inT.bias : roleBias;
    const hi = cfg.planInterno ? itr.top : tr.top;
    const lo = cfg.planInterno ? itr.bottom : tr.bottom;

    if (dir !== planBias || (hi ?? -1) !== (planTop ?? -1) || (lo ?? -1) !== (planBottom ?? -1)) {
      zoneTouched = false;
      planBias = dir;
      planTop = hi;
      planBottom = lo;
    }

    if (dir !== 0 && hi !== null && lo !== null && hi > lo) {
      const rng = hi - lo;
      const ratio = Math.min(cfg.fib2, cfg.entryRatio);
      const toco = dir === 1 ? v.low <= hi - rng * ratio : v.high >= lo + rng * ratio;
      zoneTouched = zoneTouched || toco;
    }

    dirNow = dir; hiNow = hi; loNow = lo;

    for (const p of [sH, sL, iH, iL]) p.ant = p.lvl;
  }

  return {
    swBias: swT.bias, inBias: inT.bias,
    roleBias: roleOverride !== 0 ? roleOverride : swT.bias,
    dir: dirNow, hi: hiNow, lo: loNow,
    swHi: tr.top, swLo: tr.bottom,
    zoneTouched, lqs,
  };
}

// Plan de operación (entrada en LQ o Fib, SL en el extremo PROTEGIDO, TP en Equilibrium u OBJETIVO).
function planV3(est, velas, cfg, htf) {
  const ult = velas.length - 1;
  const cierre = velas[ult].close;
  const { dir, hi, lo } = est;

  const alineadas = est.swBias !== 0 && est.swBias === est.inBias;
  const swingFavor = est.swBias !== 0 && est.swBias === dir;

  const r = {
    okAlin: !cfg.fAlinear || (cfg.entradaFib ? alineadas : swingFavor),
    okHtf: !cfg.fHtf || !htf.disponible || (htf.bias !== 0 && htf.bias === dir),
    okZona: !cfg.fZona || est.zoneTouched,
    lq: null,
    plan: null,
  };

  if (dir === 0 || hi === null || lo === null || !(hi > lo)) return r;

  const largo = dir === 1;
  const sl = largo ? lo - cfg.slBuffer : hi + cfg.slBuffer;
  const tp = cfg.tpObjetivo ? (largo ? hi : lo) : (hi + lo) / 2;
  const enRango = (lv) => (largo ? lv > sl && lv < tp : lv < sl && lv > tp);

  let entrada = null;
  let activada = false;

  if (!cfg.entradaFib) {
    const lado = largo ? -1 : 1;
    let mejor = -1;
    let mejorNb = -1;

    est.lqs.forEach((q, k) => {
      if (q.side === lado && q.neut >= 0 && ult - q.neut <= cfg.lqWindow && enRango(q.lvl) && q.neut > mejorNb) {
        mejor = k;
        mejorNb = q.neut;
      }
    });

    if (mejor === -1) {
      let mejorDist = null;

      est.lqs.forEach((q, k) => {
        if (q.side === lado && q.neut < 0 && enRango(q.lvl)) {
          const d = Math.abs(q.lvl - cierre);

          if (mejorDist === null || d < mejorDist) {
            mejor = k;
            mejorDist = d;
          }
        }
      });
    }

    r.lq = mejor >= 0;

    if (mejor >= 0) {
      entrada = est.lqs[mejor].lvl;
      activada = est.lqs[mejor].neut >= 0;
    }
  } else {
    entrada = largo ? hi - (hi - lo) * cfg.entryRatio : lo + (hi - lo) * cfg.entryRatio;
    activada = largo ? cierre <= entrada : cierre >= entrada;
  }

  if (entrada !== null && enRango(entrada)) {
    const f = (x) => Number(x.toFixed(cfg.decimales));
    r.plan = { side: largo ? "BUY" : "SELL", entrada: f(entrada), sl: f(sl), tp: f(tp), activada };
  }

  return r;
}

async function analizarEntradas(chat) {
  await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});

  const cfg = v3Config();
  const { velas, ms, intervalo } = await traerVelasDe(process.env.TV_INTERVAL || "1min", process.env.TV_VELAS || "1500");

  if (velas.length < 200) throw new Error("Pocas velas para calcular");

  // Filtro del timeframe superior (última vela cerrada). Se omite si el gráfico ya es de ese timeframe o mayor.
  const htfMs = TV_INTERVALOS[cfg.htf];
  const htf = { disponible: Boolean(htfMs) && ms <= htfMs, bias: 0 };

  if (cfg.fHtf && htf.disponible) {
    const rh = await traerVelasDe(cfg.htf, 500);
    htf.bias = v3BiasEstructura(rh.velas, cfg.htfInterno ? cfg.internalLen : cfg.swingLen);
  }

  const est = biasV3(velas, cfg);
  const r = planV3(est, velas, cfg, htf);
  const ult = velas[velas.length - 1];
  const precio = ult.close;

  const d = (x) => (x == null ? "-" : Number(x).toFixed(cfg.decimales));
  const flecha = (t) => (t === 1 ? "▲" : t === -1 ? "▼" : "—");
  const ok = (b) => (b ? "✓" : "✗");
  const altoRol = est.roleBias === -1 ? "PROTEGIDO" : "OBJETIVO";
  const bajoRol = est.roleBias === 1 ? "PROTEGIDO" : "OBJETIVO";
  const dirTxt = est.dir === 1 ? "COMPRA" : est.dir === -1 ? "VENTA" : "sin dirección";

  const informe =
    `🔍 XAUUSD ${intervalo} · Bias Toolkit V.3\n` +
    `Precio ${d(precio)} · vela ${new Date(ult.t).toISOString().slice(11, 16)} UTC\n\n` +
    `Swing ${flecha(est.swBias)} · Interna ${flecha(est.inBias)} · ${cfg.htf} ${htf.disponible ? flecha(htf.bias) : "n/a"}\n` +
    `swh ${d(est.swHi)} ${altoRol} · swl ${d(est.swLo)} ${bajoRol}\n` +
    `Plan: ${dirTxt}\n\n` +
    `Alineación ${ok(r.okAlin)} · HTF ${ok(r.okHtf)} · Zona ${ok(r.okZona)}` +
    (r.lq === null ? "" : ` · LQ ${ok(r.lq)}`);

  const filtrosOk = r.okAlin && r.okHtf && r.okZona;
  let lectura = null;
  let motivo = "";

  if (est.dir === 0) {
    motivo = "Sin dirección definida todavía.";
  } else if (!filtrosOk) {
    const f = [];
    if (!r.okAlin) f.push(cfg.entradaFib ? "swing e interna no alineadas" : "el swing no va a favor del plan");
    if (!r.okHtf) f.push(`${cfg.htf} no confirma la dirección`);
    if (!r.okZona) f.push("el precio aún no llegó al 0.618");
    motivo = f.join("; ") + ".";
  } else if (!r.plan) {
    motivo = cfg.entradaFib ? "La entrada Fib queda fuera del rango SL–TP." : "No hay un LQ válido para la entrada.";
  } else {
    const p = r.plan;
    const pasado = p.side === "BUY" ? precio <= p.sl || precio >= p.tp : precio >= p.sl || precio <= p.tp;

    if (pasado) {
      motivo = "El precio ya superó el SL o el TP del plan.";
    } else {
      lectura = {
        instrumento: "XAUUSD",
        direccion: p.side,
        entrada: p.entrada,
        stop_loss: p.sl,
        take_profit_1: p.tp,
        take_profit_2: null,
        take_profit_3: null,
        precio_actual: precio,
        varias_posiciones: false,
        observaciones: `Bias Toolkit V.3 · ${intervalo} · ${cfg.entradaFib ? "entrada Fib" : p.activada ? "LQ neutralizado" : "LQ activo"} · precio ${d(precio)}`,
      };

      const err = validar(lectura);

      if (err) {
        lectura = null;
        motivo = `Plan descartado: ${err}.`;
      }
    }
  }

  if (!lectura) {
    await enviar(chat, `${informe}\n\nSin entrada vigente: ${motivo}`, { reply_markup: TECLADO_MENU });
    return;
  }

  await enviar(chat, informe);

  await entregar(
    chat,
    armarSenal(lectura, { estado: r.plan.activada ? "mercado" : "LIMIT PENDIENTE", origen: "automática" }),
    lectura,
    false
  );
}

// Evita que dos toques seguidos gasten consultas de Twelve Data por duplicado.
let analizando = false;

async function analizarSeguro(chat) {
  if (analizando) {
    await enviar(chat, "Ya estoy analizando, esperá unos segundos.").catch(() => {});
    return;
  }

  analizando = true;

  try {
    await analizarEntradas(chat);
  } catch (e) {
    await enviar(chat, `No pude analizar: ${e.message}`, { reply_markup: TECLADO_MENU }).catch(() => {});
  } finally {
    analizando = false;
  }
}

let reinicioVelas = null;

Panel.iniciar({
  tg,
  owner: () => String(process.env.OWNER_ID || ""),
  alCambiar: (k) => {
    if (k !== "TV_INTERVAL" && k !== "TV_POLL_SEG") return;
    if (k === "TV_INTERVAL") tvUltimaVela = null;
    clearTimeout(reinicioVelas);
    reinicioVelas = setTimeout(iniciarVelas, 1500);
  },
})
  .catch((e) => console.error("Panel:", e.message))
  .finally(iniciarVelas);
