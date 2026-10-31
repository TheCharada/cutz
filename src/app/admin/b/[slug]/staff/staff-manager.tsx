"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CatalogPhoto } from "@/components/cutz/catalog-photo";

type Staff = {
  id: string;
  name: string;
  active: boolean;
  acceptsAppointments: boolean;
  userId: string | null;
  imageUrl: string | null;
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

export function StaffManager({ slug, staff }: { slug: string; staff: Staff[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function redirectExpired(response: Response) {
    if (response.status !== 401) return false;
    router.replace("/admin/login");
    router.refresh();
    return true;
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/staff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          active: true,
          acceptsAppointments: true,
        }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível criar o profissional."));
      form.reset();
      setNotice("Profissional criado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o profissional.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" aria-busy={busy}>
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold tracking-tight text-foreground">Novo profissional</h3>
          <p className="text-sm text-muted-foreground">O profissional começa ativo e aceitando agendamentos; essas opções podem ser ajustadas no detalhe.</p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createStaff}>
            <div className="w-full space-y-2 sm:max-w-md">
              <Label htmlFor="new-staff-name">Nome do profissional</Label>
              <Input id="new-staff-name" name="name" required maxLength={120} disabled={busy} />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Adicionando…" : "Adicionar profissional"}</Button>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="staff-list-title">
        <h3 id="staff-list-title" className="text-lg font-semibold text-foreground">Equipe cadastrada</h3>
        <p className="mt-1 text-sm text-muted-foreground">{staff.length} profissional(is) cadastrado(s).</p>

        {staff.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum profissional cadastrado.</div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((member) => (
              <Card key={member.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CatalogPhoto name={member.name} src={member.imageUrl} className="size-14" />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate font-semibold text-foreground">{member.name}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{member.userId ? "Login administrativo vinculado" : "Sem login vinculado"}</p>
                    </div>
                    <Badge variant={member.active ? "success" : "neutral"}>{member.active ? "Ativo" : "Inativo"}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Badge variant={member.acceptsAppointments ? "success" : "warning"}>
                      {member.acceptsAppointments ? "Recebe agenda" : "Sem agenda"}
                    </Badge>
                  </div>
                  <Link
                    href={`/admin/b/${slug}/staff/${member.id}`}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Configurar ${member.name}`}
                  >
                    Configurar
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
