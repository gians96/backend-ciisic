# Taste — Command Code

## Communication
- Escribe y espera respuestas en español (registro informal, p. ej. "me pide eso, necesito levantar el servidor"); el idioma de trabajo del proyecto es español. Confidence: 0.75
- Prefiere que le expliquen *cómo* hacer las cosas ("quiero aprender cómo ver X, dame los pasos"): respuestas didácticas con pasos numerados, comandos exactos y el porqué, en lugar de solo ejecutar y entregar el resultado. Confidence: 0.7
- Valora que se le adviertan confusiones o conceptos malinterpretados de forma explícita (p. ej. aclarar que el hash mostrado es un ID de contenedor y no una contraseña) y que se indique cuando algo no aplica a su caso. Confidence: 0.55

## Workflow / Entorno
- Quiere que su entorno local refleje los datos reales de producción (restaurar un dump en el MySQL local) para verificar la UI con datos reales, y no conformarse con una BD vacía ni con datos de prueba generados. Confidence: 0.6

## Dominio del proyecto (CIISIC)
- En la inscripción de delegaciones el modelo aprobado es: autoservicio (el representante entra a `/delegaciones` y crea su grupo), sección propia de representante con la opción de que sea el integrante #1 (se muestra como fila 1 en solo lectura y el backend la agrega primero, no se manda en la lista), y **un solo pago** para todo el grupo (un único voucher y un único número de operación, guardados en la delegación, no en cada inscripción). Confidence: 0.65
- El link que comparte el staff es el que manda: el registro se **suma** a esa delegación (con su tarifa y su mínimo, no los del evento) y nunca crea una segunda delegación en el panel. Confidence: 0.7
- Reenviar la misma lista por el mismo link no duplica ni falla: a quien ya está en la delegación se le omite (la respuesta trae `omitidos`), y quien ya está inscrito en el evento por fuera se rechaza. Confidence: 0.65
- Regla de dominio: la tarifa y el monto total los calcula el backend a partir de la delegación (precio estándar/promocional y mínimo de integrantes); el cliente solo muestra un estimado y nunca manda precios. Confidence: 0.6
