import { AdminPageSkeleton } from "@/components/cutz/loading-states";

export default function Loading() {
  return <AdminPageSkeleton label="Carregando lista de espera…" size="xl" kind="list" />;
}
