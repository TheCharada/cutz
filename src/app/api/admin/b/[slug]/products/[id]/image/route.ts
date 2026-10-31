import { z } from "zod";
import { errorResponse, jsonResponse } from "@/infrastructure/http";
import { ImageValidationError, maxImageBytes } from "@/infrastructure/storage";
import { uploadProductImage, removeProductImage } from "@/workflows/product-images";
import { adminAccess, adminAccessError, validateAdminMutationOrigin } from "@/app/api/admin/_shared";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string; id: string }> };

export async function PUT(request: Request, context: Context) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return errorResponse("VALIDATION_ERROR", "Envie uma imagem em multipart/form-data.", 400);
  if (Number(request.headers.get("content-length")) > maxImageBytes + 1024 * 1024)
    return errorResponse("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 4 MiB.", 413);
  let form: FormData;
  try { form = await request.formData(); }
  catch { return errorResponse("VALIDATION_ERROR", "Não foi possível ler o arquivo.", 400); }
  const file = form.get("image");
  if (!(file instanceof File)) return errorResponse("VALIDATION_ERROR", "Selecione uma imagem.", 400);
  if (file.size > maxImageBytes) return errorResponse("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 4 MiB.", 413);

  try {
    const result = await uploadProductImage({
      barbershopId: access.barbershop.id, productId: id, slug,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return result.status === "not-found"
      ? errorResponse("NOT_FOUND", "Produto não encontrado.", 404)
      : jsonResponse({ imageUrl: result.imageUrl });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      if (error.code === "TOO_LARGE") return errorResponse("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 4 MiB.", 413);
      if (error.code === "UNSUPPORTED_FORMAT") return errorResponse("UNSUPPORTED_IMAGE", "Use JPEG, PNG ou WebP.", 415);
      return errorResponse("INVALID_IMAGE", "A imagem não pôde ser processada.", 422);
    }
    console.error("Could not store product image", error);
    return errorResponse("STORAGE_ERROR", "Não foi possível salvar a imagem.", 500);
  }
}

export async function DELETE(request: Request, context: Context) {
  const originError = validateAdminMutationOrigin(request);
  if (originError) return originError;
  const { slug, id } = await context.params;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) return errorResponse("NOT_FOUND", "Produto não encontrado.", 404);
  try {
    const result = await removeProductImage({ barbershopId: access.barbershop.id, productId: id, slug });
    return result.status === "not-found"
      ? errorResponse("NOT_FOUND", "Produto não encontrado.", 404)
      : new Response(null, { status: 204 });
  } catch (error) {
    console.error("Could not delete product image", error);
    return errorResponse("STORAGE_ERROR", "Não foi possível remover a imagem.", 500);
  }
}
