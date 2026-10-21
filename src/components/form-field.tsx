import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  errors?: string[];
};

/** Campo de formulario accesible: etiqueta, input y errores enlazados por aria. */
export function FormField({ name, label, errors, id, ...props }: FormFieldProps) {
  const inputId = id ?? name;
  const errorId = `${inputId}-error`;
  const hasErrors = Boolean(errors?.length);
  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        name={name}
        aria-invalid={hasErrors || undefined}
        aria-describedby={hasErrors ? errorId : undefined}
        {...props}
      />
      {hasErrors ? (
        <p id={errorId} className="text-destructive text-sm">
          {errors?.join(". ")}
        </p>
      ) : null}
    </div>
  );
}
