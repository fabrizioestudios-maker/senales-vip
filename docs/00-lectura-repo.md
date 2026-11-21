# Fase 0 - Lectura del repo senales-vip

Fecha: 2026-11-21. Rama de trabajo: `ccr-1dbc5b21-o26ujf` (main sin tocar).
Commit revisado: `6e12846`.

## Qué hace (comprobado leyendo el código)

Servidor Express (`index.js`, unas 2.000 líneas) desplegado en Railway, con un panel de ajustes (`panel.js`, unas 460 líneas). Solo atiende al dueño (`OWNER_ID`).

Entradas de señales:
1. Captura de TradingView por Telegram. Gemini la lee, el bot valida los niveles y arma la señal.
2. Comando manual `/s buy|sell entrada sl tp1 [tp2 tp3]`.
3. Webhook `/tradingview` con alertas del Pine Bias Toolkit V.2 (clave en `?key=`).
4. Motor automático por velas, que es un port del Bias Toolkit V.2. Consulta Twelve Data cada 180 s.
5. Botón "Analizar", que corre el motor Bias Toolkit V.3. Usa BingX para BTC y Twelve Data como respaldo.

Salidas:
- Grupo VIP de WhatsApp, vía Green API.
- Grupo VIP de Telegram.
- Aviso sin precios en un grupo de Avisos de WhatsApp.

Panel `/panel`: cambia las variables en caliente. Guarda los cambios en `/data/panel.json` y, como respaldo, en un mensaje fijado del chat con el bot.

## Lo que no hace

- No gestiona suscriptores, pagos ni vencimientos. No hay nada de eso en el código.
- No guarda el historial de señales ni su resultado (TP/SL).

## Riesgos y deuda técnica

| # | Hallazgo | Impacto |
|---|---|---|
| 1 | Sin registro de señales ni de resultados | No hay track record verificable. Es comercial: afecta la venta de VIP y mentoría |
| 2 | Antiduplicados y estado en memoria (`tvRecientes`, `yaPublicados`, `tvUltimaVela`) | Se pierden en cada redeploy o reinicio. Con más de una réplica habría señales duplicadas |
| 3 | Sin reintentos al publicar en WhatsApp/Telegram: si falla, solo te avisa | Algún suscriptor puede quedarse sin la señal |
| 4 | `mercadoAbierto()` aplica el horario forex genérico (cierre vie 22 a dom 22 UTC) a todo | BTC opera 24/7. No hay filtro de sesión ni de noticias |
| 5 | Dependencia de Green API (no oficial) | Riesgo de bloqueo del número. Se evalúa en la Fase 5 |
| 6 | El repo público expone la lógica completa de Bias Toolkit V.2/V.3 | Propiedad intelectual a la vista |
| 7 | Claves en la URL (`?key=` en `/tradingview`, `/setup`, `/velas/senales`) | Pueden quedar en logs e historiales |
| 8 | `wrangler.jsonc` apunta a `worker.js`, que fue borrado (resto de Cloudflare) | Confusión. Sin efecto en Railway |
| 9 | Código duplicado (`traerVelas` / `traerVelasDe`). `traerVelasDe` define `symbol` dos veces | Mantenimiento |
| 10 | Sin tests, sin README, sin `.gitignore` ni lockfile. Commits "Update index.js" | Es difícil saber qué versión corre y volver atrás |
| 11 | El preset US100 usa `NDX` en Twelve Data; según el propio panel requiere plan pago (sin verificar). US100 no está en los activos del botón Analizar | Pendiente de la Fase 5 |
| 12 | Los modelos por defecto `gemini-3.8-flash` / `gemini-3.6-flash` no están verificados | Si el nombre no existe, la lectura de capturas falla. Revisar lo cargado en Railway |

## Seguridad del repo público (comprobado)

- Busqué en todo el historial, incluido el `worker.js` borrado, tokens de bot, API keys e IDs de grupos o teléfonos de WhatsApp. No encontré ninguno.
- Todo se lee de variables de entorno.

## Qué se verificó y qué no

- Verificado: lectura completa del código, sintaxis válida (`node --check` en los dos archivos) y escaneo de secretos en el historial.
- No probado: ejecución real. Faltan las variables de Railway y aquí no hay acceso a Telegram, Green API, Gemini ni Twelve Data.
