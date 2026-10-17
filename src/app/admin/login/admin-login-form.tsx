"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Membership = { barbershopId: string; slug: string; name: string; role: "OWNER" | "STAFF" };
type Principal = { user: { id: string; email: string }; memberships: Membership[] };
type ApiError = { error?: { message?: string } };

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível entrar."));
      }
      const principal = (await response.json()) as Principal;
      const membership = principal.memberships[0];
      if (!membership) {
        setError("Este usuário não possui acesso a nenhuma barbearia.");
        return;
      }
      router.replace(`/admin/b/${membership.slug}/agenda`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit} aria-busy={submitting}>
      <div className="space-y-2">
        <Label htmlFor="admin-email">E-mail</Label>
        <Input
          id="admin-email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          disabled={submitting}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-password">Senha</Label>
        <Input
          id="admin-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button className="w-full" type="submit" disabled={submitting}>
        {submitting ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
