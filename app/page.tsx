import {
  OnboardingScreen,
  SignInScreen,
  UnavailableScreen,
} from "@/components/access-screens";
import { NexoApp } from "@/components/nexo-app";
import { signInPath } from "@/lib/auth/identity";
import { getAuthState } from "@/lib/auth/session";
import { loadWorkspace } from "@/lib/view/workspace";

/**
 * Entrada da aplicação.
 *
 * A página é um componente de servidor de propósito: é aqui que a organização é
 * resolvida e os dados são lidos já recortados por ela. O componente de cliente
 * recebe um retrato pronto e nunca decide de qual empresa carregar.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const state = await getAuthState();

  switch (state.status) {
    case "anonymous":
      return <SignInScreen signInPath={signInPath("/")} />;
    case "unavailable":
      return <UnavailableScreen />;
    case "no-organization":
      return <OnboardingScreen email={state.identity.email} />;
    case "authenticated":
      return <NexoApp workspace={await loadWorkspace(state)} />;
  }
}
