import { and, asc, eq } from "drizzle-orm";
import { getDb, type Database } from "@/infrastructure/db/client";
import { products } from "@/infrastructure/db/schema";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import { productImageUrl } from "@/modules/products";

export async function listPublicProductsForBarbershop(
  slug: string, database: Database = getDb(),
) {
  const tenant = await resolveBarbershopBySlug(database, slug);
  if (!tenant) return null;
  const rows = await database.select({
    id: products.id, name: products.name, description: products.description,
    priceCents: products.priceCents, stockQuantity: products.stockQuantity,
    imageKey: products.imageKey,
  }).from(products).where(and(
    eq(products.barbershopId, tenant.id), eq(products.active, true),
  )).orderBy(asc(products.name), asc(products.id));

  return rows.map(({ stockQuantity, imageKey, ...product }) => ({
    ...product,
    imageUrl: productImageUrl(slug, product.id, imageKey),
    available: stockQuantity > 0,
  }));
}
