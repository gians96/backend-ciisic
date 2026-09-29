export interface Pagination {
    page: number
    pageSize: number
    skip: number
    take: number
}

function entero(value: unknown, fallback: number, min: number, max: number): number {
    const n = Number(value)
    if (!Number.isSafeInteger(n)) return fallback
    return Math.min(Math.max(n, min), max)
}

/** Lee `page` y `pageSize` de la query con límites seguros. */
export function parsePagination(query: Record<string, unknown>, defaultSize = 20, maxSize = 100): Pagination {
    const page = entero(query.page, 1, 1, 100000)
    const pageSize = entero(query.pageSize, defaultSize, 1, maxSize)
    return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function pageMeta(p: Pagination, total: number) {
    return { page: p.page, pageSize: p.pageSize, total }
}
