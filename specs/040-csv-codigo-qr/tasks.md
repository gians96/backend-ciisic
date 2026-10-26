# Tasks: Código del QR y enlace de la credencial 3D en el CSV de inscripciones

- [x] T001 `inscription/services/inscription.ts`: columnas «Código QR» y «Credencial 3D» al final de `COLUMNAS_CSV` (sin `pago: true`); `exportarCsv` lee `url_landing` con `obtenerConfiguracion`
- [x] T002 Pruebas en `tests/inscription/admin.test.ts`: Tesorero y Comisión reciben el código; el enlace solo en las aprobadas y vacío sin landing; el listado sigue sin el código
- [x] T003 AGENTS.md (regla del `codigo_credencial`), `docs/api.md`, `docs/arquitectura-ecosistema.md`, contrato de la spec 002 y README
- [ ] T004 Probado en local con el panel: descargar el CSV y comprobar que el código genera el mismo QR que el PDF
