import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  /** Ayuda breve bajo la etiqueta (formato, para qué se usa). */
  description?: string;
  errors?: string[];
};

/** Campo de formulario accesible: etiqueta, ayuda, input y errores enlazados por aria. */
export function FormField({
  name,
  label,
  description,
  errors,
  id,
  "aria-describedby": extraDescribedBy,
  ...props
}: FormFieldProps) {
  const inputId = id ?? name;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;
  const hasErrors = Boolean(errors?.length);
  const describedBy =
    [description ? descriptionId : null, extraDescribedBy, hasErrors ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      {description ? (
        <p id={descriptionId} className="text-muted-foreground -mt-1 text-xs">
          {description}
        </p>
      ) : null}
      <Input
        id={inputId}
        name={name}
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hasErrors ? (
        <p id={errorId} className="text-destructive flex gap-1 text-sm">
          <span aria-hidden>!</span>
          {errors?.join(". ")}
        </p>
      ) : null}
    </div>
  );
}
