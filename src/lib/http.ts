/**
 * ¿Petición iniciada desde otro sitio? Los navegadores modernos envían
 * Sec-Fetch-Site; las descargas con efectos (registro de la descarga,
 * auditoría) solo se aceptan desde el propio sitio o al abrir el enlace
 * directamente ("none"). Sin la cabecera (cliente no navegador) se permite: la
 * sesión sigue siendo obligatoria y la cookie es SameSite=Lax.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}
