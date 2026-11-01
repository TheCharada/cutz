import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminLogoutButton } from "@/app/admin/_components/admin-logout-button";
import { resolveServerAdminAccess } from "@/app/admin/_lib/server-auth";

export default async function AdminBarbershopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const access = await resolveServerAdminAccess(slug);

  if (access.status === "authentication-required") {
    redirect("/admin/login");
  }
  if (access.status !== "ok") {
    notFound();
  }

  const owner = access.membership.role === "OWNER";
  const linkClass =
    "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35";

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cutz Admin</p>
            <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">
              {access.membership.name}
            </h1>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <nav aria-label="Navegação administrativa" className="flex flex-wrap items-center gap-1">
              <Link className={linkClass} href={`/admin/b/${slug}/agenda`}>
                Agenda
              </Link>
              {owner ? (
                <>
                  <Link className={linkClass} href={`/admin/b/${slug}/services`}>
                    Serviços
                  </Link>
                  <Link className={linkClass} href={`/admin/b/${slug}/products`}>
                    Produtos
                  </Link>
                  <Link className={linkClass} href={`/admin/b/${slug}/staff`}>
                    Profissionais
                  </Link>
                </>
              ) : null}
              <Link className={linkClass} href={`/admin/b/${slug}/customers`}>
                Clientes
              </Link>
              <Link className={linkClass} href={`/admin/b/${slug}/waitlist`}>
                Lista de espera
              </Link>
              {owner ? (
                <>
                  <Link className={linkClass} href={`/admin/b/${slug}/analytics`}>
                    Indicadores
                  </Link>
                  <Link className={linkClass} href={`/admin/b/${slug}/settings`}>
                    Configurações
                  </Link>
                </>
              ) : null}
            </nav>
            <AdminLogoutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
