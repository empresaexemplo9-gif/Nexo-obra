import { ClientPortalInvitation } from "@/components/client-portal-app";
export const dynamic = "force-dynamic";
export const metadata = { title: "Convite do cliente · H.OIKOS", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PortalInvitationPage({ params }: { params: Promise<{ token: string }> }) { return <ClientPortalInvitation token={(await params).token} />; }
