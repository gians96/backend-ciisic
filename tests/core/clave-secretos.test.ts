import crypto from 'crypto'

/**
 * Spec 008 (enmienda del 2026-09-30): el entorno ya no lleva SECRETS_ENCRYPTION_KEY. La clave de
 * los secretos guardados en la BD se deriva de JWT_SECRET y el hash de los tokens de acceso no
 * depende de ninguna clave.
 */
const ENTORNO_ORIGINAL = { ...process.env }
const JWT_ANTERIOR = 'jwt-secret-anterior-de-al-menos-32-caracteres'
const JWT_NUEVO = 'jwt-secret-nuevo-tambien-de-al-menos-32-caracteres'
const PRODUCCION = { NODE_ENV: 'production', JWT_SECRET: JWT_ANTERIOR, DATABASE_URL: 'mysql://u:p@db:3306/ciisic' }

/** Carga módulos frescos con las variables indicadas (`undefined` las elimina). */
async function conEntorno<T>(variables: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    let resultado: T | undefined
    await jest.isolateModulesAsync(async () => {
        for (const [nombre, valor] of Object.entries(variables)) {
            if (valor === undefined) delete process.env[nombre]
            else process.env[nombre] = valor
        }
        resultado = await fn()
    })
    return resultado as T
}

afterEach(() => {
    process.env = { ...ENTORNO_ORIGINAL }
})

describe('clave de los secretos guardados en la BD', () => {
    it('en producción arranca sin SECRETS_ENCRYPTION_KEY y deriva la clave de JWT_SECRET', async () => {
        const clave = await conEntorno({ ...PRODUCCION, SECRETS_ENCRYPTION_KEY: undefined },
            async () => (await import('../../config/env')).env.CLAVE_SECRETOS)

        expect(clave).toHaveLength(32)
        expect(clave.equals(crypto.createHash('sha256').update(`secrets:${JWT_ANTERIOR}`).digest())).toBe(true)
    })

    it('ignora una SECRETS_ENCRYPTION_KEY que haya quedado en el entorno', async () => {
        const conVariable = await conEntorno({ ...PRODUCCION, SECRETS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') },
            async () => (await import('../../config/env')).env.CLAVE_SECRETOS)
        const sinVariable = await conEntorno({ ...PRODUCCION, SECRETS_ENCRYPTION_KEY: undefined },
            async () => (await import('../../config/env')).env.CLAVE_SECRETOS)

        expect(conVariable.equals(sinVariable)).toBe(true)
    })

    it('si cambia JWT_SECRET, el error pide volver a guardar la credencial en el panel', async () => {
        const cifrado = await conEntorno({ JWT_SECRET: JWT_ANTERIOR },
            async () => (await import('../../src/core/crypto')).cifrar('api-key-1234'))
        const { descifrar } = await conEntorno({ JWT_SECRET: JWT_NUEVO }, async () => import('../../src/core/crypto'))

        expect(() => descifrar(cifrado)).toThrow(/vuelve a guardar la credencial en el panel/)
    })
})

describe('hash de los tokens de acceso', () => {
    it('no depende de JWT_SECRET: rotarlo no invalida los tokens de las landings', async () => {
        const token = `ciisic_${'a'.repeat(43)}`
        const antes = await conEntorno({ JWT_SECRET: JWT_ANTERIOR },
            async () => (await import('../../src/core/tokens-acceso')).hashTokenAcceso(token))
        const despues = await conEntorno({ JWT_SECRET: JWT_NUEVO },
            async () => (await import('../../src/core/tokens-acceso')).hashTokenAcceso(token))

        expect(antes).toMatch(/^[0-9a-f]{64}$/)
        expect(despues).toBe(antes)
    })
})
