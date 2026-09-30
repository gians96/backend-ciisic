// Las guardas del staff leen la cuenta de la BD en cada petición (spec 013). En las pruebas esa
// consulta sale del registro de `tests/helpers/actores.ts`, que llena `tokenDeRol`. Una prueba que
// necesite la consulta real puede usar `jest.requireActual('../src/core/actor-consulta')`.
jest.mock('../src/core/actor-consulta', () => ({
    consultarActor: jest.fn(async (id: number) => {
        const { actorRegistrado } = jest.requireActual('./helpers/actores') as typeof import('./helpers/actores')
        return actorRegistrado(id)
    }),
}))
