"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SubmitButton({
  pending,
  children,
  variant,
  className,
  onClick,
}: {
  pending: boolean;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      className={className}
      onClick={onClick}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
