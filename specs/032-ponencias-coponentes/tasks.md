# Tasks: Temas de ponencias especializadas con varios ponentes

- [x] T001 Migración aditiva `20261025120000_ponencias_coponentes` (columna JSON nula `coponentes`) y esquema
- [x] T002 `coponentesDe` y `MAXIMO_COPONENTES` en `src/core/ponencias-especializadas.ts` (lectura tolerante del JSON)
- [x] T003 Validación de `coponentes` al crear y editar (máx. 3, mismas reglas que el principal) y servicio (`aColumnaCoponentes`, respuesta `coponentes`)
- [x] T004 Pruebas: núcleo (`coponentesDe`), API del panel (crear, validar, reemplazar, conservar, vaciar) y del sitio
- [x] T005 Contrato, AGENTS.md, README y `docs/arquitectura-ecosistema.md`
- [x] T006 Landing (spec 011) y panel (spec 023) en la rama `feat/ponencias-coponentes` de cada repo
- [x] T007 Producción (con permiso, 2026-10-22): respaldo de `ponencias_especializadas` e `inscripciones_ponencia`, migración aplicada y datos del cronograma
      (3 temas nuevos —dos compartidos—, Percy Salcedo al martes, Carlos Almidon al Auditorio)
- [ ] T008 Producción: desplegar backend, landing (con las fotos) y panel, en ese orden
