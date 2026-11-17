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
    if (ahora - (tvRecientes.get(clave) || 0) < 120000) return;
    tvRecientes.set(clave, ahora);

    const senal = armarSenal(lectura, { estado: process.env.ESTADO_TV });
    await entregar(dueño, senal, lectura);
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
    await enviar(String(process.env.OWNER_ID || ""), armarSenal(l, { estado: process.env.ESTADO_TV }).texto);
    res.send("Prueba enviada a tu Telegram");
  } catch (e) {
    res.status(500).send(e.message);
  }
});
