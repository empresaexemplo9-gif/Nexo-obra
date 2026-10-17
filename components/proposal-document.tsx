import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQuantity,
  itemTotalCents,
  proposalTotals,
  validUntil,
  type ProposalContent,
  type ProposalSection,
} from "@/lib/proposals";
import { cn } from "@/lib/utils";

// A proposta como o cliente lê: folha branca, hierarquia clara, valores alinhados.
// Usado na página do cliente e na prévia da equipe — o que se revisa é o que se envia.

export type ProposalDocumentData = {
  code: string;
  title: string;
  organizationName: string;
  timezone: string;
  recipientName: string;
  projectName: string | null;
  /** Data da emissão; null enquanto rascunho (a data sai no envio). */
  issuedAt: number | null;
  validityDays: number;
  content: ProposalContent;
};

function Paragraphs({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return null;
  return <div className="space-y-3">{blocks.map((block, index) => <p key={index} className="whitespace-pre-line">{block}</p>)}</div>;
}

function Section({ section }: { section: ProposalSection }) {
  if (!section.title.trim() && !section.body.trim()) return null;
  return (
    <section className="break-inside-avoid">
      {section.title.trim() ? <h2 className="proposal-heading">{section.title}</h2> : null}
      <div className="mt-3 text-[0.9375rem] leading-7 text-drap-950"><Paragraphs text={section.body} /></div>
    </section>
  );
}

export function ProposalDocument({ data, className }: { data: ProposalDocumentData; className?: string }) {
  const { content } = data;
  const totals = proposalTotals(content);
  return (
    <article className={cn("proposal-sheet mx-auto w-full max-w-[52rem] bg-white text-drap-950", className)}>
      <header className="border-b-2 border-drap-deep pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-drap-band">{data.organizationName}</p>
            <h1 className="display-heading mt-3 text-[2rem] leading-tight sm:text-[2.6rem]">{content.heading || "Proposta comercial"}</h1>
            <p className="mt-2 text-base text-drap-800">{data.title}</p>
          </div>
          <dl className="grid shrink-0 gap-1 text-sm sm:text-right">
            <div><dt className="sr-only">Número</dt><dd className="font-medium tabular-nums">{data.code}</dd></div>
            <div><dt className="sr-only">Emissão</dt><dd className="text-drap-800">{data.issuedAt ? `Emitida em ${formatDateTime(data.issuedAt, data.timezone)}` : "Data definida no envio"}</dd></div>
            <div><dt className="sr-only">Validade</dt><dd className="text-drap-800">{data.issuedAt ? `Válida até ${formatDate(validUntil(data.issuedAt, data.validityDays), data.timezone)}` : `Validade de ${data.validityDays} dias`}</dd></div>
          </dl>
        </div>
        {data.recipientName || data.projectName ? (
          <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            {data.recipientName ? <div><p className="text-xs uppercase tracking-[0.16em] text-drap-band">Para</p><p className="mt-1 text-base font-medium">{data.recipientName}</p></div> : null}
            {data.projectName ? <div><p className="text-xs uppercase tracking-[0.16em] text-drap-band">Projeto</p><p className="mt-1 text-base font-medium">{data.projectName}</p></div> : null}
          </div>
        ) : null}
      </header>

      <div className="space-y-9 pt-8">
        {content.sectionsBefore.map((section) => <Section key={section.id} section={section} />)}

        {content.items.length ? (
          <section>
            <h2 className="proposal-heading">{content.itemsTitle || "Investimento"}</h2>
            {/* No celular a tabela vira lista: quatro colunas não cabem em 320 px sem rolar de lado. */}
            <ul className="mt-4 divide-y divide-drap-200 border-y border-drap-deep text-sm sm:hidden">
              {content.items.map((item) => (
                <li key={item.id} className="break-inside-avoid py-3">
                  <p className="leading-6">{item.description}</p>
                  <p className="mt-1 flex justify-between gap-3 tabular-nums text-drap-800"><span>{formatQuantity(item.quantity)} {item.unit} × {formatMoney(item.unitPriceCents)}</span><span className="font-medium text-drap-950">{formatMoney(itemTotalCents(item))}</span></p>
                </li>
              ))}
            </ul>
            <div className="mt-4 hidden sm:block print:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-drap-deep text-left text-xs uppercase tracking-[0.12em] text-drap-800">
                    <th scope="col" className="py-2 pr-3 font-medium">Descrição</th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">Qtd.</th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">Valor unit.</th>
                    <th scope="col" className="py-2 pl-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {content.items.map((item) => (
                    <tr key={item.id} className="break-inside-avoid border-b border-drap-200 align-top">
                      <td className="py-3 pr-3 leading-6">{item.description}</td>
                      <td className="whitespace-nowrap py-3 px-3 text-right tabular-nums">{formatQuantity(item.quantity)} {item.unit}</td>
                      <td className="whitespace-nowrap py-3 px-3 text-right tabular-nums">{formatMoney(item.unitPriceCents)}</td>
                      <td className="whitespace-nowrap py-3 pl-3 text-right font-medium tabular-nums">{formatMoney(itemTotalCents(item))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-4 grid max-w-xs gap-1.5 text-sm">
              {totals.discountCents > 0 ? (
                <>
                  <div className="flex justify-between gap-6"><dt className="text-drap-800">Subtotal</dt><dd className="tabular-nums">{formatMoney(totals.subtotalCents)}</dd></div>
                  <div className="flex justify-between gap-6"><dt className="text-drap-800">Desconto</dt><dd className="tabular-nums">− {formatMoney(totals.discountCents)}</dd></div>
                </>
              ) : null}
              <div className="flex items-baseline justify-between gap-6 border-t-2 border-drap-deep pt-2"><dt className="font-medium">Total</dt><dd className="text-xl font-semibold tabular-nums">{formatMoney(totals.totalCents)}</dd></div>
            </dl>
          </section>
        ) : null}

        {content.sectionsAfter.map((section) => <Section key={section.id} section={section} />)}

        {content.closing.trim() ? <div className="border-t border-drap-200 pt-6 text-[0.9375rem] leading-7"><Paragraphs text={content.closing} /><p className="mt-4 font-medium">{data.organizationName}</p></div> : null}
      </div>
    </article>
  );
}
