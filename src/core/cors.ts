/**
 * Orígenes de navegador permitidos: coincidencia exacta o comodín de subdominio
 * (`https://*.episundc.pe`). La API del sitio (`X-Api-Key`) no se expone a navegadores.
 */
export function origenPermitido(origin: string, permitidos: readonly string[]): boolean {
    return permitidos.some((permitido) => {
        if (permitido === origin) return true
        const comodin = /^(https?):\/\/\*\.(.+)$/.exec(permitido)
        if (!comodin) return false
        const [, protocolo, dominio] = comodin
        const url = /^(https?):\/\/([^/:]+)(?::\d+)?$/.exec(origin)
        return !!url && url[1] === protocolo && url[2].endsWith(`.${dominio}`)
    })
}
