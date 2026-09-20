import { CAD_FORMATS } from "@/lib/cad-formats";

export default function FormatosPage() {
  return <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
    <div><p className="eyebrow text-hoikos-600">Nexo-obra CAD</p><h1 className="text-3xl font-semibold">Formatos compatíveis</h1>
      <p className="mt-2 text-hoikos-600">O suporte é explícito: formatos sem adaptador nunca falham em silêncio.</p></div>
    <div className="overflow-x-auto rounded-lg border border-hoikos-200">
      <table className="w-full text-left text-sm"><thead className="bg-hoikos-50"><tr>
        <th className="p-3">Formato</th><th className="p-3">Extensões</th><th className="p-3">Ler</th><th className="p-3">Editar</th><th className="p-3">Exportar</th><th className="p-3">Observação</th>
      </tr></thead><tbody>{CAD_FORMATS.map((format) => <tr key={format.id} className="border-t border-hoikos-200">
        <td className="p-3 font-medium">{format.label}</td><td className="p-3">{format.extensions.join(", ")}</td>
        <td className="p-3">{format.read ? "Sim" : "Não"}</td><td className="p-3">{format.editable ? "Sim" : "Não"}</td><td className="p-3">{format.write ? "Sim" : "Não"}</td><td className="p-3 text-hoikos-600">{format.note}</td>
      </tr>)}</tbody></table>
    </div>
  </main>;
}
