import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/cutz/page-shell";
import { PageHeader } from "@/components/cutz/page-header";
import { CatalogPhoto } from "@/components/cutz/catalog-photo";
import { Badge } from "@/components/ui/badge";
import { listPublicProductsForBarbershop } from "@/workflows/public-products";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default async function PublicProductsPage({ params }: Props) {
  const { slug } = await params;
  const products = await listPublicProductsForBarbershop(slug);
  if (!products) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cutz · produtos"
        title="Produtos disponíveis"
        description="Confira os produtos oferecidos pela barbearia. A compra é feita diretamente no estabelecimento."
      />
      <div className="mt-5">
        <Link className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          href={`/b/${slug}`}>
          Voltar ao agendamento
        </Link>
      </div>
      {products.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          A barbearia ainda não cadastrou produtos para exibição.
        </div>
      ) : (
        <section aria-label="Catálogo de produtos" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="overflow-hidden rounded-2xl border border-border bg-card p-5">
              <CatalogPhoto src={product.imageUrl} name={product.name} className="h-36 w-full" />
              <div className="mt-4 flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{product.name}</h2>
                <Badge variant={product.available ? "success" : "neutral"}>
                  {product.available ? "Disponível" : "Esgotado"}
                </Badge>
              </div>
              {product.description ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
              ) : null}
              <p className="mt-4 text-lg font-semibold">{money.format(product.priceCents / 100)}</p>
            </article>
          ))}
        </section>
      )}
    </PageShell>
  );
}
