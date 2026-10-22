"use client";

export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 16, textAlign: "center" }}>
        <h1>Algo ha fallado</h1>
        <p>Se ha producido un error inesperado. Vuelve a intentarlo en unos segundos.</p>
        <button type="button" style={{ minHeight: 44, padding: "0 16px" }} onClick={() => retry()}>
          Reintentar
        </button>
      </body>
    </html>
  );
}
