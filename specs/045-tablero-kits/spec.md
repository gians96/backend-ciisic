# Feature Specification: Tablero de kits — pendientes y entregados en el listado, el CSV y un tablero

**Created**: 2026-11-02 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: la organización quiere saber de un vistazo **qué se entrega con el kit**, **a quién le falta recibirlo** y **a quién ya se le entregó**, desde Inscripciones y en un tablero.
La spec 037 dejó el registro de la entrega (escáner, Asistencia y detalle) y excluyó expresamente «el kit en el CSV de inscritos y una vista de kits por delegación»: esta spec lo completa
**sin tocar el esquema** (todo sale de las columnas de la 037).

> **Numeración**: es la spec **045** del backend. Panel = spec 035. La landing no cambia. **No hay migración ni permiso nuevo.**

## Decisiones

- **Sin migración y sin permiso nuevo** (como la 037): los totales y el tablero se leen con `asistencia.ver`; el listado, el filtro y el CSV con `inscripciones.ver` / `inscripciones.exportar`; entregar y deshacer siguen
  siendo `asistencia.marcar`.
- **«A entregar» es una sola regla** (`aEntregar` en `src/core/kit.ts`): inscripción `APROBADO` con un tipo que incluye kit y es presencial. Es la base del resumen de la puerta (`kits/summary`) y del tablero, así
  que **los números coinciden** con la insignia «Kits: X entregados · Y pendientes de Z» de Asistencia.
- **Filtro `?kit=`** del listado y del CSV de inscripciones (`FILTROS_KIT`), siempre sobre la inscripción: `CON_KIT` (el tipo entrega kit, cualquier estado), `SIN_KIT` (no lo entrega: tipo sin kit, virtual o cortesía sin tipo),
  `PENDIENTE` (aprobada, con kit y sin entregar), `ENTREGADO` (ya entregado, el que sea su estado o tipo), `POR_APROBAR` (con kit, sin entregar y con el pago aún pendiente o en revisión) y `REVISAR` (ya entregado pero hoy no le
  corresponde: su inscripción dejó de estar aprobada o su tipo ya no entrega kit). Un valor desconocido responde `422 VALIDATION_ERROR` (como `?modalidad=`): nunca se ignora, o el CSV saldría sin filtrar.
- **Siempre en positivo y como un elemento más de `AND`**: sin `NOT` (una cortesía sin tipo tiene el `tipoInscripcionId` nulo y la negación de una relación la dejaría fuera) y sin pisar el `estado`, el `tipoInscripcion` ni el
  `OR` de la búsqueda de los demás filtros. Sin `kit`, la consulta es idéntica a la de antes.
- **Orden**: con `ENTREGADO` o `REVISAR` el listado va de la entrega más reciente a la más antigua (se lee como «últimas entregas»); con el resto, por fecha de registro como siempre.
- **Las filas del listado traen `kit` completo** (`{ incluye, entregado, entregadoEn, entregadoPor }`) además de `kitEntregado` (que se conserva). La 037 lo dejaba solo en el detalle; el tablero lista a quién se entregó, cuándo y quién.
- **CSV**: tres columnas **al final** (como la spec 040: quien lee el CSV por posición no nota el cambio): `Kit` (Entregado / Pendiente de entrega / Pago por aprobar / No incluye / No corresponde), `Kit entregado el` (fecha y hora
  de Lima) y `Kit entregado por`. Salen también sin «pagos.ver» (no son un dato de pago). Con `?kit=PENDIENTE` se baja la lista de quién falta.
- **Tablero** (`GET /v1/events/:eventId/kits/dashboard`, `asistencia.ver`): solo cifras y los nombres de quienes entregan, **nunca datos de los inscritos** (las personas salen del listado). Trae los totales, las cifras por tipo, las entregas por
  día y hora de Lima y quién entrega. Es un endpoint aparte para que el resumen de la puerta (`summary`), que se refresca tras cada lectura, siga siendo liviano.
- **Vista por delegación sin código aparte**: los planes de una delegación son tipos de su categoría oculta; salen en `porTipo` con su `delegacionId`.
- **El contenido del kit** (mochila, tomatodo, fotocheck con QR y cordón, certificado de 100 horas) no se guarda en el servidor: lo muestra el panel (constante espejo de la landing).

## User Scenarios & Testing

1. **Given** hay kits sin entregar, **When** pido `?kit=PENDIENTE` (o bajo el CSV con ese filtro), **Then** salen solo las inscripciones aprobadas con kit y sin entregar.
2. **Given** ya se entregaron kits, **When** pido `?kit=ENTREGADO`, **Then** salen de la entrega más reciente a la más antigua, con cuándo y quién (`kit.entregadoEn`, `kit.entregadoPor`).
3. **Given** una persona con kit entregado cuya inscripción se canceló después (o cuyo tipo pasó a «sin kit»), **Then** cuenta en `aRevisar` y sale con `?kit=REVISAR`, no en `entregados`.
4. **Given** una cuenta con `asistencia.ver`, **When** pide el tablero, **Then** recibe cifras que coinciden con `kits/summary`; sin ese permiso o de otro evento, `403`.
5. **Given** `?kit=TODOS` (o cualquier valor desconocido), **Then** `422` y no se consulta nada.

## Requirements

- **FR-001**: `FILTROS_KIT`, `esFiltroKit`, `condicionKit`, `aEntregar`, `situacionKit` y `TEXTO_SITUACION_KIT` en `src/core/kit.ts`.
- **FR-002**: `FiltrosInscripcion.kit`, `construirFiltro` (un elemento más de `AND`) y `ordenDelListado`; `?kit=` en `GET …/inscriptions` y `GET …/inscriptions/export`.
- **FR-003**: `aFilaLista` agrega `kit`; `COLUMNAS_CSV` agrega `Kit`, `Kit entregado el` y `Kit entregado por` al final.
- **FR-004**: `GET /v1/events/:eventId/kits/dashboard` (`asistencia.ver`, evento del parámetro) con `totales`, `porTipo`, `entregas` y `porPersona`.
- **FR-005**: `resumenKits` usa `aEntregar` (sin cambiar su respuesta).

## Fuera de alcance

- Entregar el kit **sin marcar asistencia** (un mostrador de kits solo por QR): hoy se entrega desde el escáner, Asistencia y el detalle.
- Entrega por ítem (mochila, tomatodo…): el kit se entrega completo; una excepción se anota fuera del sistema.
- Un permiso propio para el kit.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; la matriz de rutas clasifica la ruta nueva (210). No hay migración: no aplica `migrate diff`.
- **SC-002**: `kits/dashboard` y `kits/summary` dan siempre los mismos `conKit`, `entregados` y `pendientes`, y el listado con `?kit=PENDIENTE` tiene tantas filas como `pendientes`.
