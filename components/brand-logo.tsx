import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Marca DRAP Backoffice para Arquitetos.
 *
 * Os arquivos em `public/brand` são vetores fechados: símbolo "D" com o corte diagonal da
 * DRAP e lettering convertido em contorno. Nunca redesenhe, recomponha ou aplique efeito
 * sobre eles. As proporções abaixo vêm da própria arte, então a imagem nunca achata nem estica.
 */
export type BrandVariant = "symbol" | "wordmark" | "signature" | "stacked" | "lockup";

const artwork: Record<BrandVariant, { width: number; height: number; minWidth: number }> = {
  // Largura mínima de 150 px para o lettering com a assinatura em uso digital; o lockup
  // usa o nome curto ("Backoffice") e continua legível com menos.
  symbol: { width: 360, height: 320, minWidth: 24 },
  wordmark: { width: 503, height: 140, minWidth: 150 },
  signature: { width: 815, height: 216, minWidth: 150 },
  stacked: { width: 815, height: 540, minWidth: 150 },
  lockup: { width: 823, height: 225, minWidth: 120 },
};

export function BrandLogo({
  variant = "wordmark",
  dark = false,
  className,
}: {
  variant?: BrandVariant;
  /** Aplicação em fundo escuro: a marca vira branca. */
  dark?: boolean;
  className?: string;
}) {
  const art = artwork[variant];
  return (
    <Image
      src={`/brand/drap-${variant}-${dark ? "dark" : "light"}.svg`}
      alt="DRAP · Backoffice para arquitetos"
      width={art.width}
      height={art.height}
      priority
      unoptimized
      style={{ minWidth: `${art.minWidth}px` }}
      className={cn("drap-brand block h-auto w-full shrink-0", className)}
    />
  );
}
