import { redirect } from "next/navigation";

import { SignInApp } from "@/components/sign-in-app";
import { openAccessEnabled } from "@/lib/server/superadmin";

export const metadata = { title: "Entrar · H.OIKOS" };
export const dynamic = "force-dynamic";

export default function SignInPage() {
  // Com o acesso aberto ligado, não há login: o link já entra como superadministrador.
  if (openAccessEnabled()) redirect("/");
  return <SignInApp />;
}
