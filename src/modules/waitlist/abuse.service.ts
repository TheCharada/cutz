import type { DbExecutor } from "@/infrastructure/db/executor";
import {
  countActiveWaitlistEntriesForCustomer,
  lockWaitlistCreationForCustomer,
} from "./abuse.repository";

export function lockCustomerWaitlistCreation(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  return lockWaitlistCreationForCustomer(executor, barbershopId, customerId);
}

export function countCustomerActiveWaitlistEntries(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  return countActiveWaitlistEntriesForCustomer(executor, barbershopId, customerId);
}
