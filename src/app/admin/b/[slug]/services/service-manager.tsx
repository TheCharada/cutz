"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploader } from "@/components/cutz/image-uploader";

type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number | null;
  imageUrl: string | null;
  active: boolean;
};
type ApiError = { error?: { message?: string } };

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function parsePriceCents(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) {
    throw new Error("Informe um preço válido, com no máximo duas casas decimais.");
  }
  const amount = Number(normalized.replace(",", "."));
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents)) {
    throw new Error("Informe um preço válido, com no máximo duas casas decimais.");
  }
  return cents;
}

function priceInputValue(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

function moneyLabel(cents: number | null) {
  if (cents === null) return "Sem preço";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function ServiceManager({ slug, services }: { slug: string; services: Service[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function redirectExpired(response: Response) {
    if (response.status !== 401) return false;
    router.replace("/admin/login");
    router.refresh();
    return true;
  }

  function begin(action: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    begin("create");
    try {
      const response = await fetch(`/api/admin/b/${slug}/services`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          durationMinutes: Number(data.get("durationMinutes")),
          priceCents: parsePriceCents(String(data.get("price") ?? "")),
        }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível criar o serviço."));
      form.reset();
      setNotice("Serviço criado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o serviço.");
    } finally {
      setBusy(null);
    }
  }

  async function updateService(service: Service, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    begin(`service:${service.id}`);
    try {
      const response = await fetch(`/api/admin/b/${slug}/services/${service.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          durationMinutes: Number(data.get("durationMinutes")),
          priceCents: parsePriceCents(String(data.get("price") ?? "")),
          active: data.has("active"),
        }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível atualizar o serviço."));
      setNotice("Serviço atualizado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o serviço.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6" aria-busy={busy !== null}>
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold tracking-tight text-foreground">Novo serviço</h3>
          <p className="text-sm text-muted-foreground">O preço é opcional e pode ser alterado posteriormente.</p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={createService}>
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="new-service-name">Nome</Label>
              <Input id="new-service-name" name="name" required maxLength={120} disabled={busy !== null} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-service-duration">Duração (min)</Label>
              <Input id="new-service-duration" name="durationMinutes" type="number" min={1} max={1440} defaultValue="30" required disabled={busy !== null} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-service-price">Preço (R$)</Label>
              <Input id="new-service-price" name="price" inputMode="decimal" placeholder="Opcional" disabled={busy !== null} />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={busy !== null}>{busy === "create" ? "Criando…" : "Criar serviço"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="services-list-title">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 id="services-list-title" className="text-lg font-semibold text-foreground">Serviços cadastrados</h3>
            <p className="mt-1 text-sm text-muted-foreground">{services.length} serviço(s) no catálogo.</p>
          </div>
        </div>

        {services.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum serviço cadastrado.</div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {services.map((service) => {
              const action = `service:${service.id}`;
              return (
                <Card key={`${service.id}:${service.name}:${service.durationMinutes}:${service.priceCents}:${service.active}`}>
                  <div className="border-b border-border p-4 sm:p-5">
                    <ImageUploader
                      name={service.name}
                      imageUrl={service.imageUrl}
                      label="Fotografia do serviço"
                      uploadUrl={`/api/admin/b/${slug}/services/${service.id}/image`}
                    />
                  </div>
                  <form onSubmit={(event) => void updateService(service, event)}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-foreground">{service.name}</h4>
                          <p className="mt-1 text-sm text-muted-foreground">{service.durationMinutes} min · {moneyLabel(service.priceCents)}</p>
                        </div>
                        <Badge variant={service.active ? "success" : "neutral"}>{service.active ? "Ativo" : "Inativo"}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor={`service-name-${service.id}`}>Nome</Label>
                        <Input id={`service-name-${service.id}`} name="name" required maxLength={120} defaultValue={service.name} disabled={busy !== null} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`service-duration-${service.id}`}>Duração (min)</Label>
                        <Input id={`service-duration-${service.id}`} name="durationMinutes" type="number" min={1} max={1440} required defaultValue={service.durationMinutes} disabled={busy !== null} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`service-price-${service.id}`}>Preço (R$)</Label>
                        <Input id={`service-price-${service.id}`} name="price" inputMode="decimal" defaultValue={priceInputValue(service.priceCents)} disabled={busy !== null} />
                      </div>
                      <label className="flex items-center gap-2 text-sm font-medium text-foreground sm:col-span-2">
                        <input name="active" type="checkbox" defaultChecked={service.active} disabled={busy !== null} className="size-4 rounded border-input" />
                        Serviço ativo
                      </label>
                      <div className="sm:col-span-2">
                        <Button type="submit" variant="secondary" disabled={busy !== null}>{busy === action ? "Salvando…" : "Salvar alterações"}</Button>
                      </div>
                    </CardContent>
                  </form>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
