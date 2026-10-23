import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto estático del armazón mientras se verifica la sesión. */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_minmax(0,1fr)]" aria-busy="true">
      <aside className="from-sidebar to-sidebar-end hidden h-dvh flex-col gap-2 bg-linear-to-b p-4 md:flex">
        <Skeleton className="h-9 w-40" />
        <div className="mt-6 grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex flex-col">
        <div className="flex h-16 items-center justify-between border-b px-4 md:px-8">
          <Skeleton className="h-9 w-36 md:invisible" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 pt-6 md:px-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
