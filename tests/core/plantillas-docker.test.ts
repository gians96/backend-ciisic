import fs from 'fs'
import path from 'path'

/**
 * `tsc` no copia los .html: cada carpeta `templates` de `src` necesita su `COPY` en la imagen. Sin
 * la de `participant-auth`, el acceso por código queda apagado en producción (spec 014).
 */
const RAIZ = path.join(__dirname, '../..')

function carpetasDePlantillas(directorio: string): string[] {
    return fs.readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
        if (!entrada.isDirectory()) return []
        const ruta = path.join(directorio, entrada.name)
        return entrada.name === 'templates' ? [ruta] : carpetasDePlantillas(ruta)
    })
}

describe('Dockerfile', () => {
    it('copia a dist todas las carpetas de plantillas HTML de src', () => {
        const dockerfile = fs.readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8')
        const carpetas = carpetasDePlantillas(path.join(RAIZ, 'src')).map((ruta) => path.relative(RAIZ, ruta).split(path.sep).join('/'))
        expect(carpetas).toEqual(expect.arrayContaining(['src/api/inscription/utils/templates', 'src/api/participant-auth/templates']))
        const faltan = carpetas.filter((carpeta) => !dockerfile.includes(`COPY --from=builder --chown=nodejs:nodejs /app/${carpeta} ./dist/${carpeta}`))
        expect(faltan).toEqual([])
    })
})
