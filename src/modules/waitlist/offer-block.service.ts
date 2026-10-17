import type { DbExecutor } from "@/infrastructure/db/executor";
import { findPendingOfferBlocks } from "./offer-block.repository";

export function listPendingOfferBlocks(
  executor: DbExecutor,
  params: {
    barbershopId: string;
    staffIds: string[];
    rangeStartsAt: Date;
    rangeEndsAt: Date;
    excludeOfferId?: string;
  },
) {
  return findPendingOfferBlocks(executor, params);
}
