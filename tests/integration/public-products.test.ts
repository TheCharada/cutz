import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import { barbershops, products } from "@/infrastructure/db/schema";
import { listPublicProductsForBarbershop } from "@/workflows/public-products";

const db = getDb();
let ids: string[] = [];

beforeEach(async () => {
  ids = [];
});
afterEach(async () => {
  await db.delete(products).where(inArray(products.barbershopId, ids));
  await db.delete(barbershops).where(inArray(barbershops.id, ids));
});
afterAll(async () => { await getPool().end(); });

describe("public products", () => {
  it("returns only active tenant products without exposing stock quantities or image keys", async () => {
    const key = randomUUID().slice(0, 8);
    const [tenant, other] = await db.insert(barbershops).values([
      { name: "Catálogo", slug: `public-products-${key}`, timezone: "America/Sao_Paulo",
        bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
        waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
      { name: "Outro", slug: `other-public-${key}`, timezone: "America/Sao_Paulo",
        bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
        waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
    ]).returning();
    ids.push(tenant.id, other.id);

    const [available, exhausted] = await db.insert(products).values([
      { barbershopId: tenant.id, name: "Leave-in", priceCents: 4500, stockQuantity: 3 },
      { barbershopId: tenant.id, name: "Pomada", priceCents: 2000, stockQuantity: 0 },
      { barbershopId: tenant.id, name: "Inativo", priceCents: 1200, stockQuantity: 7, active: false },
      { barbershopId: other.id, name: "Outro", priceCents: 3000, stockQuantity: 1 },
    ]).returning();
    const imageKey = `products/${available.id}/${randomUUID()}.webp`;
    await db.update(products).set({ imageKey }).where(eq(products.id, available.id));

    const result = await listPublicProductsForBarbershop(tenant.slug, db);
    expect(result).toEqual([
      {
        id: available.id, name: "Leave-in", description: null, priceCents: 4500,
        available: true, imageUrl: expect.stringContaining("/images/products/"),
      },
      {
        id: exhausted.id, name: "Pomada", description: null, priceCents: 2000,
        available: false, imageUrl: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("stockQuantity");
    expect(JSON.stringify(result)).not.toContain("imageKey");
    expect(JSON.stringify(result)).not.toContain(other.id);
    expect(await listPublicProductsForBarbershop("no-such-barbershop", db)).toBeNull();
  });
});
