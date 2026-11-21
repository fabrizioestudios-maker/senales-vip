# Registro y seguimiento de señales

Estado: programado y probado en la rama `ccr-1dbc5b21-o26ujf`. Para usarlo, falta publicarlo en Railway y hacer la configuración de abajo.

## Qué hace
- Cada señal que se publica en al menos un destino (WhatsApp o Telegram) queda como fila en la pestaña `Señales` de tu hoja "TI - Gestión".
- El bot sigue el precio con velas de 1 minuto y anota el resultado: activación, TP1 o SL, R y TP máximo alcanzado. Cada cambio te llega por Telegram.
- `/resultados` (en tu chat con el bot): resumen de los últimos 7 y 30 días.
- Si reiniciás o redeployás, el bot retoma desde la hoja las señales abiertas.
- Sin `SHEETS_URL` y `SHEETS_KEY`, el bot funciona exactamente igual que antes.

## Reglas de resultado (aprobadas)
| | Regla |
|---|---|
| a | El R oficial se mide en TP1 (+R de TP1 o −1R en SL). TP2 y TP3 se anotan en "TP máx" y no cambian el R |
| b | Si la misma vela toca SL y TP1, cuenta SL |
| c | Una señal LIMIT o STOP que no se activa en 24 h queda "Expirada". Si toca TP1 antes de activarse, queda "Cancelada". Ninguna de las dos suma R |
| d | Una señal activa sin TP1 ni SL a las 72 h queda "Sin resolver" (revisión manual) |
| e | Una señal con ESTADO ACTIVA se toma activada en la entrada, en el momento en que se publica |

## Fuentes de precio
| Instrumento | Fuente | Consumo |
|---|---|---|
| El del motor (XAUUSD por defecto) | Las mismas velas que ya pide el motor cada 180 s | 0 consultas extra |
| BTC (BTCUSD, BTCUSDT, BTCUSDT.P) | BingX, cada 5 min | Gratis, no usa cupo de Twelve Data |
| EURUSD, GBPUSD, USDJPY, ETHUSD | Twelve Data, como máximo 1 consulta cada 10 min entre todos | Hasta ~144 por día, solo con señales abiertas |
| Otros (US100, US30, etc.) | Ninguna | Se registran como "Manual / Sin seguimiento" y los cerrás a mano |

- Con el mercado forex cerrado (viernes 22 UTC a domingo 22 UTC) no se consulta Twelve Data, salvo para cripto.
- **Limitación:** el precio de Twelve Data o BingX no es idéntico al de cada broker, y el cálculo no incluye spread. La columna "Fuente de precios" dice de dónde salió cada resultado.

## Configuración (unos 10 minutos, desde el celular)

### 1. Apps Script en tu hoja
1. Abrí la hoja "TI - Gestión" en **Chrome**. Menú ⋮ > tildá **"Versión para computadora"**.
2. Menú **Extensiones > Apps Script**.
3. Borrá todo el contenido de `Código.gs` y pegá el archivo `apps-script/Codigo.gs` del repo. En GitHub, abrilo y tocá "Raw" para copiarlo completo.
4. Guardá (ícono del disquete).
5. Engranaje **Configuración del proyecto** > **Propiedades del script** > **Agregar propiedad**:
   - Propiedad: `CLAVE`
   - Valor: una clave larga inventada por vos (32 caracteres o más, letras y números). Generala con el gestor de contraseñas del celular. **No la pegues en ningún chat.**
6. **Implementar > Nueva implementación**. En el engranaje de tipo, elegí **Aplicación web**:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier persona**. Hace falta para que el bot pueda llamarla; la protege la CLAVE.
7. **Implementar**. Autorizá con tu cuenta de Google. Si dice "Google no verificó esta app": Configuración avanzada > Ir a (nombre del proyecto).
8. Copiá la **URL de la aplicación web**, que termina en `/exec`.

### 2. Variables en Railway
En el servicio del bot > **Variables**:
- `SHEETS_URL` = la URL `/exec`
- `SHEETS_KEY` = la misma clave que pusiste en CLAVE

### 3. Publicar el código nuevo
El código está en la rama `ccr-1dbc5b21-o26ujf`. Para que corra en Railway hay que pasarlo a `main` (pull request) o apuntar Railway a esa rama. Pedímelo y te armo el pull request.

### 4. Comprobación
1. Abrí la URL `/exec` en el navegador. Tiene que decir `{"ok":true,"servicio":"registro de señales"}`.
2. Abrí `https://TU-APP.up.railway.app/registro/test?key=TU_TRADINGVIEW_KEY`. Tiene que decir `OK: fila de prueba ... cargada`. En la pestaña `Señales` aparece una fila con Estado "Prueba", que podés borrar.
3. En Telegram, mandale `/resultados` al bot.

### Si más adelante cambia `Codigo.gs`
Implementar > **Administrar implementaciones** > lápiz > Versión: **Nueva versión** > Implementar. Así la URL no cambia.

## Si algo falla
- **La hoja no responde:** la señal se publica igual. El bot reintenta 3 veces (2, 5 y 15 s) y después te manda por Telegram los datos para cargarla a mano.
- **No hay precios** (Twelve Data o BingX caídos): te avisa una vez por instrumento y sigue intentando.
- **Error "clave"** en `/registro/test`: CLAVE (Apps Script) y SHEETS_KEY (Railway) no coinciden.

## Archivos
- `registro.js`: lógica de registro, seguimiento y `/resultados`.
- `apps-script/Codigo.gs`: script de la hoja.
- `test/registro.test.js`: 17 pruebas de las reglas. Se corren con `npm test`.
- Cambios en `index.js`: una llamada después de cada publicación exitosa, las velas del motor compartidas con el seguimiento, el comando `/resultados`, `/registro/test` y el arranque del módulo. No se quitó nada.
