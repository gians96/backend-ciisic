import * as yup from 'yup'

const authorSchema = yup.object({
  firstName: yup.string().trim().required().max(120),
  lastName: yup.string().trim().required().max(120),
  university: yup.string().trim().required().max(200),
}).required()

export const paperSchema = yup.object({
  title: yup.string().trim().required().max(300),
  mainAuthor: authorSchema,
  coauthors: yup.array().of(authorSchema).max(3).default([]),
}).required()

export type PaperInput = yup.InferType<typeof paperSchema>
