import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@/infrastructure/db/client";
import { services, staffMembers } from "@/infrastructure/db/schema";
import {
  getMediaStorage, prepareCatalogImage, type StorageProvider,
} from "@/infrastructure/storage";
import { resolveBarbershopBySlug } from "@/modules/barbershops";
import { catalogImageUrl, type CatalogImageKind } from "@/modules/catalog";

type ImageTarget = {
  barbershopId: string;
  slug: string;
  kind: CatalogImageKind;
  id: string;
};

type Options = { database?: Database; storage?: StorageProvider };

async function findImageTarget(
  database: Database,
  target: Pick<ImageTarget, "barbershopId" | "kind" | "id">,
) {
  if (target.kind === "services") {
    const [service] = await database.select({ id: services.id })
      .from(services).where(and(
        eq(services.barbershopId, target.barbershopId), eq(services.id, target.id),
      )).limit(1);
    return Boolean(service);
  }
  const [staff] = await database.select({ id: staffMembers.id })
    .from(staffMembers).where(and(
      eq(staffMembers.barbershopId, target.barbershopId), eq(staffMembers.id, target.id),
    )).limit(1);
  return Boolean(staff);
}

function warnCleanup(key: string, error: unknown) {
  console.warn("Could not delete obsolete catalog image", { key, error });
}

export async function uploadCatalogImage(
  target: ImageTarget & { bytes: Buffer },
  options: Options = {},
) {
  const database = options.database ?? getDb();
  const storage = options.storage ?? getMediaStorage();

  if (!(await findImageTarget(database, target))) {
    return { status: "not-found" as const };
  }

  const processed = await prepareCatalogImage(target.bytes);
  const key = `${target.kind}/${target.id}/${randomUUID()}.webp`;
  await storage.put(key, processed, "image/webp");

  try {
    const result = await database.transaction(async (tx) => {
      if (target.kind === "services") {
        const [record] = await tx.select({ imageKey: services.imageKey })
          .from(services).where(and(
            eq(services.barbershopId, target.barbershopId), eq(services.id, target.id),
          )).for("update").limit(1);
        if (!record) return null;
        await tx.update(services).set({ imageKey: key, updatedAt: new Date() })
          .where(and(eq(services.barbershopId, target.barbershopId), eq(services.id, target.id)));
        return record.imageKey;
      }

      const [record] = await tx.select({ imageKey: staffMembers.imageKey })
        .from(staffMembers).where(and(
          eq(staffMembers.barbershopId, target.barbershopId), eq(staffMembers.id, target.id),
        )).for("update").limit(1);
      if (!record) return null;
      await tx.update(staffMembers).set({ imageKey: key, updatedAt: new Date() })
        .where(and(eq(staffMembers.barbershopId, target.barbershopId), eq(staffMembers.id, target.id)));
      return record.imageKey;
    });

    if (result === null && !(await findImageTarget(database, target))) {
      await storage.delete(key).catch((error: unknown) => warnCleanup(key, error));
      return { status: "not-found" as const };
    }
    if (result && result !== key) {
      await storage.delete(result).catch((error: unknown) => warnCleanup(result, error));
    }
    return {
      status: "ok" as const,
      imageUrl: catalogImageUrl(target.slug, target.kind, target.id, key),
    };
  } catch (error) {
    await storage.delete(key).catch((reason: unknown) => warnCleanup(key, reason));
    throw error;
  }
}

export async function removeCatalogImage(target: ImageTarget, options: Options = {}) {
  const database = options.database ?? getDb();
  const storage = options.storage ?? getMediaStorage();
  const result = await database.transaction(async (tx) => {
    if (target.kind === "services") {
      const [record] = await tx.select({ imageKey: services.imageKey })
        .from(services).where(and(
          eq(services.barbershopId, target.barbershopId), eq(services.id, target.id),
        )).for("update").limit(1);
      if (!record) return { status: "not-found" as const };
      await tx.update(services).set({ imageKey: null, updatedAt: new Date() })
        .where(and(eq(services.barbershopId, target.barbershopId), eq(services.id, target.id)));
      return { status: "ok" as const, key: record.imageKey };
    }
    const [record] = await tx.select({ imageKey: staffMembers.imageKey })
      .from(staffMembers).where(and(
        eq(staffMembers.barbershopId, target.barbershopId), eq(staffMembers.id, target.id),
      )).for("update").limit(1);
    if (!record) return { status: "not-found" as const };
    await tx.update(staffMembers).set({ imageKey: null, updatedAt: new Date() })
      .where(and(eq(staffMembers.barbershopId, target.barbershopId), eq(staffMembers.id, target.id)));
    return { status: "ok" as const, key: record.imageKey };
  });
  if (result.status === "ok" && result.key) {
    await storage.delete(result.key).catch((error: unknown) => warnCleanup(result.key!, error));
  }
  return result.status === "not-found"
    ? { status: "not-found" as const }
    : { status: "ok" as const };
}

export async function readPublicCatalogImage(
  params: { slug: string; kind: CatalogImageKind; id: string },
  options: Options = {},
) {
  const database = options.database ?? getDb();
  const storage = options.storage ?? getMediaStorage();
  const tenant = await resolveBarbershopBySlug(database, params.slug);
  if (!tenant) return null;
  const imageKey = params.kind === "services"
    ? (await database.select({ imageKey: services.imageKey }).from(services).where(and(
      eq(services.barbershopId, tenant.id), eq(services.id, params.id),
    )).limit(1))[0]?.imageKey
    : (await database.select({ imageKey: staffMembers.imageKey }).from(staffMembers).where(and(
      eq(staffMembers.barbershopId, tenant.id), eq(staffMembers.id, params.id),
    )).limit(1))[0]?.imageKey;
  if (!imageKey) return null;
  const bytes = await storage.get(imageKey);
  return bytes ? { bytes, imageKey } : null;
}
