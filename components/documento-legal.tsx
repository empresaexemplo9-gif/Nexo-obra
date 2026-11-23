import Link from "next/link";
import { DOCUMENTOS, VERSAO_DOCUMENTOS, type DocumentoLegalTipo } from "@/lib/legal/documentos";

/** Página de Termos de Uso ou Política de Privacidade da DRAP. */
export function DocumentoLegal({ tipo }: { tipo: DocumentoLegalTipo }) {
  const doc = DOCUMENTOS[tipo];
  const outro = tipo === "termos" ? { href: "/privacidade", nome: "Política de Privacidade" } : { href: "/termos", nome: "Termos de Uso" };
  return (
    <article style={{ padding: "32px 16px", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{doc.titulo}</h1>
      <p style={{ fontSize: 13, opacity: 0.7, margin: "4px 0 0" }}>
        Versão de {VERSAO_DOCUMENTOS} · <Link href={outro.href} style={{ color: "inherit" }}>{outro.nome}</Link>
      </p>
      <div style={{ columnWidth: "32rem", columnGap: 40, marginTop: 24 }}>
        {doc.secoes.map((secao) => (
          <section key={secao.titulo} style={{ breakInside: "avoid", marginBottom: 20 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 6px" }}>{secao.titulo}</h2>
            {secao.paragrafos.map((p) => (
              <p key={p} style={{ margin: "0 0 8px" }}>{p}</p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
