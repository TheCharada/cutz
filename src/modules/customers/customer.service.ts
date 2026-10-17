import type { DbExecutor } from "@/infrastructure/db/executor";
import { createOpaqueToken, hashOpaqueToken } from "@/shared/tokens";
import {
  deleteCustomerSessionByHash,
  findCustomerById,
  findCustomerByPhone,
  findCustomerPrincipalBySessionHash,
  insertCustomerIfMissing,
  insertCustomerSession,
} from "./customer.repository";
import type { CustomerIdentity, CustomerPrincipal, IssuedCustomerSession } from "./types";

export const UNVERIFIED_CUSTOMER_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const PHONE_VERIFIED_CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createOrReuseCustomer(
  executor: DbExecutor,
  params: { barbershopId: string; name: string; phoneE164: string },
): Promise<CustomerIdentity> {
  const created = await insertCustomerIfMissing(executor, params);
  if (created) {
    return created;
  }

  const existing = await findCustomerByPhone(executor, params.barbershopId, params.phoneE164);
  if (!existing) {
    throw new Error("Customer conflict resolved without a visible row");
  }

  return existing;
}

export function getCustomerIdentity(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
): Promise<CustomerIdentity | null> {
  return findCustomerById(executor, barbershopId, customerId);
}

export function getCustomerByPhone(
  executor: DbExecutor,
  barbershopId: string,
  phoneE164: string,
): Promise<CustomerIdentity | null> {
  return findCustomerByPhone(executor, barbershopId, phoneE164);
}

async function issueCustomerSession(
  executor: DbExecutor,
  customer: CustomerIdentity,
  now: Date,
  verificationLevel: "UNVERIFIED" | "PHONE_VERIFIED",
  ttlMs: number,
): Promise<IssuedCustomerSession> {
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await insertCustomerSession(executor, {
    barbershopId: customer.barbershopId,
    customerId: customer.id,
    tokenHash: hashOpaqueToken(token),
    verificationLevel,
    expiresAt,
  });

  return {
    token,
    expiresAt,
    principal: { ...customer, verificationLevel },
  };
}

export function issueUnverifiedCustomerSession(
  executor: DbExecutor,
  customer: CustomerIdentity,
  now: Date,
): Promise<IssuedCustomerSession> {
  return issueCustomerSession(
    executor,
    customer,
    now,
    "UNVERIFIED",
    UNVERIFIED_CUSTOMER_SESSION_TTL_MS,
  );
}

export function issuePhoneVerifiedCustomerSession(
  executor: DbExecutor,
  customer: CustomerIdentity,
  now: Date,
): Promise<IssuedCustomerSession> {
  return issueCustomerSession(
    executor,
    customer,
    now,
    "PHONE_VERIFIED",
    PHONE_VERIFIED_CUSTOMER_SESSION_TTL_MS,
  );
}

export function resolveCustomerPrincipal(
  executor: DbExecutor,
  params: { barbershopId: string; token: string; now: Date },
): Promise<CustomerPrincipal | null> {
  return findCustomerPrincipalBySessionHash(executor, {
    barbershopId: params.barbershopId,
    tokenHash: hashOpaqueToken(params.token),
    now: params.now,
  });
}

export function customerSessionSatisfiesVerificationMode(
  principal: CustomerPrincipal,
  verificationMode: "NONE" | "WHATSAPP_OTP",
) {
  return verificationMode === "NONE" || principal.verificationLevel === "PHONE_VERIFIED";
}

export function revokeCustomerSession(
  executor: DbExecutor,
  params: { barbershopId: string; token: string },
) {
  return deleteCustomerSessionByHash(executor, {
    barbershopId: params.barbershopId,
    tokenHash: hashOpaqueToken(params.token),
  });
}
