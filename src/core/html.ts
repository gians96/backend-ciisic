const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }

/** Escapa texto para insertarlo en HTML (contenido o atributos). */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/**
 * Reemplaza `{{CLAVE}}` en una plantilla. Los valores se escapan salvo los indicados en
 * `raw` (p. ej. data URLs generadas por el servidor). Se usa una función de reemplazo para
 * que secuencias como `$&` en los datos no se interpreten.
 */
export function renderTemplate(template: string, values: Record<string, unknown>, raw: string[] = []): string {
    return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
        if (!(key in values)) return match
        return raw.includes(key) ? String(values[key] ?? '') : escapeHtml(values[key])
    })
}
