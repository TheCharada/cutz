import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import { barbershops, products } from "@/infrastructure/db/schema";
import { LocalStorageProvider } from "@/infrastructure/storage";
import {
  readPublicProductImage, removeProductImage, uploadProductImage,
} from "@/workflows/product-images";

const db = getDb();
let f: Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const suffix = randomUUID().slice(0, 8);
  const [tenant, other] = await db.insert(barbershops).values([
    { slug: `product-images-${suffix}`, name: "Imagens A", timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
    { slug: `product-other-${suffix}`, name: "Imagens B", timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
  ]).returning();
  const [product] = await db.insert(products).values({
    barbershopId: tenant.id, name: "Leave-in", priceCents: 4500,
  }).returning();
  const folder = await mkdtemp(join(tmpdir(), "cutz-product-img-"));
  const storage = new LocalStorageProvider(folder);
  return {
    tenant, other, product, storage,
    params: { slug: tenant.slug, barbershopId: tenant.id, productId: product.id },
    async cleanup() {
      await db.delete(products).where(eq(products.id, product.id));
      await db.delete(barbershops).where(inArray(barbershops.id, [tenant.id, other.id]));
      await rm(folder, { recursive: true, force: true });
    },
  };
}
async function image() {
  return sharp({ create: {
    width: 480, height: 480, channels: 3, background: "#996633",
  } }).png().toBuffer();
}

beforeEach(async () => { f = await fixture(); });
afterEach(async () => { await f.cleanup(); });
afterAll(async () => { await getPool().end(); });

describe("product images", () => {
  it("uploads a photo into the existing local provider and serves it publicly", async () => {
    const upload = await uploadProductImage({
      ...f.params, bytes: await image(),
    }, { database: db, storage: f.storage });
    expect(upload.status).toBe("ok");
    const row = (await db.select().from(products).where(eq(products.id, f.product.id)))[0];
    expect(row.imageKey).toMatch(/^products\//);
    const data = await readPublicProductImage({
      slug: f.tenant.slug, id: f.product.id,
    }, { database: db, storage: f.storage });
    expect(data).not.toBeNull();
    expect((await sharp(data!.bytes).metadata()).format).toBe("webp");
    expect(await readPublicProductImage({
      slug: f.other.slug, id: f.product.id,
    }, { database: db, storage: f.storage })).toBeNull();
  });

  it("replaces and removes photos and refuses other tenants", async () => {
    expect((await uploadProductImage({
      ...f.params, barbershopId: f.other.id, bytes: await image(),
    }, { database: db, storage: f.storage })).status).toBe("not-found");
    const first = await uploadProductImage({
      ...f.params, bytes: await image(),
    }, { database: db, storage: f.storage });
    const key = (await db.select().from(products)
      .where(eq(products.id, f.product.id)))[0].imageKey!;
    const second = await uploadProductImage({
      ...f.params, bytes: await image(),
    }, { database: db, storage: f.storage });
    expect(second.imageUrl).not.toBe(first.imageUrl);
    expect(await f.storage.get(key)).toBeNull();
    expect((await removeProductImage(f.params, {
      database: db, storage: f.storage,
    })).status).toBe("ok");
    expect(await readPublicProductImage({
      slug: f.tenant.slug, id: f.product.id,
    }, { database: db, storage: f.storage })).toBeNull();
  });

  it("keeps the current image when a new upload is invalid", async () => {
    await uploadProductImage({ ...f.params, bytes: await image() },
      { database: db, storage: f.storage });
    await expect(uploadProductImage({
      ...f.params, bytes: Buffer.from("not an image"),
    }, { database: db, storage: f.storage })).rejects.toThrow();
    expect(await readPublicProductImage({
      slug: f.tenant.slug, id: f.product.id,
    }, { database: db, storage: f.storage })).not.toBeNull();
    await db.update(products).set({ active: false }).where(eq(products.id, f.product.id));
    expect(await readPublicProductImage({
      slug: f.tenant.slug, id: f.product.id,
    }, { database: db, storage: f.storage })).toBeNull();
  });
});
