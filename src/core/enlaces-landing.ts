/**
 * Enlaces a la landing (specs 038 y 039). La landing se configura en Sistema (`url_landing`, solo el
 * origen: `https://dominio`); de ahí salen el enlace de la credencial 3D y el de la inscripción a las
 * ponencias especializadas. Sin URL configurada no hay enlace (`null`) y el correo sale sin botón.
 */

const REGEX_CODIGO = /^[0-9A-Z]{10}$/

/** El origen sin barras al final, o `null` si no hay URL. */
export function origenLanding(urlLanding: string | null | undefined): string | null {
    const origen = (urlLanding ?? '').trim().replace(/\/+$/, '')
    return origen || null
}

/** `<landing>/credencial/<codigo>`; `null` sin landing o sin un código de credencial válido. */
export function urlCredencial(urlLanding: string | null | undefined, codigo: string | null | undefined): string | null {
    const origen = origenLanding(urlLanding)
    if (!origen || !codigo || !REGEX_CODIGO.test(codigo)) return null
    return `${origen}/credencial/${codigo}`
}

/** `<landing>/inscripcion-ponencias`; `null` sin landing. */
export function urlInscripcionPonencias(urlLanding: string | null | undefined): string | null {
    const origen = origenLanding(urlLanding)
    return origen ? `${origen}/inscripcion-ponencias` : null
}
