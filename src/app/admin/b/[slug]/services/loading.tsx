import { AdminPageSkeleton } from "@/components/cutz/loading-states";

export default function AdminServicesLoading() {
  return <AdminPageSkeleton label="Carregando serviços…" size="lg" kind="list" />;
}
