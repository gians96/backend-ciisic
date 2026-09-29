import type { ProveedorConsulta } from '@prisma/client'
import { apiperu } from './apiperu'
import { decolecta } from './decolecta'
import type { ProveedorDni } from './types'

/** Registro de proveedores. Agregar uno nuevo = un adaptador + un valor en el enum. */
export const proveedores: Record<ProveedorConsulta, ProveedorDni> = {
    DECOLECTA: decolecta,
    APIPERU: apiperu,
}
