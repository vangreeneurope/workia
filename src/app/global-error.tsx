"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 16, textAlign: "center" }}>
        <h1>Algo ha fallado</h1>
        <p>Se ha producido un error inesperado. Vuelve a intentarlo en unos segundos.</p>
        <button type="button" onClick={reset}>
          Reintentar
        </button>
      </body>
    </html>
  );
}
