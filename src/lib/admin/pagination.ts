export const PAGE_SIZE = 25;

export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export function pageRange(page: number, size = PAGE_SIZE): [number, number] {
  const from = (page - 1) * size;
  return [from, from + size - 1];
}

export function totalPages(count: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / size));
}

/** Construye la URL de una página conservando solo filtros sin datos personales. */
export function pageHref(
  base: string,
  params: Record<string, string | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  if (page > 1) search.set("pagina", String(page));
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Normaliza un parámetro de URL a uno de los valores permitidos. */
export function pickParam<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return allowed.find((a) => a === raw);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && UUID_RE.test(raw) ? raw : undefined;
}
