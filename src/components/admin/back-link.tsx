import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground mb-3 inline-flex min-h-11 items-center gap-1 text-sm"
    >
      <ChevronLeft className="size-4" aria-hidden /> {label}
    </Link>
  );
}
