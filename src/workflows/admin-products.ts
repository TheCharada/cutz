import { getDb, type Database } from "@/infrastructure/db/client";
import {
  createTenantProduct, getTenantProduct, listTenantProducts, patchTenantProduct,
  listProductMovements, registerStockCommand,
  type StockCommand,
} from "@/modules/products";

export function listProductsForAdmin(barbershopId: string, database: Database = getDb()) {
  return listTenantProducts(database, barbershopId);
}

export function getProductForAdmin(barbershopId: string, productId: string, database: Database = getDb()) {
  return getTenantProduct(database, barbershopId, productId);
}

export function createProductForAdmin(params: {
  barbershopId: string; name: string; description?: string | null;
  priceCents: number; minimumStock?: number;
}, database: Database = getDb()) {
  return createTenantProduct(database, {
    ...params, name: params.name.trim(), description: params.description?.trim() || null,
  });
}

export function updateProductForAdmin(params: {
  barbershopId: string; productId: string; name?: string; description?: string | null;
  priceCents?: number; minimumStock?: number; active?: boolean;
}, database: Database = getDb()) {
  return patchTenantProduct(database, {
    ...params, ...(params.name === undefined ? {} : { name: params.name.trim() }),
    ...(params.description === undefined ? {} : { description: params.description?.trim() || null }),
  });
}

export async function listStockMovementsForAdmin(
  params: { barbershopId: string; productId: string; limit?: number; offset?: number },
  database: Database = getDb(),
) {
  const product = await getTenantProduct(database, params.barbershopId, params.productId);
  if (!product) return null;
  return listProductMovements(database, params.barbershopId, params.productId,
    params.limit ?? 50, params.offset ?? 0);
}

export function registerStockForAdmin(command: StockCommand, database: Database = getDb()) {
  return registerStockCommand(database, command);
}
