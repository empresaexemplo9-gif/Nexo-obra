import type { Metadata } from "next";

import { PasswordResetApp } from "@/components/password-reset-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Nova senha | H.OIKOS",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function PasswordResetPage({ params }: PageProps) {
  const { token } = await params;
  return <PasswordResetApp token={token} />;
}
