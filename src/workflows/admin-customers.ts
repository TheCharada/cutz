import { getDb, type Database } from "@/infrastructure/db/client";
import { getAdminCustomer, getAdminCustomers } from "@/modules/customers";
import { listCustomerAppointments } from "@/modules/scheduling";

export function listAdminCustomersForAdmin(
  params: { barbershopId: string; query?: string; page: number; pageSize: number },
  options: { database?: Database } = {},
) {
  return getAdminCustomers(options.database ?? getDb(), params);
}

export async function getAdminCustomerHistory(
  params: { barbershopId: string; customerId: string },
  options: { database?: Database } = {},
) {
  const database = options.database ?? getDb();
  const customer = await getAdminCustomer(database, params.barbershopId, params.customerId);
  if (!customer) return null;
  const appointments = await listCustomerAppointments(database, params.barbershopId, params.customerId);
  return { customer, appointments };
}
