import { IS_DEMO } from "@/lib/demo";

/** Franja que identifica la demostración (datos ficticios, cambios sin guardar). */
export function DemoBanner() {
  if (!IS_DEMO) return null;
  return (
    <p
      role="note"
      className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950 dark:bg-amber-900 dark:text-amber-50"
    >
      Demostración con datos ficticios: puedes navegar por todas las pantallas, pero los cambios no
      se guardan.
    </p>
  );
}
