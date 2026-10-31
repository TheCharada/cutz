import { z } from "zod";
import { errorResponse, jsonResponse } from "@/infrastructure/http";
import {
  ImageValidationError, maxImageBytes,
} from "@/infrastructure/storage";
import type { CatalogImageKind } from "@/modules/catalog/image-url";
import { removeCatalogImage, uploadCatalogImage } from "@/workflows/catalog-images";
import {
  adminAccess, adminAccessError, validateAdminMutationOrigin,
} from "@/app/api/admin/_shared";

export async function putCatalogImage(
  request: Request, slug: string, id: string, kind: CatalogImageKind,
) {
  const invalidOrigin = validateAdminMutationOrigin(request);
  if (invalidOrigin) return invalidOrigin;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) {
    return errorResponse("NOT_FOUND", "Cadastro não encontrado.", 404);
  }

  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return errorResponse("VALIDATION_ERROR", "Envie uma imagem em multipart/form-data.", 400);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (contentLength > maxImageBytes + 1024 * 1024) {
    return errorResponse("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 4 MiB.", 413);
  }

  let form: FormData;
  try { form = await request.formData(); }
  catch { return errorResponse("VALIDATION_ERROR", "Não foi possível ler o arquivo enviado.", 400); }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return errorResponse("VALIDATION_ERROR", "Selecione uma imagem.", 400);
  }
  if (file.size > maxImageBytes) {
    return errorResponse("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 4 MiB.", 413);
  }

  try {
    const result = await uploadCatalogImage({
      barbershopId: access.barbershop.id,
      slug, kind, id, bytes: Buffer.from(await file.arrayBuffer()),
    });
    if (result.status === "not-found") {
      return errorResponse("NOT_FOUND", "Cadastro não encontrado.", 404);
    }
    return jsonResponse({ imageUrl: result.imageUrl });
  } catch (error) {
    if (error instanceof ImageValidationError) {
      if (error.code === "TOO_LARGE") {
        return errorResponse("IMAGE_TOO_LARGE", "A imagem deve ter no máximo 4 MiB.", 413);
      }
      if (error.code === "UNSUPPORTED_FORMAT") {
        return errorResponse("UNSUPPORTED_IMAGE", "Use uma imagem JPEG, PNG ou WebP.", 415);
      }
      return errorResponse("INVALID_IMAGE", "A imagem não pôde ser processada.", 422);
    }
    console.error("Could not store catalog image", error);
    return errorResponse("STORAGE_ERROR", "Não foi possível salvar a imagem.", 500);
  }
}

export async function deleteCatalogImage(
  request: Request, slug: string, id: string, kind: CatalogImageKind,
) {
  const invalidOrigin = validateAdminMutationOrigin(request);
  if (invalidOrigin) return invalidOrigin;
  const access = await adminAccess(request, slug, "OWNER");
  if (access.status !== "ok") return adminAccessError(access.status);
  if (!z.uuid().safeParse(id).success) {
    return errorResponse("NOT_FOUND", "Cadastro não encontrado.", 404);
  }
  try {
    const result = await removeCatalogImage({
      barbershopId: access.barbershop.id, slug, kind, id,
    });
    if (result.status === "not-found") {
      return errorResponse("NOT_FOUND", "Cadastro não encontrado.", 404);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Could not remove catalog image", error);
    return errorResponse("STORAGE_ERROR", "Não foi possível remover a imagem.", 500);
  }
}
