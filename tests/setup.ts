import fs from 'fs'
import os from 'os'
import path from 'path'

// Entorno aislado para las pruebas: sin BD real, sin credenciales reales y con un
// directorio temporal de archivos por proceso de Jest.
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.CIISIC_UPLOADS_PRUEBAS = fs.mkdtempSync(path.join(os.tmpdir(), 'ciisic-test-'))
delete process.env.SECRETS_ENCRYPTION_KEY
delete process.env.BREVO_API_KEY
delete process.env.BREVO_SENDER
