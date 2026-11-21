# Fase 4 - Signals VIP: ciclo de suscripción

Estado: borrador. **La regla de vencimiento requiere tu confirmación.**

## Regla de vencimiento propuesta (una sola)

> **Vencimiento = fecha en que confirmás el pago + 30 días corridos.**
> Si renueva antes de vencer, los 30 días se suman al vencimiento anterior, no a la fecha del pago. Así nadie pierde días por pagar antes.

Ejemplos:
- Paga y confirmás el 1/12: vence el 31/12.
- Renueva el 28/12, antes de vencer: el nuevo vencimiento es el 30/1 (31/12 + 30).
- Renueva el 3/1, ya vencido: vence el 2/2 (3/1 + 30).

## Ciclo

| Paso | Cuándo | Qué pasa | Quién |
|---|---|---|---|
| Registro | Al confirmar el pago | Fila en Pagos (fecha, monto, red, hash de la transacción). Fila en Suscriptores, o actualización si ya existía | Vos (1 min) |
| Alta | Mismo día | Lo agregás a los grupos VIP | Vos. En Telegram, después puede hacerlo el bot |
| Aviso de vencimiento | D-3 | Mensaje de renovación al cliente con los datos de pago | El bot te recuerda, vos lo mandás. Después se automatiza |
| Último aviso | D0 | "Hoy vence tu suscripción" | Igual que el anterior |
| Baja | D+1 sin pago | Lo sacás de los grupos. Estado "Baja" | Vos (WhatsApp). En Telegram puede hacerlo el bot |
| Recuperación | D+15 | Un mensaje de reactivación | Vos |

Fase técnica (después de tu ok): el bot lee la hoja Suscriptores una vez por día y te manda a Telegram la lista de quién vence en 3 días, quién vence hoy y quién está para dar de baja.

## Por qué los avisos al cliente no salen todavía por WhatsApp automático
El plan gratuito de Green API permite solo 3 chats. Los grupos VIP y Avisos ya usan parte de ese cupo. Para mandar avisos individuales por WhatsApp hace falta el plan Business, y el riesgo de depender de Green API se evalúa en la Fase 5. Mientras tanto: aviso automático a vos y mensaje manual al cliente, que con 4 suscriptores son 2 minutos por semana.

## Columnas
Suscriptores (`plantillas/suscriptores.csv`). Una fila por persona, que se actualiza en cada renovación:
```
ID,Nombre,Canal,Contacto (alias),Alta,Último pago,Vencimiento,Estado,Fecha de baja,Grupos,Notas
```
- **Vencimiento (columna G):** se carga a mano en cada pago. Valor: el mayor entre el vencimiento actual y la fecha del pago, más 30.
  - Si querés calcularlo, escribí esta fórmula en una celda libre (por ejemplo M2), copiá el resultado y pegalo como valor en G2. F2 es la fecha del pago nuevo; G2 es el vencimiento actual, vacío si es un alta:
    ```
    =MAX(F2;G2)+30
    ```
- **Estado (columna H):** fórmula fija. Pegala en H2 y arrastrala hacia abajo:
  ```
  =SI(I2<>"";"Baja";SI(G2="";"";SI(G2<HOY();"Vencido";SI(G2-HOY()<=3;"Por vencer";"Activo"))))
  ```
  Usa `;` porque la hoja está en español (Argentina). Si tu hoja está en inglés, usá `IF`, `TODAY` y `,`.
- **Fecha de baja (columna I):** se completa solo cuando se le da la baja.

Pagos (`plantillas/pagos.csv`):
```
Fecha,ID cliente,Concepto,Monto USDT,Red,Hash de la transacción,Confirmado,Notas
```
Concepto: `VIP`, `Mentoría`.
