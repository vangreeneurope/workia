import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { KioskActivation, KioskScreen } from "@/features/time-tracking/components/kiosk";
import { KIOSK_COOKIE } from "@/features/time-tracking/constants";
import { KIOSK_TOKEN_RE } from "@/features/time-tracking/schemas";
import { createAnonClient } from "@/lib/supabase/anon";

export const metadata: Metadata = { title: "Terminal de fichaje" };

async function Terminal() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (!token || !KIOSK_TOKEN_RE.test(token)) return <KioskActivation />;
  const { data } = await createAnonClient().rpc("kiosk_device_info", { p_token: token });
  const device = data?.[0];
  if (!device) {
    return <KioskActivation notice="Este terminal se ha desactivado. Introduce un código nuevo." />;
  }
  return <KioskScreen deviceName={device.device_name} centerName={device.work_center_name} />;
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Terminal />
    </Suspense>
  );
}
