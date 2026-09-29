import { prisma } from './prisma'
import { cifrar, sufijo } from '../core/crypto'

/**
 * Transición a secretos en BD (specs 003 y 006). Al arrancar, si el entorno todavía trae las
 * credenciales de la versión anterior y las tablas están vacías, se importan cifradas:
 *   - DECOLECTA_TOKEN            → pool de tokens de consulta DNI (`tokens_consulta`)
 *   - BREVO_API_KEY + BREVO_SENDER (+ BREVO_SENDER_NAME) → credencial de correo predeterminada
 * Solo importa cuando la tabla correspondiente está vacía: lo que se gestione luego desde el
 * panel nunca se sobrescribe. Devuelve los avisos que `server.ts` muestra en el log.
 */
const OBSOLETAS = ['NUBETEC_TOKEN', 'API_RENIEC_DNI', 'RENIEC_PROVIDER', 'RENIEC_TOKEN', 'API_URL', 'BREVO_SENDER_SUBJECT']

/** Valor de la variable sin espacios ni comillas envolventes (`"…"` o `'…'` de un .env). */
function valor(nombre: string): string {
    const texto = process.env[nombre]?.trim() ?? ''
    const comillas = /^(['"])(.*)\1$/s.exec(texto)
    return (comillas ? comillas[2] : texto).trim()
}

/** 00:00 del primer día del mes siguiente en hora de Lima (UTC−5). */
function inicioDelMesSiguiente(ahora = new Date()): Date {
    const lima = new Date(ahora.getTime() - 5 * 60 * 60 * 1000)
    return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth() + 1, 1, 5, 0, 0))
}

export async function importarSecretosLegados(): Promise<string[]> {
    const avisos: string[] = []

    const decolecta = valor('DECOLECTA_TOKEN')
    if (decolecta) {
        if (await prisma.tokenConsulta.count() === 0) {
            await prisma.tokenConsulta.create({
                data: {
                    proveedor: 'DECOLECTA',
                    nombre: 'Decolecta (importado del entorno)',
                    tokenCifrado: cifrar(decolecta),
                    tokenSufijo: sufijo(decolecta),
                    limiteConsultas: null,
                    periodoRenovacion: 'MENSUAL',
                    fechaRenovacion: inicioDelMesSiguiente(),
                    prioridad: 1,
                },
            })
            avisos.push('DECOLECTA_TOKEN se importó al pool de consultas DNI (panel → Consultas DNI). Ya puedes quitar la variable del entorno.')
        } else {
            avisos.push('DECOLECTA_TOKEN ya no se usa (los tokens se gestionan en el panel): quita la variable del entorno.')
        }
    }

    const brevo = valor('BREVO_API_KEY')
    if (brevo) {
        const remitente = valor('BREVO_SENDER').toLowerCase()
        if (await prisma.credencialCorreo.count() > 0) {
            avisos.push('BREVO_API_KEY/BREVO_SENDER/BREVO_SENDER_NAME ya no se usan (la credencial está en la BD): quítalas del entorno.')
        } else if (!remitente) {
            avisos.push('BREVO_API_KEY está definida pero falta BREVO_SENDER: no se importó la credencial de correo.')
        } else {
            await prisma.credencialCorreo.create({
                data: {
                    nombre: 'Brevo (importado del entorno)',
                    apiKeyCifrada: cifrar(brevo),
                    apiKeySufijo: sufijo(brevo),
                    remitenteCorreo: remitente,
                    remitenteNombre: valor('BREVO_SENDER_NAME') || null,
                    esPredeterminada: true,
                },
            })
            avisos.push('La credencial de Brevo se importó a la BD (panel → Correo). Ya puedes quitar BREVO_API_KEY, BREVO_SENDER y BREVO_SENDER_NAME del entorno.')
        }
    }

    for (const nombre of OBSOLETAS) {
        if (valor(nombre)) avisos.push(`${nombre} ya no se usa: quítala del entorno.`)
    }
    return avisos
}
