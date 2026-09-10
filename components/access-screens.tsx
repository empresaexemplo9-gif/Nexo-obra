"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, DatabaseZap, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/**
 * Telas dos estados de acesso.
 *
 * Cada uma responde "o que devo fazer agora?": entrar, criar a empresa ou
 * esperar o banco voltar. Nenhuma delas mostra dado de demonstração — em um
 * estado de acesso, número inventado confunde em vez de ajudar.
 */

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="blueprint-grid flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

export function SignInScreen({ signInPath }: { signInPath: string }) {
  return (
    <Screen>
      <Empty className="border bg-white">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LogIn />
          </EmptyMedia>
          <EmptyTitle>Entrar na Nexo Obra</EmptyTitle>
          <EmptyDescription>
            Projetos, obras, orçamentos e equipe em um fluxo só. Entre para abrir a sua empresa.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <a href={signInPath}>Entrar</a>
          </Button>
        </EmptyContent>
      </Empty>
    </Screen>
  );
}

export function UnavailableScreen() {
  return (
    <Screen>
      <Empty className="border bg-white">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseZap />
          </EmptyMedia>
          <EmptyTitle>Banco de dados indisponível</EmptyTitle>
          <EmptyDescription>
            Não foi possível ler os dados da sua empresa. Em vez de mostrar números que não são
            seus, a tela fica fora do ar até a conexão voltar.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tentar de novo
          </Button>
        </EmptyContent>
      </Empty>
    </Screen>
  );
}

type FieldIssue = { field: string; message: string };

/**
 * Primeiro passo do fluxo organização → cliente → projeto → tarefa.
 *
 * Cadastro progressivo: pede o nome e nada mais. Fuso e identificador têm
 * padrão, e quem cria vira `owner` no servidor.
 */
export function OnboardingScreen({ email }: { email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldIssues, setFieldIssues] = useState<FieldIssue[]>([]);

  const nameIssues = fieldIssues.filter((issue) => issue.field === "name");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    setFieldIssues([]);

    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string; fields?: FieldIssue[] } }
          | null;

        setFieldIssues(payload?.error?.fields ?? []);
        setError(payload?.error?.message ?? "Não foi possível criar a empresa.");
        setStatus("idle");
        return;
      }

      // Recarrega pelo servidor: é ele que resolve a empresa ativa.
      router.refresh();
    } catch {
      // Erro de rede nunca é tratado como sucesso silencioso.
      setError("Falha de conexão. Nada foi salvo — tente novamente.");
      setStatus("idle");
    }
  }

  return (
    <Screen>
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid size-10 place-items-center rounded-lg bg-blue-50 text-blue-700">
            <Building2 className="size-5" />
          </span>
          <h1 className="text-lg font-semibold text-slate-950">Criar sua empresa</h1>
          <p className="text-sm text-slate-500">
            Você entrou como {email}, mas ainda não participa de nenhuma empresa.
          </p>
        </div>

        <FieldGroup className="mt-6">
          <Field data-invalid={nameIssues.length > 0 || undefined}>
            <FieldLabel htmlFor="organization-name">Nome da empresa</FieldLabel>
            <Input
              id="organization-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Vertente Arquitetura"
              autoComplete="organization"
              required
              minLength={2}
              maxLength={120}
              aria-invalid={nameIssues.length > 0 || undefined}
              disabled={status === "saving"}
            />
            <FieldDescription>
              Você será o proprietário e poderá convidar a equipe depois.
            </FieldDescription>
            <FieldError errors={nameIssues} />
          </Field>
        </FieldGroup>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="mt-6 w-full" disabled={status === "saving"}>
          {status === "saving" ? <Spinner /> : null}
          {status === "saving" ? "Criando..." : "Criar empresa"}
        </Button>
      </form>
    </Screen>
  );
}
