import { TITULAR } from "@/lib/legal/titular";

/** Linha fixa de titularidade exibida no fim de todas as páginas. */
export function AvisoLegal({ className }: { className?: string }) {
  return (
    <footer
      className={className}
      style={{
        fontSize: 11,
        lineHeight: 1.5,
        opacity: 0.7,
        paddingTop: 12,
        paddingInline: 16,
        paddingBottom: className ? undefined : 12,
        textAlign: "center",
      }}
    >
      © {new Date().getFullYear()} {TITULAR.razaoSocial} · CNPJ {TITULAR.cnpj} · Software proprietário.
      Todos os direitos reservados.
    </footer>
  );
}
