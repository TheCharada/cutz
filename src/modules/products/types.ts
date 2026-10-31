export type StockKind = "IN" | "OUT" | "ADJUSTMENT";

export type StockCommand = {
  barbershopId: string;
  productId: string;
  operationId: string;
  userId: string;
  reason: string;
} & (
  | { kind: "IN" | "OUT"; quantity: number; newQuantity?: never }
  | { kind: "ADJUSTMENT"; newQuantity: number; quantity?: never }
);

export type StockResult =
  | { status: "ok" | "already-recorded"; movement: StockMovement; stockQuantity: number }
  | { status: "not-found" }
  | { status: "operation-conflict" }
  | { status: "insufficient-stock"; availableQuantity: number };

export type StockMovement = {
  id: string;
  barbershopId: string;
  productId: string;
  kind: StockKind;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string;
  operationId: string;
  createdByUserId: string;
  createdAt: Date;
};
