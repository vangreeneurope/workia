import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { visibleAdminAreas } from "@/lib/admin/access";
import { getAdminContext } from "@/lib/admin/context";

export const metadata: Metadata = { title: "Administración" };

export default async function AdminPage() {
  const ctx = await getAdminContext();
  if (!ctx) notFound();
  const areas = visibleAdminAreas(ctx.permissions, { groupAdmin: ctx.groupAdmin });
  if (areas.length === 0) notFound();

  return (
    <>
      <PageHeader
        title="Administración"
        description={`Empresa activa: ${ctx.companyName}. Solo ves lo que tu rol permite gestionar.`}
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {areas.map((area) => (
          <li key={area.key}>
            <Link href={area.href} className="block rounded-xl focus-visible:outline-2">
              <Card className="hover:bg-accent/50 h-full transition-colors">
                <CardHeader className="grid-cols-[1fr_auto]">
                  <CardTitle className="text-base">{area.label}</CardTitle>
                  <ChevronRight
                    className="text-muted-foreground row-span-2 size-5 self-center"
                    aria-hidden
                  />
                  <CardDescription>{area.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
