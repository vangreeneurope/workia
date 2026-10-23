import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Excluye estáticos, imágenes, iconos, manifiesto PWA, service worker y salud (ADR-064).
    "/((?!_next/static|_next/image|favicon.ico|api/salud|icons/|manifest.webmanifest|sw.js|offline.html|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
