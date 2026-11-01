export function productImageUrl(slug: string, id: string, imageKey: string | null) {
  if (!imageKey) return null;
  const revision = imageKey.split("/").at(-1)?.replace(/\.webp$/, "") ?? "";
  return `/api/b/${encodeURIComponent(slug)}/images/products/${id}?v=${revision}`;
}
