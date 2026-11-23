import Link from "next/link";
import { TITULAR } from "@/lib/legal/titular";

/** Titularidade, contato e links legais exibidos no fim de todas as páginas. */
export function AvisoLegal({ className }: { className?: string }) {
  return (
    <footer
      className={className}
      style={{
        fontSize: 11,
        lineHeight: 1.6,
        opacity: 0.7,
        paddingTop: 12,
        paddingInline: 16,
        paddingBottom: className ? undefined : 12,
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0 }}>
        © {new Date().getFullYear()} {TITULAR.razaoSocial} · <span style={{ whiteSpace: "nowrap" }}>CNPJ {TITULAR.cnpj}</span> · Software proprietário. Todos os
        direitos reservados.
      </p>
      <p style={{ margin: 0 }}>
        <a href={`mailto:${TITULAR.email}`} style={{ color: "inherit" }}>{TITULAR.email}</a>
        {" · "}
        <a href={TITULAR.telefoneHref} style={{ color: "inherit" }}>{TITULAR.telefone}</a>
        {" · "}
        <Link href="/termos" style={{ color: "inherit" }}>Termos de Uso</Link>
        {" · "}
        <Link href="/privacidade" style={{ color: "inherit" }}>Privacidade</Link>
      </p>
    </footer>
  );
}
