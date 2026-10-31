import type { Database } from "@/infrastructure/db/client";
import {
  findStockOperation, getTenantProduct, insertStockMovement, lockTenantProduct,
  updateProductStock,
} from "./product.repository";
import type { StockCommand, StockMovement, StockResult } from "./types";

type Executor = Parameters<Database["transaction"]>[0];
type Tx = Parameters<Executor>[0];

function matches(row: StockMovement, command: StockCommand) {
  if (row.productId !== command.productId || row.kind !== command.kind ||
      row.reason !== command.reason.trim() || row.createdByUserId !== command.userId) return false;
  if (command.kind === "ADJUSTMENT") return row.quantityAfter === command.newQuantity;
  return Math.abs(row.quantityDelta) === command.quantity;
}

function previousResult(row: StockMovement, command: StockCommand): StockResult {
  return matches(row, command)
    ? { status: "already-recorded", movement: row, stockQuantity: row.quantityAfter }
    : { status: "operation-conflict" };
}

async function apply(tx: Tx, command: StockCommand): Promise<StockResult> {
  const product = await lockTenantProduct(tx, command.barbershopId, command.productId);
  if (!product) return { status: "not-found" };

  const old = await findStockOperation(tx, command.barbershopId, command.operationId);
  if (old) return previousResult(old, command);

  const delta = command.kind === "ADJUSTMENT"
    ? command.newQuantity - product.stockQuantity
    : command.kind === "IN" ? command.quantity : -command.quantity;
  const after = product.stockQuantity + delta;
  if (after < 0) return { status: "insufficient-stock", availableQuantity: product.stockQuantity };

  await updateProductStock(tx, command.barbershopId, command.productId, after);
  const movement = await insertStockMovement(tx, {
    barbershopId: command.barbershopId,
    productId: command.productId,
    operationId: command.operationId,
    createdByUserId: command.userId,
    kind: command.kind,
    quantityDelta: delta,
    quantityBefore: product.stockQuantity,
    quantityAfter: after,
    reason: command.reason.trim(),
  });
  return { status: "ok", movement, stockQuantity: after };
}

export async function registerStockCommand(database: Database, command: StockCommand): Promise<StockResult> {
  try {
    return await database.transaction((tx) => apply(tx, command));
  } catch (error) {
    // The unique operation key is tenant-wide; a concurrent request may have committed
    // the same key for a different product while our transaction was running.
    const pg = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const code = pg.code ?? pg.cause?.code;
    const constraint = pg.constraint ?? pg.cause?.constraint;
    if (code !== "23505" || constraint !== "product_stock_movements_operation_unique") throw error;
    const existing = await findStockOperation(database, command.barbershopId, command.operationId);
    if (!existing) throw error;
    return previousResult(existing, command);
  }
}

export async function loadProductMovements(
  database: Database, barbershopId: string, productId: string,
  list: (db: Database, barbershop: string, product: string) => Promise<StockMovement[]>,
) {
  const product = await getTenantProduct(database, barbershopId, productId);
  if (!product) return null;
  return list(database, barbershopId, productId);
}
