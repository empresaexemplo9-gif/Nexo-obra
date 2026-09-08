import Image from "next/image";
import { cn } from "@/lib/utils";

/** Official outlines from the supplied H.OIKOS manual; never typeset or distort the mark. */
export function BrandLogo({
  compact = false,
  dark = false,
  stacked = false,
  className,
}: {
  compact?: boolean;
  dark?: boolean;
  stacked?: boolean;
  className?: string;
}) {
  const variant = compact ? "symbol" : stacked ? "stacked" : "wordmark";
  return (
    <Image
      src={`/brand/hoikos-${variant}-${dark ? "dark" : "light"}.svg`}
      alt="H.OIKOS — Ecossistema para arquitetos"
      width={compact ? 390 : 1060}
      height={compact ? 405 : stacked ? 810 : 335}
      priority
      unoptimized
      className={cn("hoikos-brand block h-auto shrink-0", compact ? "w-10" : "min-w-[164px] w-[220px] max-w-full", stacked && "mx-auto", className)}
    />
  );
}
