# Feature Specification: Temas de ponencias especializadas con varios ponentes

**Created**: 2026-10-22 · **Status**: Implementado en el backend; migración aplicada en producción (el código aún no se despliega)

**Input**: el cronograma de la organización trae temas que **dictan varias personas a la misma hora y en el mismo ambiente**
(dos temas del miércoles 28: «¿Puede la IA aprender cómo aprende cada estudiante?…» con Saúl Arauco y Karen Alcos, y «Automatización y
control inteligente…» con Ángel Almidón y Javier Poma). Hasta ahora una ponencia llevaba un solo ponente embebido
(`ponente_nombre`, `_bio`, `_foto`, `_externo`).

> **Numeración**: es la spec **032** del backend. Landing = spec 011 · Panel = spec 023.

## Decisiones

- **Un tema = una fila.** El tema compartido sigue siendo **una sola** `PonenciaEspecializada`: una inscripción, un cupo, un ambiente y un
  horario. Se descartó duplicar la fila por ponente (dos filas del mismo ambiente y hora chocan con `ROOM_CONFLICT`, el tema saldría dos veces
  en la landing y cada persona podría ocupar dos cupos).
- **El principal no cambia.** `ponente_*` sigue siendo el ponente principal (el primero): ninguna lectura anterior se rompe y un backend o
  un panel anteriores siguen funcionando (el panel anterior solo ve al principal).
- **Los demás van en una columna JSON** `coponentes` (`[{ nombre, bio, foto, externo }]`, hasta **3**, `NULL` = ninguno) y **no** en una tabla:
  son datos que solo se muestran (no se consultan, filtran ni unen), viven y mueren con la ponencia y así no cambia ninguno de los sitios
  que leen una `PonenciaEspecializada` sin relaciones. `coponentesDe` lee la columna con tolerancia (ignora lo que no tenga forma de ponente).
- **API aditiva**: la respuesta (panel y sitio) agrega `coponentes` (siempre un arreglo, `[]` si no hay). La entrada acepta `coponentes`:
  al **crear**, por defecto `[]`; al **editar**, ausente = se conserva, un arreglo los **reemplaza** y `[]` los quita (guarda `NULL`).
  Cada coponente lleva las mismas reglas que el principal (nombre de 2 a 200 caracteres, perfil hasta 5000, foto con ruta del sitio o URL https).
- **Nada más cambia**: cupo, cruces de horario, ambiente libre, inscripciones y asistencia siguen siendo por ponencia.

## User Scenarios & Testing

1. **Given** un tema que dictan dos personas, **When** el staff lo crea con `ponente` y `coponentes`, **Then** el listado del panel y el del
   sitio traen al principal en `ponente` y al otro en `coponentes`, y el tema sigue ocupando un solo ambiente y un solo cupo.
2. **Given** una ponencia con coponentes, **When** el staff edita solo el tema o solo el principal, **Then** los coponentes se conservan.
3. **Given** una ponencia con coponentes, **When** el staff envía `coponentes: []`, **Then** queda con un solo ponente.
4. **Given** más de 3 coponentes, un coponente sin nombre o con una foto inválida, **Then** `422` con el campo (`coponentes[0].nombre`).
5. **Given** una ponencia anterior a la columna, **Then** responde `coponentes: []`.

## Despliegue

Aditivo. La migración `20261025120000_ponencias_coponentes` agrega una columna nula; el código anterior la ignora, así que se puede aplicar
antes que el código (se hizo así en producción el 2026-10-22, y `migrate deploy` no la repite). Orden: backend, luego landing y panel.
