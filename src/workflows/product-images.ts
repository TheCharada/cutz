import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@/infrastructure/db/client";
import { products } from "@/infrastructure/db/schema";
import {
  getMediaStorage, prepareCatalogImage, type StorageProvider,
} from "@/infrastructure/storage";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import { productImageUrl } from "@/modules/products";

type Params = { barbershopId: string; productId: string; slug: string };
type Options = { database?: Database; storage?: StorageProvider };

function warn(key: string, error: unknown) {
  console.warn("Could not clean up product image", { key, error });
}

export async function uploadProductImage(
  params: Params & { bytes: Buffer }, options: Options = {},
) {
  const database = options.database ?? getDb();
  const storage = options.storage ?? getMediaStorage();
  const [exists] = await database.select({ id: products.id }).from(products).where(and(
    eq(products.id, params.productId), eq(products.barbershopId, params.barbershopId),
  )).limit(1);
  if (!exists) return { status: "not-found" as const };
  const image = await prepareCatalogImage(params.bytes);
  const key = `products/${params.productId}/${randomUUID()}.webp`;
  await storage.put(key, image, "image/webp");

  try {
    const previous = await database.transaction(async (tx) => {
      const [record] = await tx.select({ imageKey: products.imageKey }).from(products)
        .where(and(eq(products.id, params.productId), eq(products.barbershopId, params.barbershopId)))
        .for("update").limit(1);
      if (!record) return null;
      await tx.update(products).set({ imageKey: key, updatedAt: new Date() })
        .where(and(eq(products.id, params.productId), eq(products.barbershopId, params.barbershopId)));
      return record.imageKey;
    });
    if (previous === null) {
      // Products are soft-deactivated, not deleted, during normal operation.
      const [stillExists] = await database.select({ id: products.id }).from(products)
        .where(and(eq(products.id, params.productId), eq(products.barbershopId, params.barbershopId))).limit(1);
      if (!stillExists) {
        await storage.delete(key).catch((error: unknown) => warn(key, error));
        return { status: "not-found" as const };
      }
    }
    if (previous && previous !== key) {
      await storage.delete(previous).catch((error: unknown) => warn(previous, error));
    }
    return { status: "ok" as const, imageUrl: productImageUrl(params.slug, params.productId, key) };
  } catch (error) {
    await storage.delete(key).catch((reason: unknown) => warn(key, reason));
    throw error;
  }
}

export async function removeProductImage(params: Params, options: Options = {}) {
  const database = options.database ?? getDb();
  const storage = options.storage ?? getMediaStorage();
  const result = await database.transaction(async (tx) => {
    const [record] = await tx.select({ imageKey: products.imageKey }).from(products)
      .where(and(eq(products.id, params.productId), eq(products.barbershopId, params.barbershopId)))
      .for("update").limit(1);
    if (!record) return { status: "not-found" as const };
    await tx.update(products).set({ imageKey: null, updatedAt: new Date() })
      .where(and(eq(products.id, params.productId), eq(products.barbershopId, params.barbershopId)));
    return { status: "ok" as const, key: record.imageKey };
  });
  if (result.status === "ok" && result.key) {
    await storage.delete(result.key).catch((error: unknown) => warn(result.key!, error));
  }
  return { status: result.status };
}

export async function readPublicProductImage(
  params: { slug: string; id: string }, options: Options = {},
) {
  const database = options.database ?? getDb();
  const storage = options.storage ?? getMediaStorage();
  const tenant = await resolveBarbershopBySlug(database, params.slug);
  if (!tenant) return null;
  const [record] = await database.select({ imageKey: products.imageKey })
    .from(products).where(and(
      eq(products.id, params.id), eq(products.barbershopId, tenant.id),
      eq(products.active, true),
    )).limit(1);
  if (!record?.imageKey) return null;
  const bytes = await storage.get(record.imageKey);
  return bytes ? { bytes, imageKey: record.imageKey } : null;
}
