import { redirect } from "next/navigation";
import { resolveServerAdminSession } from "@/app/admin/_lib/server-auth";
import { PageHeader } from "@/components/cutz/page-header";
import { PageShell } from "@/components/cutz/page-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AdminLoginForm } from "./admin-login-form";

export default async function AdminLoginPage() {
  const principal = await resolveServerAdminSession();
  const membership = principal?.memberships[0];
  if (membership) {
    redirect(`/admin/b/${membership.slug}/agenda`);
  }

  return (
    <PageShell size="sm" className="flex items-center">
      <Card className="w-full">
        <CardHeader>
          <PageHeader
            eyebrow="Cutz"
            title="Acesso administrativo"
            description="Entre com seu usuário para acessar a agenda da barbearia."
          />
        </CardHeader>
        <CardContent>
          <AdminLoginForm />
        </CardContent>
      </Card>
    </PageShell>
  );
}
