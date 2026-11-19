import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Marca DRAP Backoffice para Arquitetos.
 *
 * Os arquivos em `public/brand` são vetores fechados: símbolo "D" com o corte diagonal da
 * DRAP e lettering convertido em contorno. Nunca redesenhe, recomponha ou aplique efeito
 * sobre eles. As proporções abaixo vêm da própria arte, então a imagem nunca achata nem estica.
 *
 * O espaço Oikos usa a marca própria (H.OIKOS, a identidade anterior desta plataforma). As
 * duas artes saem no HTML e o CSS mostra a da marca do documento (`html[data-marca]`):
 * assim a troca acontece antes da primeira pintura, sem esperar o React.
 */
export type BrandVariant = "symbol" | "wordmark" | "signature" | "stacked" | "lockup";

type Arte = { width: number; height: number; minWidth: number };

const artwork: Record<BrandVariant, Arte> = {
  // Largura mínima de 150 px para o lettering com a assinatura em uso digital; o lockup
  // usa o nome curto ("Backoffice") e continua legível com menos.
  symbol: { width: 320, height: 330, minWidth: 24 },
  wordmark: { width: 503, height: 140, minWidth: 150 },
  signature: { width: 815, height: 216, minWidth: 150 },
  stacked: { width: 815, height: 540, minWidth: 150 },
  lockup: { width: 788, height: 225, minWidth: 120 },
};

// Proporções da arte H.OIKOS, tiradas do manual de identidade dela.
const artworkOikos: Record<BrandVariant, Arte> = {
  symbol: { width: 340, height: 352, minWidth: 24 },
  wordmark: { width: 978, height: 171, minWidth: 150 },
  signature: { width: 978, height: 269, minWidth: 150 },
  stacked: { width: 978, height: 724, minWidth: 150 },
  lockup: { width: 1297, height: 241, minWidth: 120 },
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
  const oikos = artworkOikos[variant];
  const tone = dark ? "dark" : "light";
  return (
    <>
      <Image
        src={`/brand/drap-${variant}-${tone}.svg`}
        alt="DRAP · Backoffice para arquitetos"
        width={art.width}
        height={art.height}
        priority
        unoptimized
        style={{ minWidth: `${art.minWidth}px` }}
        className={cn("drap-brand marca-drap block h-auto w-full shrink-0", className)}
      />
      <Image
        src={`/brand/hoikos-${variant}-${tone}.svg`}
        alt="H.OIKOS — Ecossistema para arquitetos"
        width={oikos.width}
        height={oikos.height}
        loading="lazy"
        unoptimized
        style={{ minWidth: `${oikos.minWidth}px` }}
        className={cn("drap-brand marca-oikos block h-auto w-full shrink-0", className)}
      />
    </>
  );
}
