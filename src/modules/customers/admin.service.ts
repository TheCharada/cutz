import type { DbExecutor } from "@/infrastructure/db/executor";
import { findAdminCustomerById, listAdminCustomers } from "./admin.repository";

export function getAdminCustomers(
  executor: DbExecutor,
  params: { barbershopId: string; query?: string; page: number; pageSize: number },
) {
  return listAdminCustomers(executor, params);
}

export function getAdminCustomer(
  executor: DbExecutor,
  barbershopId: string,
  customerId: string,
) {
  return findAdminCustomerById(executor, barbershopId, customerId);
}
