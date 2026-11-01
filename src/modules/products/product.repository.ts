import { and, asc, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { products, productStockMovements } from "@/infrastructure/db/schema";

export function listTenantProducts(executor: DbExecutor, barbershopId: string) {
  return executor.select().from(products)
    .where(eq(products.barbershopId, barbershopId))
    .orderBy(asc(products.name), asc(products.id));
}

export async function getTenantProduct(executor: DbExecutor, barbershopId: string, productId: string) {
  const [row] = await executor.select().from(products)
    .where(and(eq(products.barbershopId, barbershopId), eq(products.id, productId))).limit(1);
  return row ?? null;
}

export async function lockTenantProduct(executor: DbExecutor, barbershopId: string, productId: string) {
  const [row] = await executor.select().from(products)
    .where(and(eq(products.barbershopId, barbershopId), eq(products.id, productId)))
    .for("update").limit(1);
  return row ?? null;
}

export async function createTenantProduct(executor: DbExecutor, params: {
  barbershopId: string; name: string; description?: string | null;
  priceCents: number; minimumStock?: number;
}) {
  const [product] = await executor.insert(products).values({
    ...params, stockQuantity: 0,
  }).returning();
  return product;
}

export async function patchTenantProduct(executor: DbExecutor, params: {
  barbershopId: string; productId: string;
  name?: string; description?: string | null; priceCents?: number;
  minimumStock?: number; active?: boolean;
}) {
  const { barbershopId, productId, ...changes } = params;
  const [product] = await executor.update(products)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(products.barbershopId, barbershopId), eq(products.id, productId)))
    .returning();
  return product ?? null;
}

export async function updateProductStock(executor: DbExecutor, barbershopId: string, productId: string, quantity: number) {
  await executor.update(products).set({ stockQuantity: quantity, updatedAt: new Date() })
    .where(and(eq(products.barbershopId, barbershopId), eq(products.id, productId)));
}

export async function findStockOperation(executor: DbExecutor, barbershopId: string, operationId: string) {
  const [row] = await executor.select().from(productStockMovements)
    .where(and(eq(productStockMovements.barbershopId, barbershopId),
      eq(productStockMovements.operationId, operationId))).limit(1);
  return row ?? null;
}

export async function insertStockMovement(executor: DbExecutor, params: typeof productStockMovements.$inferInsert) {
  const [movement] = await executor.insert(productStockMovements).values(params).returning();
  return movement;
}

export function listProductMovements(executor: DbExecutor, barbershopId: string, productId: string, limit = 50, offset = 0) {
  return executor.select().from(productStockMovements).where(and(
    eq(productStockMovements.barbershopId, barbershopId),
    eq(productStockMovements.productId, productId),
  )).orderBy(desc(productStockMovements.createdAt), desc(productStockMovements.id))
    .limit(limit).offset(offset);
}
