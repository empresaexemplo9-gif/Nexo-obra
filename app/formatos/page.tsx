import Link from "next/link";
import { FORMAT_SUPPORT } from "@/lib/cad-formats";

export const metadata = { title: "Formatos CAD | Nexo Obra" };
export default function FormatsPage() {
  return <main className="mx-auto max-w-6xl space-y-8 px-6 py-12">
    <Link href="/" className="text-sm underline">Voltar ao Nexo Obra</Link>
    <header className="space-y-3"><p className="text-sm uppercase tracking-widest">Prancheta · CAD</p><h1 className="text-4xl font-semibold">Formatos e compatibilidade</h1><p className="max-w-3xl">Confira o que pode ser aberto, editado e exportado. A detecção usa o conteúdo do arquivo, mesmo quando ele foi renomeado. Revise o relatório de importação e as medidas antes de salvar.</p></header>
    <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-neutral-100"><th className="p-4">Formato</th><th className="p-4">Suporte atual</th><th className="p-4">Limites e alternativas</th></tr></thead><tbody>{FORMAT_SUPPORT.map(([format, status, note]) => <tr key={format} className="border-b last:border-0"><th scope="row" className="p-4 font-medium">{format}</th><td className="p-4">{status}</td><td className="p-4">{note}</td></tr>)}</tbody></table></div>
    <p className="text-sm">Limites atuais: 12 MB por arquivo, 6 mil elementos por leitura DXF, 20 mil elementos e 60 camadas por prancha. Os formatos marcados como pendentes ainda não podem ser importados.</p>
  </main>;
}
