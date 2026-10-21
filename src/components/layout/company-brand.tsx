import { initials } from "@/lib/utils";

/** Logotipo (URL firmada) o, en su defecto, iniciales sobre el color corporativo. */
export function CompanyBrand({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {logoUrl ? (
        // URL firmada y temporal de un bucket privado: no pasa por el optimizador de imágenes.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-md object-contain" />
      ) : (
        <span
          aria-hidden
          className="bg-brand text-brand-foreground flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
        >
          {initials(name)}
        </span>
      )}
      <span className="truncate font-semibold">{name}</span>
    </div>
  );
}
