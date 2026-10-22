# Tasks: enlace público por ciclo (spec 027)

- [x] T001 Modelo `EnlaceCiclo` y migración aditiva `20261023140000_enlaces_ciclo` (aplicada en local, sin drift)
- [x] T002 `services/enlaces-ciclo.ts`: listar (ciclos del padrón + huérfanos), crear/renovar, desactivar y resolver el token (último acceso cada 5 min)
- [x] T003 `services/publico.ts`: `seguimientoDelCiclo` (sin celular, con asesores por sección) y reporte con `publico: 'CICLO'`
- [x] T004 Exportaciones: `publico` pasa a `'DOCENTE' | 'CICLO'` y `columnasOcultas` decide qué columnas no salen (Excel y PDF)
- [x] T005 Controladores, validación (`crearEnlacesCicloSchema`) y rutas: 3 de administración (`reportes.gestionar`) y 2 públicas
- [x] T006 Matriz de rutas (172) y `tests/advisory/enlaces-ciclo.test.ts` (16 pruebas)
- [x] T007 Documentación: contrato, `docs/api.md`, `docs/data-model.md`, `docs/arquitectura-ecosistema.md`, `README.md` y `AGENTS.md`
- [ ] T008 Producción: desplegar (la migración corre al iniciar), crear los enlaces desde el panel y entregarlos
