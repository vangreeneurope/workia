"use client";

import { KeyRound, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/features/auth/actions";
import { GLOBAL_ADMIN_LABEL } from "@/lib/auth/permissions";
import { clearAllDrafts } from "@/lib/drafts";
import { initials } from "@/lib/utils";

type UserMenuProps = {
  fullName: string;
  email: string;
  isGlobalAdmin: boolean;
  /** Versión visible (en móvil no hay barra lateral donde mostrarla). */
  version: string | null;
};

export function UserMenu({ fullName, email, isGlobalAdmin, version }: UserMenuProps) {
  const [pending, startTransition] = useTransition();
  const displayName = fullName || email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Menú de usuario">
          <Avatar className="size-9">
            <AvatarFallback className="bg-brand text-brand-foreground text-sm font-medium">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate">{displayName}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{email}</span>
          {isGlobalAdmin ? (
            <span className="text-muted-foreground text-xs font-normal">{GLOBAL_ADMIN_LABEL}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/perfil">
            <UserRound aria-hidden /> Mi perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/perfil/contrasena">
            <KeyRound aria-hidden /> Cambiar contraseña
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            // Cierre voluntario: no deja texto escrito en este dispositivo (ADR-069).
            clearAllDrafts();
            startTransition(() => signOut());
          }}
        >
          <LogOut aria-hidden /> {pending ? "Cerrando sesión…" : "Cerrar sesión"}
        </DropdownMenuItem>
        {version ? (
          <p className="text-muted-foreground px-2 pt-2 pb-1 text-xs tabular-nums md:hidden">
            <span className="sr-only">Versión de la aplicación: </span>Workia {version}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
