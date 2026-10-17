import type { DbExecutor } from "@/infrastructure/db/executor";
import { findBarbershopContextById, findBarbershopContextBySlug } from "./barbershop.repository";
import type { BarbershopContext } from "./types";

export async function resolveBarbershopBySlug(
  executor: DbExecutor,
  slug: string,
): Promise<BarbershopContext | null> {
  return findBarbershopContextBySlug(executor, slug);
}

export async function resolveBarbershopById(
  executor: DbExecutor,
  barbershopId: string,
): Promise<BarbershopContext | null> {
  return findBarbershopContextById(executor, barbershopId);
}
