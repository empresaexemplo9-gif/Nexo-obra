import type { Metadata } from "next";

import { InvitationApp } from "@/components/invitation-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Convite | DRAP Backoffice",
  description: "Aceite seu convite para acessar o DRAP Backoffice.",
  referrer: "no-referrer",
};

type PageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: PageProps) {
  const { token } = await params;
  return <InvitationApp token={token} />;
}
