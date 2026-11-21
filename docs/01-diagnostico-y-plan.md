# Fase 2 - Diagnóstico y plan

Fecha: 2026-11-21. Estado: borrador para tu aprobación.
Convención: **[DATO]** = lo confirmaste vos o está en el código. **[HIPÓTESIS]** = falta validarlo. **[A COMPLETAR]** = me falta ese dato.

---

## 1. Diagnóstico empresarial

### Situación actual
| Unidad | Ingreso | Estado |
|---|---|---|
| Signals VIP | ~80 USDT/mes, 4 activos **[DATO]** | Funciona. La entrega de señales está automatizada; la gestión de clientes, no |
| Mentoría | 0 ventas en 3 meses, ~40 consultas sin registrar **[DATO]** | La mayoría deja de responder después del precio **[DATO]** |
| Comunidad | 0 directo | Canal de captación. Tamaño **[A COMPLETAR]** |
| Market Intelligence | 0 | Automatización de noticias, calendario y COT |
| Desarrollo tecnológico | 0 | Infraestructura propia (bot, Pine, EAs) |

Costos mensuales **[A COMPLETAR]**. Referencias de precios públicos (verificados el 2026-11-21; confirmá lo que pagás):
- **Railway:** el plan Hobby cuesta USD 5/mes e incluye USD 5 de uso. Si consumís más, pagás el excedente.
- **Green API:** el plan Developer es gratis, pero solo permite 3 chats y 1 instancia. El plan Business figura a 690 rublos/mes por instancia en su blog.
- **Twelve Data:** el plan Basic es gratis, con 800 consultas por día. Grow arranca en USD 29/mes.
- **Gemini:** según el uso **[A COMPLETAR]**.

### Conclusiones
1. **El cuello de botella es comercial.** El precio llega sin contexto: no hay calificación previa, ni una propuesta de valor antes del precio, ni seguimiento. Las consultas no se registran, así que no se pueden recuperar ni medir.
   - Es una **[HIPÓTESIS]** fuerte: 40 consultas, 0 ventas y silencio después del precio.
   - Es la palanca más grande. Con 4 alumnos a 250 USDT (10% de las 40) entrarían 1.000 USDT, lo mismo que 12 meses del VIP actual. Es aritmética, no una proyección.
2. **No hay prueba de resultados.** El bot publica las señales, pero no las registra ni sigue cómo terminan **[DATO]**.
   - Esto afecta las renovaciones del VIP y la credibilidad de la mentoría.
   - Es un cambio de código acotado, porque el bot ya tiene todos los datos en el momento de publicar.
3. **El VIP no escala tal como está.** Cada suscriptor exige un cobro, una confirmación y un control de vencimiento manuales cada mes **[DATO]**.
   - Si el VIP crece a 50 personas, la carga crece en la misma proporción.
   - El plan gratuito de Green API (3 chats) no alcanza para mandar avisos individuales por WhatsApp.
4. **Hay demasiados frentes para el volumen actual.** Market Intelligence y Desarrollo no facturan.
   - Decisión propuesta: tratarlos como herramientas de captación y de soporte, no como productos, hasta que haya demanda comprobada (gente que pida pagar por eso).
5. **Posicionamiento.** El único ingreso recurrente es la venta de señales, pero la marca quiere liderar con metodología.
   - Propuesta: comunicar primero la mentoría y el proceso; el VIP queda como complemento para alumnos y seguidores. Eso también baja el riesgo regulatorio, que se verifica en la Fase 5.
6. **Dependencia total del fundador:** captación, venta, cobro, alta, señales y soporte pasan por vos.

---

## 2. Mapa de procesos

Cómo funciona hoy (A = automático, M = manual):

```
CAPTACIÓN
  Instagram / comunidad / referidos [A COMPLETAR] -> consulta por WhatsApp o Telegram (M)

VENTA MENTORÍA
  Consulta (M) -> precio enseguida (M) -> silencio -> sin seguimiento -> se pierde

VENTA VIP
  Consulta (M) -> pago en USDT (M) -> confirmar el pago a mano (M) -> anotar en texto suelto (M)
  -> agregar al grupo de WhatsApp y/o Telegram (M)

OPERACIÓN VIP
  Señal: captura o /s o TradingView o motor (A/M) -> validación (A) -> publicación WA + TG (A)
  -> aviso sin precios (A) -> seguimiento del resultado (no existe)

RENOVACIÓN Y BAJA VIP
  Controlar vencimientos (M, texto suelto) -> avisar (M) -> cobrar (M) -> sacar del grupo (M)

MENTORÍA (alumno)
  Agenda, clases, material y seguimiento [A COMPLETAR]

ADMINISTRACIÓN
  Ingresos y costos: sin registro [A COMPLETAR]
```

Cómo debería funcionar:

```
Consulta -> se registra en CRM (hoja Consultas) -> calificación (3 preguntas) -> propuesta + precio
  -> seguimiento D+1 / D+3 / D+7 -> ganada (alta en Alumnos + Pagos) o perdida (con motivo)

Pago VIP -> registro en Pagos (con hash de la transacción) -> Suscriptores calcula el vencimiento
  -> el bot te avisa todos los días quién vence -> aviso al cliente D-3 y D0 -> baja D+1 si no pagó

Señal publicada -> el bot la registra -> el bot sigue el precio hasta TP o SL -> resultado en la hoja
  -> resumen semanal verificable
```

---

## 3. Tareas manuales que hacés hoy

| # | Tarea | Frecuencia | ¿Se automatiza? |
|---|---|---|---|
| 1 | Responder consultas de mentoría | Por consulta | Parcial: guion y registro. La conversación la seguís teniendo vos |
| 2 | Hacer seguimiento a los que no responden | Hoy no se hace | Sí: el recordatorio te lo da la hoja; el mensaje lo mandás vos |
| 3 | Confirmar pagos USDT | Por pago | Parcial: el registro es inmediato; la verificación en blockchain puede automatizarse más adelante |
| 4 | Controlar vencimientos del VIP | Diaria/semanal | Sí, totalmente |
| 5 | Avisar vencimientos | Por cliente | Sí (Telegram). En WhatsApp depende del plan de Green API |
| 6 | Agregar y sacar gente de los grupos | Por alta/baja | Telegram: sí (bot admin). WhatsApp: manual por ahora |
| 7 | Armar y publicar señales | Por señal | Ya automatizado |
| 8 | Seguir el resultado de cada señal | Hoy no se hace | Sí, totalmente |
| 9 | Registrar ingresos y gastos | Hoy no se hace | Sí: sale de la hoja Pagos |

---

## 4. Oportunidades de automatización (por prioridad)

| Prioridad | Qué | Impacto económico | Tiempo | Complejidad | Riesgo |
|---|---|---|---|---|---|
| 1 | CRM de consultas + guiones + recuperar las 40 | Alto | 1 a 2 días | Baja (sin código) | Bajo |
| 2 | Registro automático de señales y resultados | Alto (prueba de resultados) | 2 a 4 días | Media (código) | Bajo: no cambia cómo se publica |
| 3 | Suscripciones VIP: vencimientos y avisos | Medio (retención, tu tiempo) | 2 a 3 días | Media | Bajo |
| 4 | Registro de pagos + finanzas básicas | Medio (control) | 1 día | Baja | Bajo |
| 5 | Mejoras del bot de la Fase 5 (duplicados persistentes, reintentos, horarios, US100/EURUSD/BTC) | Medio | 1 a 2 semanas | Media/alta | Medio |
| 6 | Verificación automática de pagos en blockchain | Bajo hoy (4 clientes) | - | Media | Medio |
| 7 | Panel de control, Market Intelligence como producto | Bajo hoy | - | - | - |

Las prioridades 6 y 7 quedan para cuando haya volumen.

---

## 5. Herramientas recomendadas

Una sola base, sin herramientas nuevas pagas.

| Herramienta | Para qué | Costo | Por qué esta |
|---|---|---|---|
| Google Sheets (cuenta privada tuya) | CRM, suscriptores, pagos, señales, finanzas | 0 | Ya la usás. Se maneja desde el celular. Los datos de clientes quedan fuera del repo público |
| Google Apps Script (dentro de la misma hoja) | Puente bot → hoja para registrar señales y leer vencimientos | 0 | No hace falta otro servicio ni otra base de datos |
| Bot actual (Railway) | Avisos de vencimiento, registro y seguimiento de señales | Lo que ya pagás | Reutiliza lo que hay |
| Google Calendar | Clases de mentoría | 0 | Ya lo tenés |

No recomiendo, por ahora:
- Un CRM pago: con menos de 100 consultas por mes, una hoja alcanza.
- La API oficial de WhatsApp: cobra por mensaje y exige plantillas aprobadas. Se evalúa en la Fase 5 junto con el riesgo de Green API.

---

## 6. Plan de implementación priorizado

| Semana | Entregable | Quién | Necesita |
|---|---|---|---|
| 1 | Hoja "TI - Gestión" con las pestañas Consultas, Suscriptores, Pagos, Señales y Finanzas (`docs/plantillas/`) | Vos la creás (5 min) y yo te paso todo para pegar | Tu ok sobre dónde guardar los datos |
| 1 | Cargar las 40 consultas desde el historial de WhatsApp/IG y mandar la recuperación (`02-mentoria-proceso-comercial.md`) | Vos, con los guiones | 30 a 60 min por día durante 4 días |
| 1 | Aplicar el proceso nuevo a toda consulta nueva | Vos | - |
| 2 | Bot: registro de señales en la hoja + seguimiento TP/SL | Yo (código en una rama) | Tu ok sobre el diseño |
| 2 | Cargar los 4 suscriptores con la regla de vencimiento (`03-signals-vip-suscripciones.md`) | Vos | Confirmar la regla |
| 3 | Bot: aviso diario de vencimientos a tu Telegram | Yo | - |
| 3 | Auditoría técnica y normativa de la Fase 5 | Yo | - |
| 4 | Medición de KPIs, ajustes y plan a 90 días | Los dos | Dos semanas de datos cargados |

---

## 7. KPIs

**Comercial (mentoría)**
- Consultas nuevas por semana.
- Consultas calificadas (respondieron las preguntas de calificación).
- Respuesta después del precio: el porcentaje que sigue la conversación.
- Conversión: ventas sobre consultas calificadas.
- Tiempo de primera respuesta.
- Motivo de pérdida (precio, timing, pruebas, sin respuesta).

**Signals VIP**
- Suscriptores activos.
- Tasa de renovación: renovaron sobre los que vencieron en el mes.
- Altas y bajas por mes.
- Ingreso mensual.

**Calidad de señales** (cuando exista el registro)
- Señales por semana.
- Porcentaje que llega a TP1 y porcentaje que toca el SL.
- Resultado en R acumulado por mes.

**Finanzas**
- Ingresos por unidad.
- Costos fijos.
- Margen.

---

## 8. Objetivos

Son metas propuestas, no promesas de resultado.

**30 días**
- El 100% de las consultas nuevas queda registrado en el CRM con su etapa y su motivo.
- Las 40 consultas viejas están reconstruidas en la medida de lo posible y contactadas una vez con el guion de recuperación.
- Hay 2 semanas de señales registradas automáticamente con su resultado.
- Los 4 suscriptores VIP están cargados, con la regla de vencimiento aplicada y avisos automáticos a tu Telegram.
- Los costos mensuales reales están cargados en Finanzas, así sabemos si cada unidad da ganancia.
- Meta comercial a validar: primeras 1 o 2 mentorías vendidas. Se ajusta según cuántas de las 40 respondan.

**90 días**
- Conversión de la mentoría medida con al menos 30 consultas registradas con el proceso nuevo.
- Track record de 10 a 12 semanas de señales, publicable como resumen verificable.
- Tasa de renovación del VIP medida durante 3 ciclos.
- El ciclo de suscripción completo funciona sin control manual de vencimientos.
- Decisión basada en datos: subir precio, mantenerlo o reempaquetar la mentoría; y si Market Intelligence pasa a ser producto o sigue como contenido.
