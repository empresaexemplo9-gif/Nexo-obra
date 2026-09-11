import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Marca H.OIKOS.
 *
 * Os arquivos em `public/brand` são os contornos originais do manual de identidade
 * visual; nunca redesenhe, recomponha ou aplique efeito sobre eles. As proporções
 * abaixo vêm da própria arte, então a imagem nunca achata nem estica.
 */
export type BrandVariant = "symbol" | "wordmark" | "signature" | "stacked" | "lockup";

const artwork: Record<BrandVariant, { width: number; height: number; minWidth: number }> = {
  // O manual exige 150 px de largura mínima para o logotipo em uso digital.
  symbol: { width: 340, height: 352, minWidth: 24 },
  wordmark: { width: 978, height: 171, minWidth: 150 },
  signature: { width: 978, height: 269, minWidth: 150 },
  stacked: { width: 978, height: 724, minWidth: 150 },
  lockup: { width: 1297, height: 241, minWidth: 168 },
};

export function BrandLogo({
  variant = "wordmark",
  dark = false,
  className,
}: {
  variant?: BrandVariant;
  /** Aplicação em fundo escuro: a marca vira off-white. */
  dark?: boolean;
  className?: string;
}) {
  const art = artwork[variant];
  return (
    <Image
      src={`/brand/hoikos-${variant}-${dark ? "dark" : "light"}.svg`}
      alt="H.OIKOS — Ecossistema para arquitetos"
      width={art.width}
      height={art.height}
      priority
      unoptimized
      style={{ minWidth: `${art.minWidth}px` }}
      className={cn("hoikos-brand block h-auto w-full shrink-0", className)}
    />
  );
}
