import { ClientPortalApp } from "@/components/client-portal-app";
export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do cliente · H.OIKOS", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function PortalPage() {
  return <ClientPortalApp />;
}
