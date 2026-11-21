# Fase 3 - Mentoría: proceso comercial

Estado: borrador para tu aprobación. Tus textos promocionales no se tocan: estos guiones son mensajes de conversación nuevos y podés adaptarlos.
Lo que va entre corchetes `[...]` lo completás vos (no invento datos de la mentoría).

## Problema
**[DATO]** La mayoría deja de responder después de recibir el precio.
El precio llega antes de que la persona vea si la mentoría es para ella y qué cambia en su trading. Además, hoy no hay seguimiento ni registro.

## Proceso (5 pasos, siempre el mismo)

1. **Registro.** Cada consulta se anota en la pestaña Consultas en el momento, antes de responder.
2. **Calificación.** Tres preguntas, antes del precio.
3. **Propuesta.** Qué incluye, para quién es y para quién no. Después, el precio con un próximo paso concreto.
4. **Seguimiento.** D+1, D+3 y D+7 si no responde. Después se cierra como "sin respuesta".
5. **Cierre.** Ganada (alta en Alumnos y en Pagos) o perdida, con el motivo.

Regla: si alguien pregunta "¿cuánto sale?" de entrada, no se le esconde el precio. Se le da junto con la calificación (guion 2b).

## Guiones

### 1. Primera respuesta (consulta nueva)
> Hola [nombre], gracias por escribir. Para decirte si la mentoría te sirve, necesito saber tres cosas:
> 1. ¿Hace cuánto operás y en qué mercado?
> 2. ¿Qué es lo que más te cuesta hoy: leer el contexto, encontrar la entrada, gestionar el riesgo o sostener la disciplina?
> 3. ¿Qué querés lograr en los próximos 3 meses?
> Con eso te explico cómo trabajaríamos.

### 2a. Propuesta (después de que responde)
> Gracias, [nombre]. Por lo que me contás, lo que te falta es [problema que nombró]. En la mentoría trabajamos justamente eso:
> - Contexto y dirección diaria con SMC/ICT
> - Liquidez y zonas de reacción
> - Modelos de entrada y ejecución
> - Gestión del riesgo y psicología
> Es individual: [cantidad de clases / duración / formato] y [qué acompañamiento hay después de cada clase].
> Es para quien quiere un método y está dispuesto a practicarlo con disciplina. No es para quien busca resultados rápidos.
> La inversión es de 250 USDT, en un único pago. Si te interesa, ¿te viene bien arrancar [fecha posible]?

### 2b. Si pide el precio de entrada
> Son 250 USDT, en un único pago, mentoría individual. Para decirte si te conviene, contame: ¿hace cuánto operás y qué es lo que más te cuesta hoy?

### 3. Seguimiento si no responde
- **D+1:** "Hola [nombre], ¿pudiste ver lo que te mandé? Si te quedó alguna duda sobre cómo es la mentoría, preguntame."
- **D+3:** "[nombre], una pregunta: ¿qué te frena hoy, el momento, la inversión o no tenés claro si es para vos? Me sirve saberlo, sea cual sea."
- **D+7 (último):** "No te escribo más para no insistir. Si más adelante querés retomarlo, escribime y lo vemos."

La respuesta al D+3 se anota en "Motivo". Es el dato que hoy no tenemos.

### 4. Objeciones (solo si aparecen)
- **"Es caro":** "Entiendo. ¿Lo comparás con algo en particular? Una sola operación mal gestionada puede costar más que eso. Lo que se trabaja acá es el proceso para evitarla. Si hoy no es el momento, te aviso cuando abra un nuevo cupo." (Hipótesis: no ofrecer descuento por ahora. Ver la nota más abajo.)
- **"¿Tenés resultados?":** Mostrar el registro de señales cuando exista (Prioridad 2) y testimonios reales de alumnos, si hay **[A COMPLETAR]**. Nunca prometer rentabilidad.
- **"Más adelante":** "Perfecto. ¿Te escribo el [fecha concreta]?" Se anota en "Próximo contacto".

## Plan para recuperar las 40 consultas

1. **Reconstruir.** En WhatsApp, Instagram y Telegram, buscá "mentoría" y "precio" en los chats. Cada persona va en una fila de Consultas, con etapa "Recuperación" y la fecha aproximada.
2. **Mensaje de recuperación**, uno por persona:
   > Hola [nombre], hace un tiempo me consultaste por la mentoría de Trading Institucional y no llegué a hacerte un seguimiento como corresponde. ¿Seguís operando? Si me contás en qué estás hoy y qué te cuesta más, te digo con sinceridad si la mentoría te sirve o no.
3. **Mandalo desde tu teléfono, a mano, de a 10 por día.** No con el bot ni con Green API: mandar mensajes masivos a contactos que hace tiempo no te escriben aumenta el riesgo de que WhatsApp bloquee el número.
4. Si responde, sigue el proceso normal desde el paso 2 (calificación). Si no responde, un solo seguimiento a los 3 días y después "Cerrada sin respuesta".
5. **Medición:** cuántos respondieron, cuántos se calificaron y cuántos compraron. Con eso validamos o descartamos la hipótesis comercial.

## Nota sobre el precio
No recomiendo bajar el precio ni ofrecer cuotas todavía. El motivo principal registrado es silencio, no "es caro". Si después de 20 o 30 consultas con el proceso nuevo el motivo dominante pasa a ser el precio, ahí lo revisamos con datos.

## Columnas de la pestaña Consultas
Ver `plantillas/consultas.csv`. Pegá esta línea en la fila 1:
```
Fecha,Nombre,Canal,Contacto (alias),Origen,Experiencia,Problema principal,Etapa,Último contacto,Próximo contacto,Motivo,Resultado,Notas
```
Etapas: `Nueva`, `Calificando`, `Propuesta enviada`, `Seguimiento 1`, `Seguimiento 2`, `Seguimiento 3`, `Recuperación`, `Ganada`, `Perdida`, `Cerrada sin respuesta`.
