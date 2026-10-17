"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConverterArquivos } from "@/components/documentos/converter-arquivos";
import { CriarDocumento } from "@/components/documentos/criar-documento";
import { EditarPdf } from "@/components/documentos/editar-pdf";
import type { Projeto } from "@/components/documentos/comum";

type Aba = "criar" | "editar" | "converter";

/**
 * Documentos e PDF: criar um documento, editar PDF e converter arquivos sem sair da
 * plataforma. O processamento é local; a biblioteca da Prancheta é a persistência.
 */
export function DocumentosWorkspace({ projects, canEdit }: { projects: Projeto[]; canEdit: boolean }) {
  const [aba, setAba] = useState<Aba>("criar");
  const [textoParaEditar, setTextoParaEditar] = useState<{ texto: string; nome: string; versao: number } | null>(null);

  return <div className="space-y-5">
    <div className="drap-module-heading"><div><p className="eyebrow text-drap-600">Documentos</p><h1 className="display-heading mt-2 text-4xl text-drap-950" style={{ fontSize: "clamp(1.9rem, 8.5vw, 3.5rem)" }}>Documentos e PDF</h1><p className="mt-2 max-w-3xl text-sm text-drap-500">Crie memoriais e atas, edite PDFs e converta arquivos. Tudo é processado neste navegador; o arquivo só vai para a biblioteca quando você pede para guardar.</p></div></div>
    <Tabs value={aba} onValueChange={(valor) => setAba(valor as Aba)}>
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="criar">Criar documento</TabsTrigger>
        <TabsTrigger value="editar">Editar PDF</TabsTrigger>
        <TabsTrigger value="converter">Converter</TabsTrigger>
      </TabsList>
      {/* forceMount: trocar de aba não descarta o trabalho em andamento. */}
      <TabsContent value="criar" forceMount className="data-[state=inactive]:hidden"><CriarDocumento canEdit={canEdit} projects={projects} textoInicial={textoParaEditar} /></TabsContent>
      <TabsContent value="editar" forceMount className="data-[state=inactive]:hidden"><EditarPdf canEdit={canEdit} projects={projects} /></TabsContent>
      <TabsContent value="converter" forceMount className="data-[state=inactive]:hidden"><ConverterArquivos canEdit={canEdit} projects={projects} onEditarTexto={(texto, nome) => {
        if (!window.confirm("Abrir o texto extraído no editor? O texto que estiver lá será substituído.")) return;
        setTextoParaEditar((atual) => ({ texto, nome, versao: (atual?.versao ?? 0) + 1 }));
        setAba("criar");
      }} /></TabsContent>
    </Tabs>
  </div>;
}
