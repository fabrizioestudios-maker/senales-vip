// TRADING INSTITUCIONAL | Registro de señales en Google Sheets
// Pegá este archivo completo en Extensiones > Apps Script de tu hoja "TI - Gestión".
// La clave NO va acá: se carga en Configuración del proyecto > Propiedades del script,
// con el nombre CLAVE (el mismo valor que SHEETS_KEY en Railway).

var HOJA = 'Señales';

var COLUMNAS = [
  'ID', 'Fecha UTC', 'ts', 'Origen', 'Instrumento', 'Dirección', 'Entrada', 'SL',
  'TP1', 'TP2', 'TP3', 'Estado inicial', 'Estado', 'Activación UTC', 'ts activación',
  'Resultado', 'Cierre UTC', 'R', 'TP máx', 'Fuente de precios', 'Notas'
];

var ABIERTAS = ['Pendiente', 'Activa', 'Siguiendo TP2/TP3'];

function doPost(e) {
  var datos;

  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'JSON inválido' });
  }

  var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');

  if (!clave || datos.clave !== clave) {
    return responder({ ok: false, error: 'clave' });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var hoja = obtenerHoja();
    var enc = encabezados(hoja);

    if (datos.accion === 'alta') {
      var f = datos.fila || {};
      if (!f.ID) return responder({ ok: false, error: 'falta ID' });
      if (buscarFila(hoja, enc, f.ID) > 0) return responder({ ok: true, repetida: true });

      hoja.appendRow(enc.map(function (h) { return f[h] === undefined || f[h] === null ? '' : f[h]; }));
      return responder({ ok: true });
    }

    if (datos.accion === 'actualizar') {
      var n = buscarFila(hoja, enc, datos.id);
      if (n < 0) return responder({ ok: false, error: 'ID no encontrado: ' + datos.id });

      var actual = hoja.getRange(n, 1, 1, enc.length).getValues()[0];
      var campos = datos.campos || {};
      var nueva = enc.map(function (h, i) {
        return Object.prototype.hasOwnProperty.call(campos, h) && h !== 'ID' ? campos[h] : actual[i];
      });

      hoja.getRange(n, 1, 1, enc.length).setValues([nueva]);
      return responder({ ok: true });
    }

    if (datos.accion === 'abiertas') {
      return responder({ ok: true, filas: filas(hoja, enc).filter(function (x) {
        return ABIERTAS.indexOf(String(x.Estado)) >= 0;
      }) });
    }

    if (datos.accion === 'desde') {
      var ts = Number(datos.ts) || 0;
      return responder({ ok: true, filas: filas(hoja, enc).filter(function (x) {
        return Number(x.ts) >= ts;
      }) });
    }

    return responder({ ok: false, error: 'acción desconocida' });
  } catch (err) {
    return responder({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Para comprobar desde el navegador que la implementación responde (no muestra datos).
function doGet() {
  return responder({ ok: true, servicio: 'registro de señales' });
}

function obtenerHoja() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(HOJA);

  if (!hoja) hoja = libro.insertSheet(HOJA);

  if (hoja.getLastRow() === 0) {
    hoja.appendRow(COLUMNAS);
    hoja.setFrozenRows(1);
  }

  return hoja;
}

// Encabezados de la fila 1. Si falta alguna columna, la agrega al final (no toca las existentes).
function encabezados(hoja) {
  var ancho = Math.max(hoja.getLastColumn(), 1);
  var enc = hoja.getRange(1, 1, 1, ancho).getValues()[0].map(String);
  var faltan = COLUMNAS.filter(function (c) { return enc.indexOf(c) < 0; });

  if (faltan.length) {
    hoja.getRange(1, enc.length + 1, 1, faltan.length).setValues([faltan]);
    enc = enc.concat(faltan);
  }

  return enc;
}

function buscarFila(hoja, enc, id) {
  var col = enc.indexOf('ID') + 1;
  var ultima = hoja.getLastRow();
  if (ultima < 2) return -1;

  var ids = hoja.getRange(2, col, ultima - 1, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }

  return -1;
}

function filas(hoja, enc) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return [];

  var valores = hoja.getRange(2, 1, ultima - 1, enc.length).getValues();

  return valores.map(function (v) {
    var o = {};
    enc.forEach(function (h, i) {
      var x = v[i];
      o[h] = x instanceof Date ? x.toISOString() : x;
    });
    return o;
  });
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
