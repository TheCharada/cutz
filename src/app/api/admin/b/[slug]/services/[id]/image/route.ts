import { deleteCatalogImage, putCatalogImage } from "@/app/api/admin/b/[slug]/catalog-image-handler";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string; id: string }> };

export async function PUT(request: Request, context: Context) {
  const { slug, id } = await context.params;
  return putCatalogImage(request, slug, id, "services");
}

export async function DELETE(request: Request, context: Context) {
  const { slug, id } = await context.params;
  return deleteCatalogImage(request, slug, id, "services");
}
