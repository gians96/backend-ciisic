import { apiperu } from '../../src/api/document-lookup/providers/apiperu'
import { decolecta } from '../../src/api/document-lookup/providers/decolecta'
import { FallaProveedor } from '../../src/api/document-lookup/providers/types'

const respuesta = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

let fetchMock: jest.SpyInstance
beforeEach(() => { fetchMock = jest.spyOn(global, 'fetch') })
afterEach(() => fetchMock.mockRestore())

async function falla(promesa: Promise<unknown>): Promise<FallaProveedor> {
    try {
        await promesa
    } catch (error) {
        return error as FallaProveedor
    }
    throw new Error('Se esperaba una falla')
}

describe('adaptador Decolecta', () => {
    it('llama al endpoint documentado y normaliza la respuesta', async () => {
        fetchMock.mockReturnValue(respuesta(200, { first_name: 'ROXANA KARINA', first_last_name: 'DELGADO', second_last_name: 'HUAMANI', full_name: 'DELGADO HUAMANI ROXANA KARINA', document_number: '46027897' }))
        const persona = await decolecta.consultarDni('46027897', 'tok', 1000)
        expect(persona).toEqual({ numero: '46027897', nombres: 'ROXANA KARINA', apellidoPaterno: 'DELGADO', apellidoMaterno: 'HUAMANI' })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.decolecta.com/v1/reniec/dni?numero=46027897')
        expect(init.headers.Authorization).toBe('Bearer tok')
    })

    it.each([
        [401, { error: 'Unauthorized' }, 'TOKEN_INVALIDO'],
        [429, { error: 'Too many requests' }, 'AGOTADO'],
        [400, { error: 'Invalid request' }, 'NO_ENCONTRADO'],
        [500, { error: 'boom' }, 'NO_DISPONIBLE'],
        [200, { message: 'Has superado el límite de tu plan' }, 'AGOTADO'],
    ])('clasifica %s como falla del tipo esperado', async (status, body, tipo) => {
        fetchMock.mockReturnValue(respuesta(status, body))
        expect((await falla(decolecta.consultarDni('12345678', 't', 1000))).tipo).toBe(tipo)
    })

    it('convierte errores de red en NO_DISPONIBLE', async () => {
        fetchMock.mockRejectedValue(new TypeError('network'))
        expect((await falla(decolecta.consultarDni('12345678', 't', 1000))).tipo).toBe('NO_DISPONIBLE')
    })
})

describe('adaptador apiperu', () => {
    it('envía POST con el DNI y normaliza la respuesta', async () => {
        fetchMock.mockReturnValue(respuesta(200, { success: true, code: 'found', data: { numero: '44556677', nombre_completo: 'PEREZ GARCIA JUAN CARLOS', nombres: 'JUAN CARLOS', apellido_paterno: 'PEREZ', apellido_materno: 'GARCIA' } }))
        const persona = await apiperu.consultarDni('44556677', 'tok', 1000)
        expect(persona).toEqual({ numero: '44556677', nombres: 'JUAN CARLOS', apellidoPaterno: 'PEREZ', apellidoMaterno: 'GARCIA' })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.apiperu.dev/dni')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ dni: '44556677' })
    })

    it.each([
        [404, { success: false, code: 'document_not_found', message: 'El DNI no existe' }, 'NO_ENCONTRADO'],
        [429, { success: false, code: 'quota_exceeded', message: 'Límite alcanzado' }, 'AGOTADO'],
        [401, { success: false, message: 'token inválido' }, 'TOKEN_INVALIDO'],
        [403, { success: false, message: 'Tu plan no incluye este endpoint' }, 'TOKEN_INVALIDO'],
        [503, { success: false, code: 'upstream_unavailable', retryable: true }, 'NO_DISPONIBLE'],
    ])('clasifica %s correctamente', async (status, body, tipo) => {
        fetchMock.mockReturnValue(respuesta(status, body))
        expect((await falla(apiperu.consultarDni('12345678', 't', 1000))).tipo).toBe(tipo)
    })
})
