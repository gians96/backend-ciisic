import fs from 'fs'
import path from 'path'
import ts from 'typescript'

/**
 * Los códigos históricos de rol `SUPERADMIN` y `ADMIN` (spec 013) solo se escriben en el catálogo;
 * el resto del código usa `ROL.OWNER` / `ROL.ADMINISTRADOR`, para que un rol nunca dependa de un
 * texto suelto. Se revisa el árbol sintáctico (no el texto): los comentarios no cuentan.
 *
 * Excepciones:
 * - `src/core/catalogos.ts`: define `ROLES` y `ROL`.
 * - `src/database/seed.ts`: siembra los roles (hoy lo hace con `ROL`, pero puede necesitar el código).
 * - `tipo: 'ADMIN'` (con o sin `as const`): es el TIPO de sesión que recibe el panel en el login y en
 *   `/v1/auth/session` ({ tipo: 'ADMIN' } frente a { tipo: 'PARTICIPANTE' }), no un rol. Sus usos
 *   están listados en `TIPO_SESION`.
 */
const RAIZ = path.join(__dirname, '../..')
const CODIGOS = new Set(['SUPERADMIN', 'ADMIN'])
const ARCHIVOS_PERMITIDOS = new Set(['src/core/catalogos.ts', 'src/database/seed.ts'])

/** Usos de `tipo: 'ADMIN'` por archivo (tipo de sesión, no rol). */
const TIPO_SESION: Record<string, number> = {
    'src/api/admin/controllers/admin.ts': 2,
    'src/api/google-auth/services/google-auth.ts': 1,
}

interface Hallazgo { archivo: string, linea: number, texto: string, tipoSesion: boolean }

function nombreDePropiedad(nodo: ts.Node | undefined): string | undefined {
    if (!nodo) return undefined
    if ((ts.isPropertyAssignment(nodo) || ts.isPropertySignature(nodo)) && (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name))) return nodo.name.text
    return undefined
}

/** `tipo: 'ADMIN'`, `tipo: 'ADMIN' as const` o, en un tipo, `tipo: 'ADMIN' | ...`. */
function esTipoDeSesion(literal: ts.Node): boolean {
    let nodo = literal.parent
    if (ts.isLiteralTypeNode(nodo)) {
        nodo = nodo.parent
        if (ts.isUnionTypeNode(nodo)) nodo = nodo.parent
    } else if (ts.isAsExpression(nodo) && nodo.expression === literal) nodo = nodo.parent
    return nombreDePropiedad(nodo) === 'tipo' && ((nodo as ts.PropertyAssignment | ts.PropertySignature).name !== literal)
}

function buscarLiterales(archivo: string, codigo: string): Hallazgo[] {
    const fuente = ts.createSourceFile(archivo, codigo, ts.ScriptTarget.Latest, true)
    const hallazgos: Hallazgo[] = []
    const registrar = (nodo: ts.Node, tipoSesion: boolean) => hallazgos.push({
        archivo, linea: fuente.getLineAndCharacterOfPosition(nodo.getStart()).line + 1, texto: nodo.getText(), tipoSesion,
    })
    const visitar = (nodo: ts.Node) => {
        if ((ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) && CODIGOS.has(nodo.text)) {
            registrar(nodo, esTipoDeSesion(nodo))
        } else if (ts.isIdentifier(nodo) && CODIGOS.has(nodo.text) && nombreDePropiedad(nodo.parent) === nodo.text) {
            // Clave de objeto con el código del rol: `{ ADMIN: ... }`
            registrar(nodo, false)
        }
        ts.forEachChild(nodo, visitar)
    }
    visitar(fuente)
    return hallazgos
}

function archivosTs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const ruta = path.join(dir, e.name)
        if (e.isDirectory()) return archivosTs(ruta)
        return e.name.endsWith('.ts') ? [ruta] : []
    })
}

const hallazgos = archivosTs(path.join(RAIZ, 'src'))
    .map((ruta) => path.relative(RAIZ, ruta).split(path.sep).join('/'))
    .filter((archivo) => !ARCHIVOS_PERMITIDOS.has(archivo))
    .flatMap((archivo) => buscarLiterales(archivo, fs.readFileSync(path.join(RAIZ, archivo), 'utf8')))

describe('literales de rol en src (spec 013)', () => {
    it('ningún archivo fuera del catálogo escribe SUPERADMIN o ADMIN como rol', () => {
        expect(hallazgos.filter((h) => !h.tipoSesion).map((h) => `${h.archivo}:${h.linea} ${h.texto}`)).toEqual([])
    })

    it('los únicos usos permitidos son los tipo: \'ADMIN\' de la sesión listados', () => {
        const porArchivo: Record<string, number> = {}
        for (const h of hallazgos.filter((x) => x.tipoSesion)) porArchivo[h.archivo] = (porArchivo[h.archivo] ?? 0) + 1
        expect(porArchivo).toEqual(TIPO_SESION)
    })

    it('el detector distingue un rol de un tipo de sesión', () => {
        const codigo = [
            'requireRoles(\'SUPERADMIN\', "ADMIN")',
            'if (rol === `ADMIN`) {}',
            'const ids = { ADMIN: 2 }',
            'const x = { rolCodigo: \'ADMIN\' }',
            '// comentario con \'ADMIN\'',
            'const s = { tipo: \'ADMIN\' as const }',
            'res.json({ tipo: \'ADMIN\' })',
            'interface S { tipo: \'ADMIN\' | \'PARTICIPANTE\' }',
            'const otro = { tipo: \'ADMINISTRADOR\', admin: \'admin\' }',
        ].join('\n')
        const encontrados = buscarLiterales('ejemplo.ts', codigo).map((h) => [h.linea, h.tipoSesion])
        expect(encontrados).toEqual([[1, false], [1, false], [2, false], [3, false], [4, false], [6, true], [7, true], [8, true]])
    })
})
