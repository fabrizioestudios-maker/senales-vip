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
  { n: "Datos de mercado", d: "Velas de Twelve Data. Cambiar intervalo o frecuencia reinicia el ciclo." },
  { n: "Motor V.2", d: "Señales automáticas por velas. Tiene que coincidir con los settings del Pine de Bias Toolkit V.2." },
  { n: "V.3 Estructura", d: "Botón Analizar entradas: estructura y timeframe superior." },
  { n: "V.3 Entrada y salida", d: "Botón Analizar entradas: dónde entra, SL y TP del plan." },
  { n: "V.3 Liquidez y filtros", d: "Botón Analizar entradas: liquidez (LQ) y filtros que habilitan la entrada." },
];

const B = (g, k, n, def, pos) => ({ g, k, n, t: "bool", def, pos });
const E = (g, k, n, def, op) => ({ g, k, n, t: "enum", def, op });
const N = (g, k, n, def, paso, min, max) => ({ g, k, n, t: "num", def, paso, min, max });
const T = (g, k, n) => ({ g, k, n, t: "txt", def: "" });

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
  N(2, "TV_DECIMALES", "Decimales cálculo"
