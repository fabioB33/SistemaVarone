/**
 * Genera un slug URL-safe a partir de un título.
 * Quita acentos, signos, deja [a-z0-9-], colapsa guiones, máx 80 chars.
 */
export function buildSlug(title: string, suffix?: string): string {
  const base = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return suffix ? `${base}-${suffix}` : base;
}
