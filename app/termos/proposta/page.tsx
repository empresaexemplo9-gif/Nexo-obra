import type { Metadata } from "next";
import { ProposedTermsPage } from "@/components/proposed-terms-page";
export const metadata: Metadata = { title: "Minuta de Termos de Uso | DRAP Backoffice", robots: { index: false, follow: false } };
export default function ProposedTermsRoute() { return <ProposedTermsPage />; }
