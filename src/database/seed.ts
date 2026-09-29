import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Seeds idempotentes (upsert por código). Se pueden ejecutar varias veces y en
 * producción sin borrar datos: solo crean lo que falta.
 *   npm run seed            → catálogos globales
 *   npm run seed -- --demo  → además, categorías y tipos de ejemplo para el evento principal
 */

const ROLES = [
    { codigo: 'SUPERADMIN', nombre: 'SuperAdmin' },
    { codigo: 'ADMIN', nombre: 'Admin' },
]

const ESTADOS = [
    { codigo: 'PENDIENTE', nombre: 'Pendiente' },
    { codigo: 'APROBADO', nombre: 'Aprobado' },
    { codigo: 'RECHAZADO', nombre: 'Rechazado' },
    { codigo: 'EN_REVISION', nombre: 'En Revisión' },
    { codigo: 'CANCELADO', nombre: 'Cancelado' },
]

const TIPOS_DOCUMENTO = [
    { id: 'dni', nombre: 'Documento Nacional de Identidad', abreviatura: 'DNI' },
    { id: 'ce', nombre: 'Carnet de Extranjería', abreviatura: 'CE' },
    { id: 'ruc', nombre: 'Registro Único de Contribuyentes', abreviatura: 'RUC' },
]

const CICLOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

async function seedCatalogos() {
    for (const rol of ROLES) await prisma.rol.upsert({ where: { codigo: rol.codigo }, create: rol, update: {} })
    for (const estado of ESTADOS) await prisma.estadoInscripcion.upsert({ where: { codigo: estado.codigo }, create: estado, update: {} })
    for (const tipo of TIPOS_DOCUMENTO) await prisma.tipoDocumento.upsert({ where: { id: tipo.id }, create: tipo, update: {} })
    for (const [indice, ciclo] of CICLOS.entries()) {
        const nombre = `ESTUDIANTE - ${ciclo} CICLO`
        const existe = await prisma.clasificacion.findFirst({ where: { nombre } })
        if (!existe) await prisma.clasificacion.create({ data: { id: indice + 1, nombre } }).catch(() => prisma.clasificacion.create({ data: { nombre } }))
    }
    console.log('✅ Catálogos verificados')
}

const caracteristicas = (kit: boolean) => [
    { icon: 'heroicons:academic-cap', text: 'Certificado Digital (100h)' },
    ...(kit ? [{ icon: 'heroicons:gift', text: 'Kit de Merchandising Oficial' }] : []),
    { icon: 'heroicons:identification', text: 'Carnet de Identificación' },
    { icon: 'heroicons:ticket', text: 'Acceso a todas las ponencias' },
    ...(kit ? [] : [{ icon: 'heroicons:x-mark', text: 'No incluye Kit' }]),
]

const CATEGORIAS_DEMO = [
    {
        codigo: 'ESTUDIANTES', nombre: 'ESTUDIANTES', esEstudiantil: true, orden: 1,
        tipos: [
            { codigo: 'estudiantes_con_kit', nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', precio: 120, precioInstitucional: 100, orden: 1, kit: true,
                descripcion: 'La experiencia completa para estudiantes con kit de merchandising oficial.' },
            { codigo: 'estudiantes_sin_kit', nombre: 'ESTUDIANTES', etiqueta: 'SIN KIT', precio: 60, precioInstitucional: 40, orden: 2, kit: false,
                descripcion: 'La opción económica para estudiantes, con acceso a todas las ponencias.' },
        ],
    },
    {
        codigo: 'PUBLICO_GENERAL', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', esEstudiantil: false, orden: 2,
        tipos: [
            { codigo: 'general_con_kit', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL CON KIT', etiqueta: 'CON KIT', precio: 140, precioInstitucional: 120, orden: 1, kit: true,
                descripcion: 'La experiencia completa para profesionales y público en general con kit de merchandising oficial.' },
            { codigo: 'general_sin_kit', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL SIN KIT', etiqueta: 'SIN KIT', precio: 80, precioInstitucional: 60, orden: 2, kit: false,
                descripcion: 'La opción económica para profesionales y público en general, con acceso a todas las ponencias.' },
        ],
    },
]

async function seedDemo() {
    const evento = await prisma.evento.findFirst({ where: { esPrincipal: true } })
    if (!evento) {
        console.log('⚠️  No hay evento principal; se omite el seed de demostración')
        return
    }
    for (const categoria of CATEGORIAS_DEMO) {
        const creada = await prisma.categoriaInscripcion.upsert({
            where: { eventoId_codigo: { eventoId: evento.id, codigo: categoria.codigo } },
            create: { eventoId: evento.id, codigo: categoria.codigo, nombre: categoria.nombre, esEstudiantil: categoria.esEstudiantil, orden: categoria.orden },
            update: {},
        })
        for (const tipo of categoria.tipos) {
            await prisma.tipoInscripcion.upsert({
                where: { categoriaId_codigo: { categoriaId: creada.id, codigo: tipo.codigo } },
                create: {
                    categoriaId: creada.id, codigo: tipo.codigo, nombre: tipo.nombre, etiqueta: tipo.etiqueta, descripcion: tipo.descripcion,
                    precio: tipo.precio, precioInstitucional: tipo.precioInstitucional, orden: tipo.orden,
                    caracteristicas: caracteristicas(tipo.kit) as Prisma.InputJsonValue,
                },
                update: {},
            })
        }
    }
    console.log(`✅ Categorías y tipos de ejemplo verificados para ${evento.nombreCorto}`)
}

async function main() {
    await seedCatalogos()
    if (process.argv.includes('--demo')) await seedDemo()
}

main()
    .catch((error) => {
        console.error('No se pudieron ejecutar los seeds:', error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
