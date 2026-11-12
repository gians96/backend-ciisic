import { obtenerConfiguracion } from '../../../core/configuracion-sistema'
import { conflict } from '../../../core/http-error'
import { esCodigoCertificado } from './codigos'

/**
 * Enlaces públicos de los certificados (spec 015). Viven en el panel (`url_panel` de Sistema, solo el origen),
 * que sirve a todos los eventos: la consulta por DNI muestra los certificados de cualquier evento.
 */

export interface EnlacesCertificado {
    /** `<panel>/certificado/<codigo>`: el certificado y su PDF. */
    certificado: string
    /** `<panel>/consulta-certificados`: todos los certificados de una persona con su DNI. */
    consulta: string
}

export function origenPanel(urlPanel: string | null | undefined): string | null {
    const origen = (urlPanel ?? '').trim().replace(/\/+$/, '')
    return origen || null
}

export function enlacesDe(urlPanel: string | null | undefined, codigo: string): EnlacesCertificado | null {
    const origen = origenPanel(urlPanel)
    if (!origen || !esCodigoCertificado(codigo)) return null
    return { certificado: `${origen}/certificado/${codigo}`, consulta: `${origen}/consulta-certificados` }
}

/** Origen del panel o 409 si falta configurarlo (sin él no hay enlaces que enviar). */
export async function exigirOrigenPanel(): Promise<string> {
    const { urlPanel } = await obtenerConfiguracion()
    const origen = origenPanel(urlPanel)
    if (!origen) throw conflict('PANEL_URL_MISSING', 'Falta la URL del panel. Configúrala en Sistema para poder armar los enlaces de los certificados.')
    return origen
}
