import * as yup from 'yup'

export const crearTokenAccesoSchema = yup.object({
    nombre: yup.string().trim().min(2).max(120).required(),
    expiraEn: yup.date().nullable()
        .test('futura', 'La expiración debe ser una fecha futura', (valor) => !valor || valor.getTime() > Date.now()),
}).required()

export type CrearTokenAccesoInput = yup.InferType<typeof crearTokenAccesoSchema>
