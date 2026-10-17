import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminManagementPage({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/admin/b/${slug}/customers`);
}
