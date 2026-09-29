import fs from 'fs'
import os from 'os'
import path from 'path'

// Entorno aislado para las pruebas: sin BD real, sin credenciales reales y con un
// directorio temporal de archivos por proceso de Jest.
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ciisic-test-'))
process.env.UNDC_API_URL = 'https://api-undc.test'
process.env.UNDC_API_KEY = 'undc_test_key'
delete process.env.SECRETS_ENCRYPTION_KEY
delete process.env.BREVO_API_KEY
delete process.env.BREVO_SENDER
