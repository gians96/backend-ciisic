# Contrato — Ponentes que comparten un tema (spec 032)

Extiende el contrato de la spec 019 (`../../019-ponencias-especializadas/contracts/api-ponencias-especializadas.md`). Cambio **aditivo**.

## Respuesta (panel `aPonencia` y sitio `aPonenciaPublica`)

```json
{
  "id": 24, "tema": "Automatización y control inteligente de sistemas electromecánicos, neumáticos e hidráulicos en la Industria 4.0",
  "ambiente": "Aula 2", "cupo": 40,
  "ponente": { "nombre": "Dr. Ángel Almidón Elescano", "bio": "…", "foto": "/images/ponentes/2026/especializados/angel-almidon.webp", "externo": true },
  "coponentes": [
    { "nombre": "Dr. Javier Camilo Poma Palacios", "bio": "…", "foto": "/images/ponentes/2026/especializados/javier-poma.webp", "externo": true }
  ]
}
```

- `ponente`: el principal (sin cambios). `coponentes`: los demás, en orden; **siempre** presente, `[]` si el tema lo dicta una sola persona.
- Todos los ponentes de un tema: `[ponente, ...coponentes]`.
- Un consumidor anterior ignora `coponentes` y muestra solo al principal.

## Entrada (`POST /v1/events/:eventId/specialized-talks`, `PUT /v1/specialized-talks/:id`; `.gestionar`)

| Campo | Crear | Editar |
|---|---|---|
| `coponentes` | opcional, por defecto `[]` | ausente = se conserva · arreglo = reemplaza la lista · `[]` = la quita |
| `coponentes[].nombre` | obligatorio, 2–200 caracteres | igual |
| `coponentes[].bio` | opcional, hasta 5000 | igual (vacío = `null`) |
| `coponentes[].foto` | opcional, ruta del sitio (`/images/…`) o URL https | igual |
| `coponentes[].externo` | opcional, `false` | igual |

- Máximo **3** coponentes (`422` con `fields.coponentes`). Los errores de cada uno llevan su posición: `coponentes[1].foto`.
- El resto de las reglas (ambiente libre, cupo, horas) son de la ponencia y no cambian: un tema compartido ocupa **un** ambiente y **un** cupo.
- Almacenamiento: columna `ponencias_especializadas.coponentes` (JSON, nula = sin coponentes).
