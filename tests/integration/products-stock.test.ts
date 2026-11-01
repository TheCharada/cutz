import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import {
  barbershops, products, productStockMovements, users,
} from "@/infrastructure/db/schema";
import {
  createProductForAdmin, getProductForAdmin, listProductsForAdmin,
  listStockMovementsForAdmin, registerStockForAdmin, updateProductForAdmin,
} from "@/workflows/admin-products";

const db = getDb();
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture() {
  const key = randomUUID().slice(0, 8);
  const [tenant, foreign] = await db.insert(barbershops).values([
    { name: "Products A", slug: `products-a-${key}`, timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
    { name: "Products B", slug: `products-b-${key}`, timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE",
      waitlistOfferTtlMinutes: 10, reminderOffsetMinutes: 60 },
  ]).returning();
  const [user] = await db.insert(users).values({
    email: `products-${key}@example.test`, passwordHash: "test",
  }).returning();
  const product = await createProductForAdmin({
    barbershopId: tenant.id, name: "Leave-in", description: "Finalizador",
    priceCents: 4500, minimumStock: 3,
  }, db);
  const [otherProduct] = await db.insert(products).values({
    barbershopId: foreign.id, name: "Other", priceCents: 9000,
  }).returning();
  async function cleanup() {
    await db.delete(productStockMovements).where(inArray(
      productStockMovements.barbershopId, [tenant.id, foreign.id],
    ));
    await db.delete(products).where(inArray(products.barbershopId, [tenant.id, foreign.id]));
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(barbershops).where(inArray(barbershops.id, [tenant.id, foreign.id]));
  }
  return { tenant, foreign, user, product, otherProduct, cleanup };
}

describe("products and audited stock", () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f.cleanup(); });
  afterAll(async () => { await getPool().end(); });

  function move(input: {
    kind: "IN" | "OUT"; quantity: number; operationId?: string; reason?: string;
  } | {
    kind: "ADJUSTMENT"; newQuantity: number; operationId?: string; reason?: string;
  }) {
    const { operationId = randomUUID(), reason = "Contagem de estoque", ...rest } = input;
    return registerStockForAdmin({
      ...rest, operationId, reason, productId: f.product.id,
      barbershopId: f.tenant.id, userId: f.user.id,
    }, db);
  }

  it("creates products without stock and keeps catalog edits separate from inventory", async () => {
    expect(f.product).toMatchObject({
      name: "Leave-in", stockQuantity: 0, minimumStock: 3, priceCents: 4500,
    });
    const changed = await updateProductForAdmin({
      barbershopId: f.tenant.id, productId: f.product.id, name: "Novo nome",
      priceCents: 5000, active: false,
    }, db);
    expect(changed).toMatchObject({
      name: "Novo nome", priceCents: 5000, active: false, stockQuantity: 0,
    });
    expect(await getProductForAdmin(f.foreign.id, f.product.id, db)).toBeNull();
    expect(await listProductsForAdmin(f.foreign.id, db)).toHaveLength(1);
    expect(await updateProductForAdmin({
      barbershopId: f.foreign.id, productId: f.product.id, name: "Invasão",
    }, db)).toBeNull();
  });

  it("tracks entries, manual exits and absolute stock adjustments", async () => {
    expect((await move({ kind: "IN", quantity: 10 })).status).toBe("ok");
    expect((await move({ kind: "OUT", quantity: 2 })).status).toBe("ok");
    const final = await move({ kind: "ADJUSTMENT", newQuantity: 5 });
    expect(final.status).toBe("ok");
    if (final.status !== "ok") throw Error("Expected adjustment");
    expect(final.movement).toMatchObject({
      quantityBefore: 8, quantityDelta: -3, quantityAfter: 5,
    });
    expect((await getProductForAdmin(f.tenant.id, f.product.id, db))?.stockQuantity).toBe(5);
    const movements = await listStockMovementsForAdmin({
      barbershopId: f.tenant.id, productId: f.product.id,
    }, db);
    expect(movements).toHaveLength(3);
    expect(await listStockMovementsForAdmin({
      barbershopId: f.foreign.id, productId: f.product.id,
    }, db)).toBeNull();
  });

  it("returns the first movement for matching repeated requests and conflicts on reused keys", async () => {
    const operationId = randomUUID();
    const first = await move({ kind: "IN", quantity: 3, operationId });
    const repeated = await move({ kind: "IN", quantity: 3, operationId });
    const changed = await move({ kind: "IN", quantity: 4, operationId });
    expect(first.status).toBe("ok");
    expect(repeated.status).toBe("already-recorded");
    expect(changed.status).toBe("operation-conflict");
    expect((await getProductForAdmin(f.tenant.id, f.product.id, db))?.stockQuantity).toBe(3);
    expect(await db.select().from(productStockMovements).where(
      eq(productStockMovements.productId, f.product.id),
    )).toHaveLength(1);
  });

  it("serializes simultaneous exits and prevents negative balance", async () => {
    await move({ kind: "IN", quantity: 2 });
    const [a, b] = await Promise.all([
      move({ kind: "OUT", quantity: 2 }),
      move({ kind: "OUT", quantity: 2 }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["insufficient-stock", "ok"]);
    expect((await getProductForAdmin(f.tenant.id, f.product.id, db))?.stockQuantity).toBe(0);
    expect(await db.select().from(productStockMovements).where(
      eq(productStockMovements.productId, f.product.id),
    )).toHaveLength(2);
  });

  it("rejects a movement that attempts to cross tenant/product boundaries at the database layer", async () => {
    await expect(db.insert(productStockMovements).values({
      barbershopId: f.tenant.id, productId: f.otherProduct.id,
      kind: "IN", quantityDelta: 1, quantityBefore: 0, quantityAfter: 1,
      reason: "Other tenant", operationId: randomUUID(), createdByUserId: f.user.id,
    })).rejects.toThrow();
  });
});
