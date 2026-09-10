"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Building2, FolderKanban, ListChecks, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from "@/lib/domain/enums";
import type { ClientCard, MemberOption, ProjectCard } from "@/lib/view/workspace";

/**
 * Criação rápida de cliente, trabalho e tarefa.
 *
 * Regras de interface que este componente segue de propósito:
 *
 * • Cadastro progressivo: cada formulário pede o mínimo para o registro existir.
 *   Campo avançado entra na tela de detalhe, não aqui.
 * • Um único modal, com etapa interna — sem modal dentro de modal.
 * • A validação que vale é a do servidor (Zod). Os erros por campo voltam da API
 *   e são exibidos no campo certo, em vez de um alerta genérico.
 * • Erro de rede nunca fecha o formulário como se tivesse salvo.
 */

type Kind = "client" | "project" | "work" | "task";

type FieldIssue = { field: string; message: string };

type ApiErrorBody = { error?: { message?: string; fields?: FieldIssue[] } };

const OPTIONS: { kind: Kind; label: string; detail: string; icon: typeof FolderKanban }[] = [
  { kind: "client", label: "Cliente", detail: "Nome e contato", icon: Users },
  { kind: "project", label: "Projeto", detail: "Cliente, código e responsável", icon: FolderKanban },
  { kind: "work", label: "Obra", detail: "Execução em campo", icon: Building2 },
  { kind: "task", label: "Tarefa", detail: "Responsável, prazo e vínculo", icon: ListChecks },
];

const TITLES: Record<Kind, string> = {
  client: "Novo cliente",
  project: "Novo projeto",
  work: "Nova obra",
  task: "Nova tarefa",
};

export type QuickCreateProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  /** Etapa inicial: a tela de projetos abre direto no formulário de projeto. */
  initialKind?: Kind | null;
  clients: ClientCard[];
  projects: ProjectCard[];
  members: MemberOption[];
  permissions: { clientWrite: boolean; projectWrite: boolean; taskWrite: boolean };
};

export function QuickCreate({
  open,
  onOpenChange,
  initialKind = null,
  clients,
  projects,
  members,
  permissions,
}: QuickCreateProps) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(initialKind);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const allowed = OPTIONS.filter((option) =>
    option.kind === "client"
      ? permissions.clientWrite
      : option.kind === "task"
        ? permissions.taskWrite
        : permissions.projectWrite,
  );

  function reset(nextKind: Kind | null) {
    setKind(nextKind);
    setFormError(null);
    setIssues([]);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset(initialKind);
    onOpenChange(next);
  }

  const issuesFor = (field: string) => issues.filter((issue) => issue.field === field);

  async function submit(endpoint: string, payload: unknown, successMessage: string) {
    setSaving(true);
    setFormError(null);
    setIssues([]);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setIssues(body?.error?.fields ?? []);
        setFormError(body?.error?.message ?? "Não foi possível salvar.");
        return;
      }

      toast.success(successMessage);
      // O servidor é a fonte: recarrega o retrato em vez de remendar a lista.
      router.refresh();
      handleOpenChange(false);
    } catch {
      setFormError("Falha de conexão. Nada foi salvo — tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  function readForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return new FormData(event.currentTarget);
  }

  /** String vazia de `<select>`/`<input>` vira `null`, não "". */
  const nullable = (value: FormDataEntryValue | null) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? null : text;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind && !initialKind ? (
              <button
                type="button"
                onClick={() => reset(null)}
                aria-label="Voltar para a escolha"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            {kind ? TITLES[kind] : "Criar"}
          </DialogTitle>
          <DialogDescription>
            {kind
              ? "Informe o essencial. O resto você completa na tela do registro."
              : "Escolha o que precisa registrar agora."}
          </DialogDescription>
        </DialogHeader>

        {!kind ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {allowed.map((option) => (
              <button
                key={option.kind}
                type="button"
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40"
                onClick={() => reset(option.kind)}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
                  <option.icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{option.detail}</span>
                </span>
              </button>
            ))}
            {allowed.length === 0 ? (
              <p className="text-sm text-slate-500 sm:col-span-2">
                Seu papel nesta empresa não permite criar registros.
              </p>
            ) : null}
          </div>
        ) : null}

        {kind === "client" ? (
          <form
            onSubmit={(event) => {
              const data = readForm(event);
              void submit(
                "/api/clients",
                {
                  name: String(data.get("name") ?? "").trim(),
                  email: nullable(data.get("email")),
                  phone: nullable(data.get("phone")),
                },
                "Cliente criado",
              );
            }}
          >
            <FieldGroup>
              <Field data-invalid={issuesFor("name").length > 0 || undefined}>
                <FieldLabel htmlFor="client-name">Nome</FieldLabel>
                <Input id="client-name" name="name" required minLength={2} maxLength={160} />
                <FieldError errors={issuesFor("name")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={issuesFor("email").length > 0 || undefined}>
                  <FieldLabel htmlFor="client-email">E-mail</FieldLabel>
                  <Input id="client-email" name="email" type="email" maxLength={160} />
                  <FieldError errors={issuesFor("email")} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-phone">Telefone</FieldLabel>
                  <Input id="client-phone" name="phone" maxLength={32} />
                </Field>
              </div>
            </FieldGroup>
            <FormFooter saving={saving} error={formError} label="Criar cliente" />
          </form>
        ) : null}

        {kind === "project" || kind === "work" ? (
          <form
            onSubmit={(event) => {
              const data = readForm(event);
              void submit(
                "/api/projects",
                {
                  code: String(data.get("code") ?? "").trim(),
                  name: String(data.get("name") ?? "").trim(),
                  kind: kind === "work" ? "work" : "project",
                  clientId: nullable(data.get("clientId")),
                  ownerMemberId: nullable(data.get("ownerMemberId")),
                  targetDate: nullable(data.get("targetDate")),
                },
                kind === "work" ? "Obra criada" : "Projeto criado",
              );
            }}
          >
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
                <Field data-invalid={issuesFor("code").length > 0 || undefined}>
                  <FieldLabel htmlFor="project-code">Código</FieldLabel>
                  <Input
                    id="project-code"
                    name="code"
                    required
                    minLength={2}
                    maxLength={24}
                    placeholder={kind === "work" ? "OBR-001" : "ARQ-001"}
                  />
                  <FieldError errors={issuesFor("code")} />
                </Field>
                <Field data-invalid={issuesFor("name").length > 0 || undefined}>
                  <FieldLabel htmlFor="project-name">Nome</FieldLabel>
                  <Input id="project-name" name="name" required minLength={3} maxLength={160} />
                  <FieldError errors={issuesFor("name")} />
                </Field>
              </div>
              <Field data-invalid={issuesFor("clientId").length > 0 || undefined}>
                <FieldLabel htmlFor="project-client">Cliente</FieldLabel>
                <NativeSelect id="project-client" name="clientId" defaultValue="">
                  <NativeSelectOption value="">Sem cliente por enquanto</NativeSelectOption>
                  {clients.map((client) => (
                    <NativeSelectOption key={client.id} value={client.id}>
                      {client.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {clients.length === 0 ? (
                  <FieldDescription>
                    Nenhum cliente cadastrado ainda. Você pode vincular depois.
                  </FieldDescription>
                ) : null}
                <FieldError errors={issuesFor("clientId")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={issuesFor("ownerMemberId").length > 0 || undefined}>
                  <FieldLabel htmlFor="project-owner">Responsável</FieldLabel>
                  <NativeSelect id="project-owner" name="ownerMemberId" defaultValue="">
                    <NativeSelectOption value="">A definir</NativeSelectOption>
                    {members.map((member) => (
                      <NativeSelectOption key={member.id} value={member.id}>
                        {member.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError errors={issuesFor("ownerMemberId")} />
                </Field>
                <Field data-invalid={issuesFor("targetDate").length > 0 || undefined}>
                  <FieldLabel htmlFor="project-target">Entrega prevista</FieldLabel>
                  <Input id="project-target" name="targetDate" type="date" />
                  <FieldError errors={issuesFor("targetDate")} />
                </Field>
              </div>
            </FieldGroup>
            <FormFooter
              saving={saving}
              error={formError}
              label={kind === "work" ? "Criar obra" : "Criar projeto"}
            />
          </form>
        ) : null}

        {kind === "task" ? (
          <form
            onSubmit={(event) => {
              const data = readForm(event);
              void submit(
                "/api/tasks",
                {
                  title: String(data.get("title") ?? "").trim(),
                  description: String(data.get("description") ?? "").trim(),
                  projectId: nullable(data.get("projectId")),
                  assigneeMemberId: nullable(data.get("assigneeMemberId")),
                  priority: String(data.get("priority") ?? "normal"),
                  dueAt: nullable(data.get("dueAt")),
                },
                "Tarefa criada",
              );
            }}
          >
            <FieldGroup>
              <Field data-invalid={issuesFor("title").length > 0 || undefined}>
                <FieldLabel htmlFor="task-title">O que precisa ser feito</FieldLabel>
                <Input id="task-title" name="title" required minLength={3} maxLength={200} />
                <FieldError errors={issuesFor("title")} />
              </Field>
              <Field data-invalid={issuesFor("projectId").length > 0 || undefined}>
                <FieldLabel htmlFor="task-project">Trabalho</FieldLabel>
                <NativeSelect id="task-project" name="projectId" defaultValue="">
                  <NativeSelectOption value="">Sem vínculo</NativeSelectOption>
                  {projects.map((project) => (
                    <NativeSelectOption key={project.id} value={project.id}>
                      {project.code} · {project.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError errors={issuesFor("projectId")} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="task-assignee">Responsável</FieldLabel>
                  <NativeSelect id="task-assignee" name="assigneeMemberId" defaultValue="">
                    <NativeSelectOption value="">A definir</NativeSelectOption>
                    {members.map((member) => (
                      <NativeSelectOption key={member.id} value={member.id}>
                        {member.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-priority">Prioridade</FieldLabel>
                  <NativeSelect id="task-priority" name="priority" defaultValue="normal">
                    {TASK_PRIORITIES.map((priority) => (
                      <NativeSelectOption key={priority} value={priority}>
                        {TASK_PRIORITY_LABELS[priority]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field data-invalid={issuesFor("dueAt").length > 0 || undefined}>
                  <FieldLabel htmlFor="task-due">Prazo</FieldLabel>
                  <Input id="task-due" name="dueAt" type="date" />
                  <FieldError errors={issuesFor("dueAt")} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="task-description">Observações</FieldLabel>
                <Textarea id="task-description" name="description" rows={3} maxLength={4000} />
              </Field>
            </FieldGroup>
            <FormFooter saving={saving} error={formError} label="Criar tarefa" />
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormFooter({
  saving,
  error,
  label,
}: {
  saving: boolean;
  error: string | null;
  label: string;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : null}
          {saving ? "Salvando..." : label}
        </Button>
      </div>
    </>
  );
}
