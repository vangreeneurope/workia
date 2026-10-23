import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
