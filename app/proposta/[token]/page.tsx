import { getDatabase } from "@/db";
import { ProposalPublicApp } from "@/components/proposal-public-app";
import { loadProposalByToken, publicProposalView } from "@/lib/server/proposals";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposta · DRAP Backoffice", robots: { index: false, follow: false }, referrer: "no-referrer" };

function Unavailable() {
  return (
    <main className="grid min-h-svh place-items-center bg-drap-stone p-5">
      <div className="max-w-md rounded-sm bg-white p-8 text-center shadow-sm">
        <h1 className="display-heading text-3xl text-drap-950">Proposta indisponível</h1>
        <p className="mt-3 text-sm leading-6 text-drap-800">Este link não abre nenhuma proposta. Ele pode ter sido cancelado ou estar incompleto. Peça um novo link a quem enviou.</p>
      </div>
    </main>
  );
}

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let row;
  try { row = await loadProposalByToken(getDatabase(), token); }
  catch { row = null; }
  if (!row) return <Unavailable />;
  const view = publicProposalView(row);
  return (
    <ProposalPublicApp
      token={token}
      version={Number(row.updated_at)}
      totalCents={view.totalCents}
      accepted={view.acceptedAt ? { at: view.acceptedAt, name: view.acceptedName ?? "" } : null}
      updatedAfterSend={view.updatedAfterSend}
      expired={view.expired}
      data={{
        code: view.code, title: view.title, organizationName: view.organizationName, timezone: view.timezone,
        recipientName: view.recipientName, projectName: view.projectName, issuedAt: view.issuedAt,
        validityDays: view.validityDays, content: view.content,
      }}
    />
  );
}
