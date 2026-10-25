import fs from 'fs'
import path from 'path'
import type { RequestHandler } from 'express'
import * as auth from '../../src/middlewares/auth'
import { requireParticipante, requirePermiso, requireSesion, type GuardaPermiso } from '../../src/middlewares/auth'
import { requireTokenEvento } from '../../src/middlewares/sitio'
import { rutaLegacy } from '../../src/middlewares/legacy'
import {
    limiteAvisosPonencias, limiteCargaPadron, limiteCheckInPonencia, limiteDescargaReportes, limiteDescargaResumenPonencias, limiteEnlacesAsesores, limiteGestionDocentes, limiteLecturaReportes, limiteMarcarAsistencia, limiteReenvioCredencial, limiteRenovacionSesion, limiteSwitch,
} from '../../src/middlewares/rate-limit'
import { ALCANCE, type Permiso } from '../../src/core/permisos'
import {
    eventoDeActividad, eventoDeAsistencia, eventoDeDelegacion, eventoDeInscripcion, eventoDeInscripcionPonencia, eventoDelParametro, eventoDeMensaje, eventoDePonencia, eventoDePonenciaEspecializada,
} from '../../src/core/resolutores-evento'

/**
 * Matriz de rutas (spec 013): carga los routers igual que `src/loaders/routesLoader.ts` y exige que
 * TODA ruta esté clasificada (pública, sitio, participante, sesión o staff) y que las de staff
 * tengan exactamente la guarda esperada. Una ruta nueva sin clasificar hace fallar esta prueba.
 */
jest.mock('../../src/database/prisma', () => ({ prisma: {} }))

// `validateBody` devuelve una función anónima: se marca para poder ubicarla en la pila de la ruta
jest.mock('../../src/middlewares/validate', () => {
    const real = jest.requireActual('../../src/middlewares/validate') as typeof import('../../src/middlewares/validate')
    return {
        ...real,
        validateBody: (...args: Parameters<typeof real.validateBody>) => Object.assign(real.validateBody(...args), { validaCuerpo: true }),
    }
})

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Clave = `${Metodo} /v1/${string}`
type Handle = RequestHandler & { guarda?: GuardaPermiso, validaCuerpo?: boolean }

interface Capa { handle: Handle, route?: { path: string, methods: Record<string, boolean>, stack: { handle: Handle }[] } }
interface Ruta { clave: Clave, archivo: string, handles: Handle[] }

function cargarRutas(): { rutas: Ruta[], capasSinRuta: string[] } {
    const dirApi = path.join(__dirname, '../../src/api')
    const rutas: Ruta[] = []
    const capasSinRuta: string[] = []
    for (const modulo of fs.readdirSync(dirApi)) {
        const dirRutas = path.join(dirApi, modulo, 'routes')
        if (!fs.existsSync(dirRutas)) continue
        for (const archivo of fs.readdirSync(dirRutas).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))) {
            const router = require(path.join(dirRutas, archivo)).default as { stack: Capa[] }
            for (const capa of router.stack) {
                if (!capa.route) {
                    capasSinRuta.push(`${modulo}/${archivo}`)
                    continue
                }
                for (const metodo of Object.keys(capa.route.methods)) {
                    rutas.push({ clave: `${metodo.toUpperCase() as Metodo} ${capa.route.path}` as Clave, archivo: `${modulo}/${archivo}`, handles: capa.route.stack.map((c) => c.handle) })
                }
            }
        }
    }
    return { rutas, capasSinRuta }
}

const { rutas, capasSinRuta } = cargarRutas()

/** Rutas sin sesión ni token. Cada una se revisó a mano: agregar otra exige justificarla aquí. */
const PUBLICAS: readonly Clave[] = [
    'POST /v1/auth/login',
    'POST /v1/auth/google',
    'GET /v1/auth/config',
    // Código por correo (spec 014): respuesta idéntica exista o no el correo; topes por correo, IP y globales
    'POST /v1/auth/participant/code',
    'POST /v1/auth/participant/code/verify',
    'GET /v1/classification',
    'GET /v1/classification/:id',
    'GET /v1/document-type',
    'GET /v1/inscription-state',
    // Legacy de la landing anterior (se apagan desde Sistema)
    'GET /v1/deposit-method',
    'GET /v1/payment-type',
    'POST /v1/contact',
    'POST /v1/inscription',
    'POST /v1/papers',
    'GET /v1/registration-types',
    'GET /v1/registration-types/:id',
    // Vista del docente con su enlace (spec 026): sin sesión, el token va en X-Link-Token y hay topes por IP
    'GET /v1/public/advisor',
    'GET /v1/public/advisor/export',
    'GET /v1/public/cycle',
    'GET /v1/public/cycle/export',
    'POST /v1/public/advisor/lookup',
    'POST /v1/public/advisor/lookup/export',
]

/** API del sitio: el evento sale del token de acceso (`requireTokenEvento`). */
const SITIO: readonly Clave[] = [
    'GET /v1/site/catalogs',
    'POST /v1/site/contact',
    'GET /v1/site/delegations/link/:codigoLink',
    'POST /v1/site/delegations/link/:codigoLink/participants',
    'POST /v1/site/delegations/link/:codigoLink/payments',
    'GET /v1/site/delegations/join/:codigoInscripcion',
    'POST /v1/site/delegations/join/:codigoInscripcion/participants',
    'GET /v1/site/document-lookup/dni/:numero',
    'GET /v1/site/event',
    'POST /v1/site/google-verification',
    'POST /v1/site/inscriptions',
    'POST /v1/site/papers',
    'GET /v1/site/payment-qr/:archivo',
    'GET /v1/site/registration-types',
    'POST /v1/site/student-verification',
    'GET /v1/site/config',
    // Ponencias especializadas (spec 019)
    'GET /v1/site/specialized-talks',
    'POST /v1/site/specialized-talk-registrations',
    // Verificación previa del congresista (spec 030)
    'POST /v1/site/specialized-talk-eligibility',
    // Aforo con el enlace público (spec 036): además del token del sitio, el del enlace en X-Link-Token
    'GET /v1/site/specialized-talk-occupancy',
]

const PARTICIPANTE: readonly Clave[] = [
    'GET /v1/me', 'GET /v1/me/inscriptions', 'GET /v1/me/inscriptions/:id/credential',
    // Portal v2 (spec 014)
    'PATCH /v1/me/profile', 'GET /v1/me/photo', 'PUT /v1/me/photo', 'DELETE /v1/me/photo', 'GET /v1/me/inscriptions/:id/badge', 'GET /v1/me/attendances',
]
const SESION: readonly Clave[] = ['GET /v1/auth/session']

interface Esperada { permisos: Permiso[], evento: string | null, filtraPorActor: boolean }

/** Guarda esperada: permisos (OR) y el resolutor del evento, si lo hay. */
const g = (permisos: Permiso | Permiso[], evento: { nombre: string } | null = null): Esperada => ({
    permisos: [permisos].flat().sort(), evento: evento?.nombre ?? null, filtraPorActor: false,
})
/** `requireActor`: cualquier cuenta activa; el controlador filtra por sus eventos. */
const ACTOR: Esperada = { permisos: [], evento: null, filtraPorActor: true }
const P = (param = 'eventId') => eventoDelParametro(param)

/** Autoridad: la tabla ruta → guarda de la spec 013. */
const MATRIZ: Record<Clave, Esperada> = {
    // access-token
    'GET /v1/events/:eventId/access-tokens': g('eventos.configurar'),
    'POST /v1/events/:eventId/access-tokens': g('eventos.configurar'),
    'DELETE /v1/access-tokens/:id': g('eventos.configurar'),

    // activity
    'GET /v1/events/:eventId/activities': g(['asistencia.ver', 'eventos.configurar'], P()),
    'POST /v1/events/:eventId/activities': g('eventos.configurar'),
    'PUT /v1/activities/:id': g('eventos.configurar'),
    'DELETE /v1/activities/:id': g('eventos.configurar'),
    'GET /v1/activities/:id/attendances': g('asistencia.ver', eventoDeActividad),
    'POST /v1/activities/:id/attendances': g('asistencia.marcar', eventoDeActividad),
    'DELETE /v1/attendances/:id': g('asistencia.anular', eventoDeAsistencia),
    'GET /v1/events/:eventId/attendances/export': g('asistencia.exportar', P()),
    'POST /v1/attendances/export': g('legacy.usar'),
    'POST /v1/attendances/overtime': g('legacy.usar'),
    'POST /v1/attendances': g('legacy.usar'),
    'GET /v1/attendances/:id': g('legacy.usar'),

    // admin
    'GET /v1/admin': g('administradores.gestionar'),
    'POST /v1/admin': g('administradores.gestionar'),
    'GET /v1/admin/:id': g('administradores.gestionar'),
    'PUT /v1/admin/:id': g('administradores.gestionar'),
    'DELETE /v1/admin/:id': g('administradores.gestionar'),
    'POST /v1/auth/refresh': ACTOR,
    // participant-auth: el staff que entró con Google pasa a su portal (el servicio exige el método)
    'POST /v1/auth/participant/switch': ACTOR,

    // catalog
    'POST /v1/classification': g('catalogos.configurar'),
    'PUT /v1/classification/:id': g('catalogos.configurar'),
    'DELETE /v1/classification/:id': g('catalogos.configurar'),
    'GET /v1/roles': g('administradores.gestionar'),

    // contact
    'GET /v1/contact': g('legacy.usar'),
    'GET /v1/contact/:id': g('legacy.usar'),
    'DELETE /v1/contact/:id': g('legacy.usar'),
    'GET /v1/events/:eventId/contact-messages': g('mensajes.ver', P()),
    'PATCH /v1/contact-messages/:id': g('mensajes.ver', eventoDeMensaje),
    'DELETE /v1/contact-messages/:id': g('mensajes.eliminar', eventoDeMensaje),

    // delegation
    // Ver: Tesorero y la Comisión elegida. Inscribir: la Comisión elegida. Gestionar (planes, precios, dominio, links): solo cuentas globales (spec 029)
    'GET /v1/events/:eventId/delegations': g('delegaciones.ver', P()),
    'POST /v1/events/:eventId/delegations': g(['delegaciones.gestionar', 'delegaciones.inscribir'], P()),
    'GET /v1/delegations/:id': g('delegaciones.ver', eventoDeDelegacion),
    'PUT /v1/delegations/:id': g('delegaciones.inscribir', eventoDeDelegacion),
    'PUT /v1/delegations/:id/config': g('delegaciones.gestionar', eventoDeDelegacion),
    'POST /v1/delegations/:id/links/regenerate': g('delegaciones.gestionar', eventoDeDelegacion),
    'POST /v1/delegations/:id/inscriptions': g('delegaciones.inscribir', eventoDeDelegacion),
    'PATCH /v1/delegations/:id/inscriptions/:inscriptionId': g('delegaciones.inscribir', eventoDeDelegacion),
    'DELETE /v1/delegations/:id/inscriptions/:inscriptionId': g('delegaciones.inscribir', eventoDeDelegacion),
    // Revisar pagos y aprobar al grupo es de quien valida inscripciones (Tesorero)
    'POST /v1/delegations/:id/approve': g('inscripciones.validar', eventoDeDelegacion),
    'POST /v1/delegations/:id/payments': g('delegaciones.inscribir', eventoDeDelegacion),
    'PATCH /v1/delegations/:id/payments/:paymentId': g('inscripciones.validar', eventoDeDelegacion),
    'DELETE /v1/delegations/:id/payments/:paymentId': g(['delegaciones.gestionar', 'inscripciones.validar'], eventoDeDelegacion),
    // El voucher de cada pago lo ve quien revisa pagos
    'GET /v1/delegations/:id/payments/:paymentId/voucher': g('pagos.ver', eventoDeDelegacion),

    // document-lookup
    'GET /v1/document-lookup/dni/:numero': g('consultas_dni.gestionar'),
    'GET /v1/lookup-tokens': g('consultas_dni.gestionar'),
    'POST /v1/lookup-tokens': g('consultas_dni.gestionar'),
    'GET /v1/lookup-tokens/usage': g('consultas_dni.gestionar'),
    'GET /v1/lookup-tokens/logs': g('consultas_dni.gestionar'),
    'PUT /v1/lookup-tokens/:id': g('consultas_dni.gestionar'),
    'DELETE /v1/lookup-tokens/:id': g('consultas_dni.gestionar'),
    'POST /v1/lookup-tokens/:id/reset': g('consultas_dni.gestionar'),
    'POST /v1/lookup-tokens/:id/test': g('consultas_dni.gestionar'),

    // email-credential
    'GET /v1/email-credentials': g('correo.configurar'),
    'POST /v1/email-credentials': g('correo.configurar'),
    'PUT /v1/email-credentials/:id': g('correo.configurar'),
    'DELETE /v1/email-credentials/:id': g('correo.configurar'),
    'POST /v1/email-credentials/:id/test': g('correo.configurar'),
    'POST /v1/email-credentials/:id/send-test': g('correo.configurar'),

    // event
    'GET /v1/events': ACTOR,
    'POST /v1/events': g('eventos.configurar'),
    'GET /v1/events/:id': g('eventos.configurar'),
    'PUT /v1/events/:id': g('eventos.configurar'),
    'DELETE /v1/events/:id': g('eventos.eliminar'),
    'GET /v1/events/:id/summary': g('resumen.ver', P('id')),

    // inscription
    'GET /v1/inscription': g('legacy.usar'),
    'GET /v1/inscription/:id': g('legacy.usar'),
    'PUT /v1/inscription/:id/status': g('legacy.usar'),
    'DELETE /v1/inscription/:id': g('inscripciones.eliminar'),
    'GET /v1/events/:eventId/inscriptions': g('inscripciones.ver', P()),
    'GET /v1/events/:eventId/inscriptions/export': g('inscripciones.exportar', P()),
    'GET /v1/inscriptions/:id': g('inscripciones.ver', eventoDeInscripcion),
    'PATCH /v1/inscriptions/:id/status': g('inscripciones.validar', eventoDeInscripcion),
    // Corregir el tipo (spec 035): permiso global, solo del Owner
    'PATCH /v1/inscriptions/:id/type': g('inscripciones.cambiar_tipo'),
    'POST /v1/inscriptions/:id/resend-credential': g('credenciales.reenviar', eventoDeInscripcion),
    'GET /v1/inscriptions/:id/voucher': g('pagos.ver', eventoDeInscripcion),
    'GET /v1/inscriptions/:id/credential': g('inscripciones.ver', eventoDeInscripcion),
    'GET /v1/inscriptions/:id/photo': g(['asistencia.marcar', 'inscripciones.ver'], eventoDeInscripcion),
    'POST /v1/events/:eventId/courtesy-inscriptions': g('inscripciones.cortesia'),
    'DELETE /v1/inscriptions/:id': g('inscripciones.eliminar'),

    // integration
    'GET /v1/events/:eventId/integrations': g('eventos.configurar'),
    'POST /v1/events/:eventId/integrations': g('eventos.configurar'),
    'GET /v1/events/:eventId/integrations/sports-summary': g('resumen.ver', P()),
    'PUT /v1/integrations/:id': g('eventos.configurar'),
    'DELETE /v1/integrations/:id': g('eventos.configurar'),
    'POST /v1/integrations/:id/test': g('eventos.configurar'),

    // papers
    'GET /v1/papers': g('legacy.usar'),
    'GET /v1/events/:eventId/papers': g('ponencias.ver', P()),
    'GET /v1/papers/:id/file': g('ponencias.ver', eventoDePonencia),

    // participant
    'GET /v1/participants': g('participantes.gestionar'),
    'POST /v1/participants': g('participantes.gestionar'),
    'GET /v1/participants/:id': g('participantes.gestionar'),
    'PUT /v1/participants/:id': g('participantes.gestionar'),

    // payment-qr
    'POST /v1/payment-qr': g('eventos.configurar'),
    'GET /v1/payment-qr/:archivo': g('eventos.configurar'),

    // registration-type
    'GET /v1/events/:eventId/registration-categories': g(['eventos.configurar', 'inscripciones.ver'], P()),
    'POST /v1/events/:eventId/registration-categories': g('eventos.configurar'),
    'PUT /v1/registration-categories/:id': g('eventos.configurar'),
    'DELETE /v1/registration-categories/:id': g('eventos.configurar'),
    'POST /v1/registration-categories/:id/types': g('eventos.configurar'),
    'PUT /v1/registration-types/:id': g('eventos.configurar'),
    'DELETE /v1/registration-types/:id': g('eventos.configurar'),

    // specialized-talk (spec 019)
    'GET /v1/events/:eventId/specialized-talks': g(['especializadas.ver', 'especializadas.gestionar'], P()),
    'POST /v1/events/:eventId/specialized-talks': g('especializadas.gestionar'),
    'PUT /v1/specialized-talks/:id': g('especializadas.gestionar'),
    'DELETE /v1/specialized-talks/:id': g('especializadas.gestionar'),
    // Acceso libre del evento (spec 030)
    'GET /v1/events/:eventId/specialized-talks/access': g(['especializadas.ver', 'especializadas.gestionar'], P()),
    'PUT /v1/events/:eventId/specialized-talks/access': g('especializadas.gestionar'),
    // Enlace público del aforo (spec 036): es una credencial, solo del Owner
    'GET /v1/events/:eventId/specialized-talks/occupancy-link': g('especializadas.enlace_aforo'),
    'POST /v1/events/:eventId/specialized-talks/occupancy-link': g('especializadas.enlace_aforo'),
    'DELETE /v1/events/:eventId/specialized-talks/occupancy-link': g('especializadas.enlace_aforo'),
    'GET /v1/events/:eventId/specialized-talk-registrations': g('especializadas.ver', P()),
    'POST /v1/specialized-talks/:id/registrations': g('especializadas.inscribir', eventoDePonenciaEspecializada),
    'PATCH /v1/specialized-talk-registrations/:id': g('especializadas.inscribir', eventoDeInscripcionPonencia),
    'POST /v1/specialized-talks/:id/check-in': g('especializadas.asistencia', eventoDePonenciaEspecializada),
    'DELETE /v1/specialized-talk-registrations/:id/attendance': g('especializadas.asistencia', eventoDeInscripcionPonencia),
    // Resumen por persona (spec 031)
    'GET /v1/events/:eventId/specialized-talk-attendees': g('especializadas.ver', P()),
    'GET /v1/events/:eventId/specialized-talk-attendees/export': g('especializadas.ver', P()),
    'POST /v1/events/:eventId/specialized-talk-attendees/cancel': g('especializadas.inscribir', P()),
    'POST /v1/events/:eventId/specialized-talk-attendees/notify': g('especializadas.inscribir', P()),

    // advisory (spec 025): el seguimiento por asesor lo ven y descargan las cuentas del evento; el padrón lo carga una cuenta global
    'GET /v1/events/:eventId/advisory/summary': g('reportes.ver', P()),
    'GET /v1/events/:eventId/advisory/students': g('reportes.ver', P()),
    'GET /v1/events/:eventId/advisory/export': g('reportes.exportar', P()),
    'POST /v1/events/:eventId/advisory/import': g('reportes.gestionar'),
    // spec 026: ver, crear, renovar y desactivar los enlaces de los docentes (son credenciales)
    'GET /v1/events/:eventId/advisory/links': g('reportes.gestionar'),
    'POST /v1/events/:eventId/advisory/links': g('reportes.gestionar'),
    'DELETE /v1/events/:eventId/advisory/links/:asesorId': g('reportes.gestionar'),
    'GET /v1/events/:eventId/advisory/advisors': g('reportes.gestionar'),
    'POST /v1/events/:eventId/advisory/advisors': g('reportes.gestionar'),
    'PUT /v1/events/:eventId/advisory/advisors/:asesorId': g('reportes.gestionar'),
    'DELETE /v1/events/:eventId/advisory/advisors/:asesorId': g('reportes.gestionar'),
    'GET /v1/events/:eventId/advisory/cycle-links': g('reportes.gestionar'),
    'POST /v1/events/:eventId/advisory/cycle-links': g('reportes.gestionar'),
    'DELETE /v1/events/:eventId/advisory/cycle-links/:ciclo': g('reportes.gestionar'),

    // system-settings
    'GET /v1/settings': g('sistema.configurar'),
    'PUT /v1/settings': g('sistema.configurar'),
    'POST /v1/settings/undc-api/test': g('sistema.configurar'),
}

/** Rutas legacy de staff: `[rutaLegacy, guarda, ...]`. */
const LEGACY_STAFF: readonly Clave[] = [
    'POST /v1/attendances/export', 'POST /v1/attendances/overtime', 'POST /v1/attendances', 'GET /v1/attendances/:id',
    'GET /v1/contact', 'GET /v1/contact/:id', 'DELETE /v1/contact/:id',
    'GET /v1/inscription', 'GET /v1/inscription/:id', 'PUT /v1/inscription/:id/status', 'DELETE /v1/inscription/:id',
    'GET /v1/papers',
]

type Clase = 'PUBLICA' | 'SITIO' | 'PARTICIPANTE' | 'SESION' | 'STAFF'

const esGuarda = (h: Handle) => Object.prototype.hasOwnProperty.call(h, 'guarda')
const esMulter = (h: Handle) => h.name === 'multerMiddleware'
const esValidacion = (h: Handle) => h.validaCuerpo === true
/** Limitadores con clave por cuenta: necesitan `req.actor`, que deja la guarda. */
const LIMITES_POR_ACTOR: readonly RequestHandler[] = [
    limiteMarcarAsistencia, limiteCheckInPonencia, limiteReenvioCredencial, limiteRenovacionSesion, limiteSwitch, limiteLecturaReportes, limiteDescargaReportes, limiteCargaPadron, limiteEnlacesAsesores, limiteGestionDocentes,
    limiteDescargaResumenPonencias, limiteAvisosPonencias,
]
/** Total de rutas de /api: una ruta nueva obliga a clasificarla aquí. */
const TOTAL_RUTAS = 191

function clasesDe(ruta: Ruta): Clase[] {
    const clases: Clase[] = []
    if (PUBLICAS.includes(ruta.clave)) clases.push('PUBLICA')
    if (ruta.handles.includes(requireTokenEvento as RequestHandler)) clases.push('SITIO')
    if (ruta.handles.includes(requireParticipante as RequestHandler)) clases.push('PARTICIPANTE')
    if (ruta.handles.includes(requireSesion as RequestHandler)) clases.push('SESION')
    if (ruta.handles.some(esGuarda)) clases.push('STAFF')
    return clases
}

const deClase = (clase: Clase) => rutas.filter((r) => clasesDe(r).includes(clase)).map((r) => r.clave).sort()
const indiceDeAutenticacion = (ruta: Ruta) => ruta.handles.findIndex((h) =>
    esGuarda(h) || [requireTokenEvento, requireParticipante, requireSesion].includes(h as never))

describe('matriz de rutas (spec 013)', () => {
    it(`carga las ${TOTAL_RUTAS} rutas de /api, sin duplicados ni middlewares de router`, () => {
        expect(capasSinRuta).toEqual([])
        expect(rutas).toHaveLength(TOTAL_RUTAS)
        expect(new Set(rutas.map((r) => r.clave)).size).toBe(rutas.length)
    })

    it('toda ruta tiene exactamente una clasificación', () => {
        const sinClase = rutas.filter((r) => clasesDe(r).length === 0).map((r) => `${r.clave} (${r.archivo})`)
        const variasClases = rutas.filter((r) => clasesDe(r).length > 1).map((r) => `${r.clave}: ${clasesDe(r).join(', ')}`)
        expect(sinClase).toEqual([])
        expect(variasClases).toEqual([])
    })

    it('públicas, sitio, participante y sesión son exactamente las listadas', () => {
        expect(deClase('PUBLICA')).toEqual([...PUBLICAS].sort())
        expect(deClase('SITIO')).toEqual([...SITIO].sort())
        expect(deClase('PARTICIPANTE')).toEqual([...PARTICIPANTE].sort())
        expect(deClase('SESION')).toEqual([...SESION].sort())
        // Todo /v1/site/* lleva el token del evento y nada más lo usa
        expect(rutas.filter((r) => r.clave.includes(' /v1/site/')).map((r) => r.clave).sort()).toEqual([...SITIO].sort())
    })

    it('las guardas de staff coinciden exactamente con la tabla ruta → guarda', () => {
        const real: Record<string, Esperada> = {}
        for (const ruta of rutas.filter((r) => clasesDe(r).includes('STAFF'))) {
            const guardas = ruta.handles.filter(esGuarda)
            expect({ ruta: ruta.clave, guardas: guardas.length }).toEqual({ ruta: ruta.clave, guardas: 1 })
            const { permisos, evento, filtraPorActor } = guardas[0].guarda as GuardaPermiso
            real[ruta.clave] = { permisos: [...permisos].sort(), evento: evento ?? null, filtraPorActor }
        }
        expect(real).toEqual(MATRIZ)
        expect(Object.keys(MATRIZ)).toHaveLength(TOTAL_RUTAS - PUBLICAS.length - SITIO.length - PARTICIPANTE.length - SESION.length)
    })

    it('la guarda va primera (o tras rutaLegacy) y antes de multer y validateBody', () => {
        const malas: string[] = []
        for (const ruta of rutas.filter((r) => clasesDe(r).includes('STAFF'))) {
            const i = ruta.handles.findIndex(esGuarda)
            const legacy = ruta.handles[0] === rutaLegacy
            if (legacy !== LEGACY_STAFF.includes(ruta.clave)) malas.push(`${ruta.clave}: legacy=${legacy}`)
            if (i !== (legacy ? 1 : 0)) malas.push(`${ruta.clave}: guarda en la posición ${i}`)
        }
        // Ninguna ruta con autenticación procesa el cuerpo o el archivo antes de validar la sesión o el token
        for (const ruta of rutas) {
            const i = indiceDeAutenticacion(ruta)
            if (i < 0) continue
            const cuerpo = ruta.handles.findIndex((h) => esMulter(h) || esValidacion(h))
            if (cuerpo >= 0 && cuerpo < i) malas.push(`${ruta.clave}: procesa el cuerpo (${cuerpo}) antes de autenticar (${i})`)
        }
        expect(malas).toEqual([])
        // La detección de multer y validateBody funciona (si no, lo anterior no probaría nada)
        expect(rutas.filter((r) => r.handles.some(esMulter)).map((r) => r.clave).sort()).toEqual([
            'POST /v1/inscription', 'POST /v1/papers', 'POST /v1/events/:eventId/advisory/import', 'POST /v1/delegations/:id/payments', 'POST /v1/payment-qr', 'POST /v1/site/delegations/link/:codigoLink/payments', 'POST /v1/site/inscriptions', 'POST /v1/site/papers', 'PUT /v1/me/photo',
        ].sort())
        expect(rutas.filter((r) => r.handles.some(esValidacion)).length).toBeGreaterThan(30)
    })

    it('los limitadores por cuenta van justo después de la guarda de staff', () => {
        const malas: string[] = []
        for (const ruta of rutas) {
            ruta.handles.forEach((h, i) => {
                if (!LIMITES_POR_ACTOR.includes(h)) return
                if (!esGuarda(ruta.handles[i - 1] ?? ({} as Handle))) malas.push(`${ruta.clave}: limitador por cuenta en la posición ${i}`)
            })
        }
        expect(malas).toEqual([])
        // Y se usan donde la tabla lo pide
        const con = (h: RequestHandler) => rutas.filter((r) => r.handles.includes(h)).map((r) => r.clave)
        expect(con(limiteMarcarAsistencia)).toEqual(['POST /v1/activities/:id/attendances'])
        expect(con(limiteCheckInPonencia)).toEqual(['POST /v1/specialized-talks/:id/check-in'])
        expect(con(limiteReenvioCredencial)).toEqual(['POST /v1/inscriptions/:id/resend-credential'])
        expect(con(limiteRenovacionSesion)).toEqual(['POST /v1/auth/refresh'])
        expect(con(limiteSwitch)).toEqual(['POST /v1/auth/participant/switch'])
        expect(con(limiteLecturaReportes)).toEqual(['GET /v1/events/:eventId/advisory/summary', 'GET /v1/events/:eventId/advisory/students', 'GET /v1/events/:eventId/advisory/advisors', 'GET /v1/events/:eventId/advisory/links', 'GET /v1/events/:eventId/advisory/cycle-links'])
        expect(con(limiteGestionDocentes)).toEqual(['POST /v1/events/:eventId/advisory/advisors', 'PUT /v1/events/:eventId/advisory/advisors/:asesorId', 'DELETE /v1/events/:eventId/advisory/advisors/:asesorId'])
        expect(con(limiteEnlacesAsesores).sort()).toEqual([
            'POST /v1/events/:eventId/advisory/links', 'DELETE /v1/events/:eventId/advisory/links/:asesorId', 'POST /v1/events/:eventId/advisory/cycle-links', 'DELETE /v1/events/:eventId/advisory/cycle-links/:ciclo',
            'GET /v1/events/:eventId/specialized-talks/occupancy-link', 'POST /v1/events/:eventId/specialized-talks/occupancy-link', 'DELETE /v1/events/:eventId/specialized-talks/occupancy-link',
        ].sort())
        expect(con(limiteDescargaReportes)).toEqual(['GET /v1/events/:eventId/advisory/export'])
        expect(con(limiteCargaPadron)).toEqual(['POST /v1/events/:eventId/advisory/import'])
        expect(con(limiteDescargaResumenPonencias)).toEqual(['GET /v1/events/:eventId/specialized-talk-attendees/export'])
        expect(con(limiteAvisosPonencias)).toEqual(['POST /v1/events/:eventId/specialized-talk-attendees/cancel', 'POST /v1/events/:eventId/specialized-talk-attendees/notify'])
    })

    it('todo permiso por evento (E) tiene resolutor de evento o filtraPorActor', () => {
        const sinEvento = rutas.flatMap((ruta) => ruta.handles.filter(esGuarda).map((h) => ({ ruta: ruta.clave, guarda: h.guarda as GuardaPermiso })))
            .filter(({ guarda }) => guarda.permisos.some((p) => ALCANCE[p] === 'E') && !guarda.evento && !guarda.filtraPorActor)
            .map(({ ruta }) => ruta)
        expect(sinEvento).toEqual([])
        // La propia guarda se niega a construirse sin él
        expect(() => requirePermiso('inscripciones.ver')).toThrow(/evento/)
        expect(() => requirePermiso(['eventos.configurar', 'asistencia.ver'])).toThrow(/evento/)
        expect(() => requirePermiso([])).toThrow()
    })

    it('ya no existen las guardas por rol (requireRoles, verifyAdminRole, verifySuperAdminRole)', () => {
        for (const obsoleta of ['requireRoles', 'verifyAdminRole', 'verifySuperAdminRole']) expect(auth).not.toHaveProperty(obsoleta)
    })
})
