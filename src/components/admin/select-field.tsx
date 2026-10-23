import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/** Selector nativo accesible (mejor experiencia en móvil que un desplegable propio). */
export function SelectField({
  name,
  label,
  options,
  errors,
  placeholder,
  className,
  ...props
}: React.ComponentProps<"select"> & {
  name: string;
  label: string;
  options: Option[];
  errors?: string[];
  placeholder?: string;
}) {
  const id = props.id ?? name;
  const errorId = `${id}-error`;
  const hasErrors = Boolean(errors?.length);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        aria-invalid={hasErrors || undefined}
        aria-describedby={hasErrors ? errorId : undefined}
        className={cn(
          "border-input dark:bg-input/30 h-11 w-full rounded-md border bg-transparent px-3 text-base shadow-xs outline-none lg:h-10 lg:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:border-destructive",
          className,
        )}
        {...props}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hasErrors ? (
        <p id={errorId} className="text-destructive text-sm">
          {errors?.join(". ")}
        </p>
      ) : null}
    </div>
  );
}
