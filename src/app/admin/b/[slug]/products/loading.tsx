import { AdminPageSkeleton } from "@/components/cutz/loading-states";
export default function AdminProductsLoading() {
  return <AdminPageSkeleton label="Carregando produtos…" size="lg" kind="list" />;
}
