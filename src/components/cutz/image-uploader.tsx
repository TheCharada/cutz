"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CatalogPhoto } from "./catalog-photo";

type ApiError = { error?: { message?: string } };
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 4 * 1024 * 1024;

export function ImageUploader({
  imageUrl, uploadUrl, label, name,
}: {
  imageUrl: string | null;
  uploadUrl: string;
  label: string;
  name: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = `image-${uploadUrl.replace(/[^a-z0-9]/gi, "-")}`;

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function resetPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
    setSelected(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    resetPreview();
    setError(null);
    setNotice(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!allowed.has(file.type)) {
      setError("Selecione uma imagem JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > maxBytes) {
      setError("A imagem deve ter no máximo 4 MiB.");
      return;
    }
    previewRef.current = URL.createObjectURL(file);
    setPreview(previewRef.current);
    setSelected(file);
  }

  async function readError(response: Response, fallback: string) {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function upload() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("image", selected);
    try {
      const response = await fetch(uploadUrl, { method: "PUT", body: form });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(await readError(response, "Não foi possível enviar a imagem."));
      resetPreview();
      setNotice("Fotografia salva.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(uploadUrl, { method: "DELETE" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(await readError(response, "Não foi possível remover a imagem."));
      setConfirmRemoval(false);
      resetPreview();
      setNotice("Fotografia removida.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover a imagem.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-4">
        <CatalogPhoto src={preview ?? imageUrl} name={name} className="size-24" />
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={inputId}>{label}</Label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={choose}
            className="block w-full min-w-0 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold"
          />
          <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP, até 4 MiB.</p>
        </div>
      </div>
      {selected ? (
        <Button type="button" size="sm" disabled={busy} onClick={() => void upload()}>
          {busy ? "Enviando…" : imageUrl ? "Substituir imagem" : "Enviar imagem"}
        </Button>
      ) : null}
      {imageUrl && !confirmRemoval ? (
        <Button type="button" size="sm" variant="outline" disabled={busy}
          onClick={() => setConfirmRemoval(true)}>Remover imagem</Button>
      ) : null}
      {confirmRemoval ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Remover a fotografia atual?</span>
          <Button type="button" size="sm" variant="destructive" disabled={busy}
            onClick={() => void remove()}>Confirmar remoção</Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy}
            onClick={() => setConfirmRemoval(false)}>Cancelar</Button>
        </div>
      ) : null}
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}
    </div>
  );
}
