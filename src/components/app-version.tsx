import { appVersion } from "@/lib/ops/release";
import { cn } from "@/lib/utils";

/**
 * Versión visible de la aplicación (`vAA.N`, ADR-066). Se fija al construir:
 * no lee sesión ni datos, así que puede prerenderizarse. Sin versión conocida
 * (build sin historia de git) no muestra nada.
 */
export function AppVersion({ className }: { className?: string }) {
  const version = appVersion();
  if (!version) return null;
  return (
    <p className={cn("text-xs tabular-nums", className)}>
      <span className="sr-only">Versión de la aplicación: </span>
      Workia {version}
    </p>
  );
}
