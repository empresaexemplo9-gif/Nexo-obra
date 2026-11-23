import type { Metadata } from "next";
import { DocumentoLegal } from "@/components/documento-legal";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function Page() {
  return <DocumentoLegal tipo="privacidade" />;
}
