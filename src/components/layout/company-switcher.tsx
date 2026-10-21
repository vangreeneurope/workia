"use client";

import { Building2, ChevronsUpDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveCompany } from "@/features/companies/actions";

type CompanySwitcherProps = {
  companies: { id: string; name: string }[];
  activeCompanyId: string | null;
};

export function CompanySwitcher({ companies, activeCompanyId }: CompanySwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = companies.find((c) => c.id === activeCompanyId);

  function handleChange(companyId: string) {
    if (companyId === activeCompanyId) return;
    const formData = new FormData();
    formData.set("companyId", companyId);
    startTransition(async () => {
      await setActiveCompany(formData);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="max-w-[45vw] md:max-w-xs"
          aria-label="Cambiar de empresa"
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Building2 aria-hidden />}
          <span className="hidden truncate sm:inline">{active?.name ?? "Elegir empresa"}</span>
          <ChevronsUpDown className="opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Empresa activa</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={activeCompanyId ?? ""} onValueChange={handleChange}>
          {companies.map((company) => (
            <DropdownMenuRadioItem key={company.id} value={company.id}>
              <span className="truncate">{company.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
