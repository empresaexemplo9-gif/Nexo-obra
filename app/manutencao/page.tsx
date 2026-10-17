import type { Metadata } from "next";

import { MaintenanceLogin } from "@/components/maintenance-login";

export const metadata: Metadata = { title: "Manutenção | DRAP Backoffice", robots: { index: false, follow: false } };
export default function MaintenancePage() { return <MaintenanceLogin />; }
