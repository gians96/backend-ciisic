import app from './app'
import { advertencias, env } from '../config/env'
import { importarSecretosLegados } from './database/importarSecretosLegados'

async function revisarConfiguracion() {
  for (const aviso of advertencias) console.warn(`⚠️  ${aviso}`)
  try {
    for (const aviso of await importarSecretosLegados()) console.warn(`⚠️  ${aviso}`)
  } catch (error) {
    console.error('No se pudieron revisar las credenciales del entorno:', error instanceof Error ? error.message : error)
  }
}

void revisarConfiguracion().finally(() => {
  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`🚀 Server corriendo en http://0.0.0.0:${env.PORT}`)
  })
})
// No tocar
