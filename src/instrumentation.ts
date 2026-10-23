import type { Instrumentation } from "next";

import { log } from "@/lib/log";
import { releaseInfo } from "@/lib/ops/release";

/**
 * Observabilidad del servidor (docs/OBSERVABILIDAD.md): registro de arranque
 * con la identidad del despliegue y errores no controlados de páginas, Server
 * Actions, rutas y proxy. Se registra la plantilla de ruta (no la URL real),
 * el digest y el request_id; nunca el mensaje, que puede contener datos.
 */
export function register() {
  log.info("app.start", { release: releaseInfo(), runtime: process.env.NEXT_RUNTIME });
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const header = request.headers["x-request-id"];
  log.error("app.request_error", {
    request_id: typeof header === "string" ? header : undefined,
    method: request.method,
    route: context.routePath,
    route_type: context.routeType,
    digest:
      typeof error === "object" && error !== null && "digest" in error
        ? String(error.digest).slice(0, 40)
        : undefined,
    error,
  });
};
