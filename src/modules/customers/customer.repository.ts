import { and, eq, gt } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/executor";
import { customers, customerSessions } from "@/infrastructure/db/schema";

const customerSelection = {
  id: customers.id,
  barbershopId: customers.barbershopId,
  name: customers.name,
  phoneE164: customers.phoneE164,
};

export async function insertCustomerIfMissing(
  executor: DbExecutor,
  params: { barbershopId: string; name: string; phoneE164: string },
) {
  const [row] = await executor
    .insert(customers)
    .values({
      barbershopId: params.barbershopId,
      name: params.name,
      phoneE164: params.phoneE164,
    })
    .onConflictDoNothing({ target: [customers.barbershopId, customers.phoneE164] })
    .returning(customerSelection);

  return row ?? null;
}

export async function findCustomerByPhone(
  executor: DbExecutor,
  barbershopId: string,
  phoneE164: string,
) {
  const [row] = await executor
    .select(customerSelection)
    .from(customers)
    .where(and(eq(customers.barbershopId, barbershopId), eq(customers.phoneE164, phoneE164)))
    .limit(1);

  return row ?? null;
}

export async function findCustomerById(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  const [row] = await executor
    .select(customerSelection)
    .from(customers)
    .where(and(eq(customers.barbershopId, barbershopId), eq(customers.id, customerId)))
    .limit(1);

  return row ?? null;
}

export async function insertCustomerSession(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    customerId: string;
    tokenHash: string;
    verificationLevel: "UNVERIFIED" | "PHONE_VERIFIED";
    expiresAt: Date;
  },
) {
  await executor.insert(customerSessions).values(params);
}

export async function deleteCustomerSessionByHash(
  executor: DbExecutor,
  params: { barbershopId: string; tokenHash: string },
) {
  await executor
    .delete(customerSessions)
    .where(
      and(
        eq(customerSessions.barbershopId, params.barbershopId),
        eq(customerSessions.tokenHash, params.tokenHash),
      ),
    );
}

export async function findCustomerPrincipalBySessionHash(
  executor: DbExecutor,
  params: { barbershopId: string; tokenHash: string; now: Date },
) {
  const [row] = await executor
    .select({
      ...customerSelection,
      verificationLevel: customerSessions.verificationLevel,
    })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(
      and(
        eq(customerSessions.barbershopId, params.barbershopId),
        eq(customerSessions.tokenHash, params.tokenHash),
        gt(customerSessions.expiresAt, params.now),
      ),
    )
    .limit(1);

  return row ?? null;
}
