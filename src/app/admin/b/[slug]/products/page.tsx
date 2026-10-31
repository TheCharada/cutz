import { notFound, redirect } from "next/navigation";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";
import { PageShell } from "@/components/cutz/page-shell";
import { productImageUrl } from "@/modules/products/image-url";
import { listProductsForAdmin } from "@/workflows/admin-products";
import { ProductManager } from "./product-manager";

type Props = { params: Promise<{ slug: string }> };

export default async function AdminProductsPage({ params }: Props) {
  const { slug } = await params;
  const access = await resolveServerAdminAccess(slug, "OWNER");
  if (access.status === "authentication-required") redirect("/admin/login");
  if (access.status !== "ok") notFound();

  const products = await listProductsForAdmin(access.barbershop.id);
  const rows = products.map(({ imageKey, ...product }) => ({
    ...product,
    imageUrl: productImageUrl(slug, product.id, imageKey),
  }));

  return (
    <PageShell size="lg">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Catálogo</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Produtos e estoque</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Cadastre produtos, gerencie fotografias e registre entradas, saídas e ajustes de estoque.
        </p>
      </header>
      <div className="mt-6">
        <ProductManager slug={slug} products={rows} />
      </div>
    </PageShell>
  );
}
