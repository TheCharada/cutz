export type CatalogImageKind = "services" | "staff";

export function catalogImageUrl(
  slug: string,
  kind: CatalogImageKind,
  id: string,
  imageKey: string | null,
): string | null {
  if (!imageKey) return null;
  const version = imageKey.split("/").at(-1)?.replace(/\.webp$/, "") ?? "";
  return `/api/b/${encodeURIComponent(slug)}/images/${kind}/${id}?v=${version}`;
}
