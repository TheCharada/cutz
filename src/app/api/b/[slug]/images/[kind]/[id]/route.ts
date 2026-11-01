import { z } from "zod";
import { readPublicCatalogImage } from "@/workflows/catalog-images";
import { readPublicProductImage } from "@/workflows/product-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string; kind: string; id: string }> };

export async function GET(request: Request, context: Context) {
  const { slug, kind, id } = await context.params;
  if ((kind !== "services" && kind !== "staff" && kind !== "products") || !z.uuid().safeParse(id).success) {
    return new Response(null, { status: 404 });
  }
  const image = kind === "products"
    ? await readPublicProductImage({ slug, id })
    : await readPublicCatalogImage({ slug, kind, id });
  if (!image) return new Response(null, { status: 404 });
  const etag = `"${image.imageKey.split("/").at(-1)}"`;
  const headers = new Headers({
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=300",
    "ETag": etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(image.bytes), { status: 200, headers });
}
