import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { customers } from "@/infrastructure/db/schema";

const adminCustomerSelection = {
  id: customers.id,
  barbershopId: customers.barbershopId,
  name: customers.name,
  phoneE164: customers.phoneE164,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

export async function listAdminCustomers(
  executor: DbExecutor,
  params: { barbershopId: string; query?: string; page: number; pageSize: number },
) {
  const query = params.query?.trim();
  const conditions = [eq(customers.barbershopId, params.barbershopId)];
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(or(ilike(customers.name, pattern), ilike(customers.phoneE164, pattern))!);
  }

  const where = and(...conditions);
  const [rows, countRows] = await Promise.all([
    executor
      .select(adminCustomerSelection)
      .from(customers)
      .where(where)
      .orderBy(asc(customers.name), asc(customers.id))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    executor.select({ count: sql<number>`count(*)::int` }).from(customers).where(where),
  ]);

  return { rows, total: countRows[0]?.count ?? 0 };
}

export async function findAdminCustomerById(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  const [row] = await executor
    .select(adminCustomerSelection)
    .from(customers)
    .where(and(eq(customers.barbershopId, barbershopId), eq(customers.id, customerId)))
    .limit(1);
  return row ?? null;
}
