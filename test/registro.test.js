// Pruebas de la lógica de registro y seguimiento. Correr con: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { _test: R } = require("../registro");

const MIN = 60000;
const T0 = Date.UTC(2026, 10, 23, 14, 0, 0); // lunes 23/11/2026 14:00 UTC

// Texto con el mismo formato que arma armarSenal en index.js.
function texto({ inst = "XAUUSD", dir = "BUY", e = 4043, sl = 4039, tp = [4051], estado = "ACTIVA", origen = "MANUAL" }) {
  let t = `*TRADING INSTITUCIONAL | SIGNALS VIP*\n\nTipo de señal: ${origen}\nInstrumento: ${inst}\nOperación:  ${dir}\nEntrada: ${e}\nStop Loss: ${sl}\nTake Profit : ${tp[0]}`;
  if (tp[1] != null) t += `\nTake Profit 2: ${tp[1]}`;
  if (tp[2] != null) t += `\nTake Profit 3: ${tp[2]}`;
  return t + `\n\nESTADO: ${estado}\n\nRecordá utilizar un riesgo máximo del 1%...\n\n*Trading Institucional* 🏛📈`;
}

function senal(opc = {}) {
  const d = R.leerTexto(texto(opc));
  const act = d.ini === "ACTIVA";
  return { ...d, id: "X", t: T0, clave: R.claveInstrumento(d.instrumento), estado: act ? "Activa" : "Pendiente", tAct: act ? T0 : null, tpMax: 0, resultado: "", r: null, desde: T0 };
}

// Velas de 1 minuto desde T0 a partir de [low, high].
const velas = (rangos, desde = T0) => rangos.map(([low, high], i) => ({ t: desde + i * MIN, open: low, close: high, low, high }));

test("lee el texto de la señal (BUY con 3 TP, SELL con 1 TP, coma decimal)", () => {
  const a = R.leerTexto(texto({ tp: [4051, 4055, 4060], estado: "LIMIT PENDIENTE", origen: "AUTOMÁTICA" }));
  assert.deepEqual(
    { i: a.instrumento, d: a.dir, e: a.entrada, sl: a.sl, tp: a.tp, ini: a.ini, o: a.origen },
    { i: "XAUUSD", d: "BUY", e: 4043, sl: 4039, tp: [4051, 4055, 4060], ini: "LIMIT PENDIENTE", o: "AUTOMÁTICA" }
  );

  const b = R.leerTexto(texto({ inst: "EURUSD", dir: "SELL", e: "1.08500", sl: "1.08600", tp: ["1.08300"], estado: "STOP" }));
  assert.equal(b.dir, "SELL");
  assert.equal(b.entrada, 1.085);
  assert.deepEqual(b.tp, [1.083]);
  assert.equal(b.ini, "STOP");

  assert.equal(R.leerTexto("texto cualquiera"), null);
});

test("normaliza instrumentos", () => {
  assert.equal(R.claveInstrumento("BTCUSDT.P"), "BTCUSD");
  assert.equal(R.claveInstrumento("btcusdt"), "BTCUSD");
  assert.equal(R.claveInstrumento("XAUUSD"), "XAUUSD");
});

test("ACTIVA BUY llega a TP1: +2R y cierra si es el único TP", () => {
  const s = senal({ e: 4043, sl: 4039, tp: [4051] });
  const ev = R.evaluar(s, velas([[4041, 4045], [4044, 4051.2]]), T0 + 5 * MIN);
  assert.equal(s.resultado, "TP1");
  assert.equal(s.r, 2);
  assert.equal(s.estado, "Cerrada");
  assert.equal(ev[0].tipo, "resultado_y_cierre");
});

test("ACTIVA BUY toca SL: -1R", () => {
  const s = senal();
  R.evaluar(s, velas([[4040, 4045], [4038.9, 4042]]), T0 + 5 * MIN);
  assert.equal(s.resultado, "SL");
  assert.equal(s.r, -1);
  assert.equal(s.estado, "Cerrada");
});

test("regla b: la misma vela toca SL y TP1, cuenta SL", () => {
  const s = senal();
  R.evaluar(s, velas([[4038, 4052]]), T0 + 5 * MIN);
  assert.equal(s.resultado, "SL");
});

test("regla a: con TP2/TP3 sigue después de TP1 y el R queda en TP1", () => {
  const s = senal({ tp: [4051, 4055, 4060] });
  R.evaluar(s, velas([[4044, 4051]]), T0 + 2 * MIN);
  assert.equal(s.estado, "Siguiendo TP2/TP3");
  assert.equal(s.resultado, "TP1");
  assert.equal(s.tpMax, 1);

  // Llega a TP2 y después vuelve al SL: queda TP1 (+2R) con TP máx 2.
  R.evaluar(s, velas([[4050, 4055.5], [4038, 4050]], T0 + MIN), T0 + 5 * MIN);
  assert.equal(s.estado, "Cerrada");
  assert.equal(s.resultado, "TP1");
  assert.equal(s.r, 2);
  assert.equal(s.tpMax, 2);
});

test("regla a: una vela que pasa TP1, TP2 y TP3 cierra con TP máx 3", () => {
  const s = senal({ tp: [4051, 4055, 4060] });
  R.evaluar(s, velas([[4044, 4061]]), T0 + 2 * MIN);
  assert.equal(s.estado, "Cerrada");
  assert.equal(s.tpMax, 3);
  assert.equal(s.r, 2);
});

test("SELL: TP abajo y SL arriba", () => {
  const s = senal({ dir: "SELL", e: 4043, sl: 4047, tp: [4035] });
  R.evaluar(s, velas([[4040, 4046], [4034.5, 4041]]), T0 + 5 * MIN);
  assert.equal(s.resultado, "TP1");
  assert.equal(s.r, 2);
});

test("LIMIT BUY: se activa al tocar la entrada y después llega a TP1", () => {
  const s = senal({ estado: "LIMIT PENDIENTE" });
  const ev = R.evaluar(s, velas([[4045, 4048], [4042.5, 4046], [4046, 4051]]), T0 + 5 * MIN);
  assert.equal(ev[0].tipo, "activada");
  assert.equal(s.tAct, T0 + MIN);
  assert.equal(s.resultado, "TP1");
});

test("regla c: LIMIT que toca TP1 antes de activarse queda Cancelada", () => {
  const s = senal({ estado: "LIMIT PENDIENTE" });
  R.evaluar(s, velas([[4046, 4052]]), T0 + 2 * MIN);
  assert.equal(s.resultado, "Cancelada");
  assert.equal(s.r, null);
});

test("regla c: LIMIT que se activa y toca SL en la misma vela cuenta SL", () => {
  const s = senal({ estado: "LIMIT PENDIENTE" });
  R.evaluar(s, velas([[4038, 4046]]), T0 + 2 * MIN);
  assert.equal(s.resultado, "SL");
  assert.equal(s.r, -1);
});

test("regla c: LIMIT sin activarse en 24 h queda Expirada (por velas y por reloj)", () => {
  const s = senal({ estado: "LIMIT PENDIENTE" });
  R.evaluar(s, velas([[4045, 4048]], T0 + 24 * 60 * MIN), T0 + 24 * 60 * MIN + 2 * MIN);
  assert.equal(s.resultado, "Expirada");

  const s2 = senal({ estado: "LIMIT PENDIENTE" });
  R.evaluar(s2, [], T0 + 25 * 60 * MIN);
  assert.equal(s2.resultado, "Expirada");

  // Antes de 24 h + margen no expira.
  const s3 = senal({ estado: "LIMIT PENDIENTE" });
  R.evaluar(s3, [], T0 + 24 * 60 * MIN);
  assert.equal(s3.estado, "Pendiente");
});

test("STOP SELL: se activa cuando el precio baja a la entrada", () => {
  const s = senal({ dir: "SELL", e: 4040, sl: 4044, tp: [4032], estado: "STOP" });
  R.evaluar(s, velas([[4041, 4043], [4039.5, 4042]]), T0 + 5 * MIN);
  assert.equal(s.estado, "Activa");
  assert.equal(s.tAct, T0 + MIN);
});

test("regla d: activa sin TP1 ni SL a las 72 h queda Sin resolver", () => {
  const s = senal();
  R.evaluar(s, velas([[4041, 4045]], T0 + 72 * 60 * MIN), T0 + 72 * 60 * MIN + 2 * MIN);
  assert.equal(s.resultado, "Sin resolver");

  const s2 = senal();
  R.evaluar(s2, [], T0 + 73 * 60 * MIN);
  assert.equal(s2.resultado, "Sin resolver");
});

test("regla e: ACTIVA ignora velas anteriores a la publicación", () => {
  const s = senal();
  R.evaluar(s, velas([[4030, 4060]], T0 - MIN), T0 + MIN);
  assert.equal(s.estado, "Activa");
});

test("procesar las mismas velas dos veces no duplica eventos", () => {
  const s = senal({ estado: "LIMIT PENDIENTE" });
  const v = velas([[4045, 4048], [4042.5, 4046]]);
  assert.equal(R.evaluar(s, v, T0 + 3 * MIN).length, 1);
  assert.equal(R.evaluar(s, v, T0 + 3 * MIN).length, 0);
});

test("estadísticas: cuenta TP1/SL, R acumulado y excluye pruebas", () => {
  const ahora = T0;
  const filas = [
    { ts: ahora - MIN, Estado: "Cerrada", Resultado: "TP1", R: 2 },
    { ts: ahora - MIN, Estado: "Siguiendo TP2/TP3", Resultado: "TP1", R: 1.5 },
    { ts: ahora - MIN, Estado: "Cerrada", Resultado: "SL", R: -1 },
    { ts: ahora - MIN, Estado: "Cerrada", Resultado: "Expirada", R: "" },
    { ts: ahora - MIN, Estado: "Activa", Resultado: "", R: "" },
    { ts: ahora - MIN, Estado: "Prueba", Resultado: "", R: "" },
    { ts: ahora - 40 * 24 * 60 * MIN, Estado: "Cerrada", Resultado: "SL", R: -1 },
  ];
  const e = R.estadisticas(filas, ahora - 30 * 24 * 60 * MIN);
  assert.equal(e.total, 5);
  assert.equal(e.tp1, 2);
  assert.equal(e.sl, 1);
  assert.equal(e.r, 2.5);
  assert.equal(e.efectividad, 67);
  assert.equal(e.expiradas, 1);
  assert.equal(e.abiertas, 1);
});
