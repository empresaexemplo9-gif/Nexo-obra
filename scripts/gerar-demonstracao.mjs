// Gera lib/demonstracao/respostas.json: as respostas reais da API para uma empresa
// fictícia, que a demonstração pública devolve no navegador do visitante.
//
// Ferramenta de desenvolvimento, nunca roda em produção. Uso, com um banco LOCAL e vazio:
//
//   DATABASE_URL=file:/tmp/demo.db TRUST_IDENTITY_HEADERS=true SESSION_SECRET=... npm run dev
//   node scripts/gerar-demonstracao.mjs http://localhost:3000 file:/tmp/demo.db
//
// O roteiro cadastra a empresa pela própria API (as mesmas validações de produção) e
// depois lê cada listagem. Assim o formato do dado fictício nunca diverge do real: se a
// API mudar, basta gerar de novo. Pessoas, empresas e valores abaixo são inventados.

import { writeFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const base = process.argv[2] ?? "http://localhost:3000";
const banco = process.argv[3];
if (!banco?.startsWith("file:")) { console.error("Informe um banco local (file:...). Este roteiro nunca roda contra banco remoto."); process.exit(1); }

const cabecalhos = { "oai-authenticated-user-id": "demo-ana", "oai-authenticated-user-email": "ana@escritoriomodelo.example", origin: base, "content-type": "application/json" };
async function api(metodo, caminho, corpo) {
  const resposta = await fetch(base + caminho, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await resposta.text();
  let json; try { json = JSON.parse(texto); } catch { json = { bruto: texto.slice(0, 200) }; }
  if (!resposta.ok) throw new Error(`${metodo} ${caminho} → ${resposta.status} ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}
const dia = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const hora = (dias, h = 15) => `${dia(dias)}T${String(h).padStart(2, "0")}:00:00.000Z`;

// ── empresa e equipe ────────────────────────────────────────────────────────────────
const { organization, member: dona } = await api("POST", "/api/onboarding", { organizationName: "Escritório Modelo Arquitetura", acceptTerms: true });
const db = createClient({ url: banco });
await db.execute({ sql: "UPDATE users SET display_name = 'Ana Ribeiro (exemplo)' WHERE id = 'demo-ana'", args: [] });
await db.execute({ sql: "UPDATE members SET name = 'Ana Ribeiro (exemplo)' WHERE id = ?", args: [dona.id] });
const sessao = await api("GET", "/api/session");
const equipe = [["Bruno Tavares (exemplo)", "manager"], ["Carla Nunes (exemplo)", "member"], ["Diego Prado (exemplo)", "finance"]];
const membros = [dona.id];
for (const [nome, papel] of equipe) {
  const id = crypto.randomUUID(); const usuario = `demo-${nome.split(" ")[0].toLowerCase()}`; const email = `${nome.split(" ")[0].toLowerCase()}@escritoriomodelo.example`;
  await db.execute({ sql: "INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)", args: [usuario, email, nome, Date.now(), Date.now()] });
  await db.execute({ sql: "INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,?,?)", args: [id, organization.id, usuario, nome, email, papel, JSON.stringify(sessao.member.permissions)] });
  membros.push(id);
}
const [ana, bruno, carla] = membros;

// ── clientes, projetos e tarefas ────────────────────────────────────────────────────
const clientes = [];
for (const c of [
  { name: "Família Andrade (exemplo)", email: "andrade@cliente.example", phone: "(11) 90000-0001" },
  { name: "Marina Moreira (exemplo)", email: "marina@cliente.example", phone: "(11) 90000-0002" },
  { name: "Clínica Bem Viver Ltda. (exemplo)", email: "contato@bemviver.example", phone: "(11) 3000-0003", document: "00.000.000/0001-00" },
  { name: "Loja Conceito Centro Ltda. (exemplo)", email: "obras@lojaconceito.example", phone: "(11) 3000-0004" },
  { name: "Roberto Sales (exemplo)", email: "roberto@cliente.example", phone: "(11) 90000-0005" },
]) clientes.push((await api("POST", "/api/clients", c)).client);

const projetos = [];
for (const p of [
  { clientId: clientes[0].id, code: "OBR-014", name: "Casa Jardim das Acácias", kind: "work", phase: "Alvenaria e instalações", progressPercent: 46, ownerMemberId: carla, startDate: dia(-120), targetDate: dia(130), budgetCents: 68_400_000 },
  { clientId: clientes[1].id, code: "PRJ-017", name: "Apartamento Vista Parque", kind: "project", phase: "Projeto executivo", progressPercent: 72, ownerMemberId: bruno, startDate: dia(-60), targetDate: dia(36), budgetCents: 4_200_000 },
  { clientId: clientes[2].id, code: "OBR-019", name: "Consultório Bem Viver", kind: "work", phase: "Acabamentos", progressPercent: 88, ownerMemberId: carla, startDate: dia(-150), targetDate: dia(18), budgetCents: 21_900_000 },
  { clientId: clientes[3].id, code: "PRJ-021", name: "Loja Conceito Centro", kind: "project", phase: "Estudo preliminar", progressPercent: 18, ownerMemberId: ana, startDate: dia(-12), targetDate: dia(78), budgetCents: 3_600_000 },
]) projetos.push((await api("POST", "/api/projects", p)).project);
const [casa, apto, clinica, loja] = projetos;

const tarefas = [];
for (const t of [
  { projectId: clinica.id, title: "Aprovar amostra do porcelanato com o cliente", priority: "high", assigneeMemberId: ana, startsAt: hora(-4), dueAt: hora(-1), estimatedMinutes: 60 },
  { projectId: apto.id, title: "Enviar revisão 3 do projeto elétrico", priority: "high", status: "in_progress", assigneeMemberId: bruno, startsAt: hora(-3), dueAt: hora(0, 20), estimatedMinutes: 240 },
  { projectId: casa.id, title: "Conferir medição da alvenaria do térreo", assigneeMemberId: carla, startsAt: hora(-1), dueAt: hora(0, 21), estimatedMinutes: 120 },
  { projectId: casa.id, title: "Cotar esquadrias com três fornecedores", assigneeMemberId: bruno, startsAt: hora(0), dueAt: hora(2), estimatedMinutes: 180 },
  { projectId: loja.id, title: "Montar prancha de layout para a reunião", assigneeMemberId: ana, startsAt: hora(1), dueAt: hora(3), estimatedMinutes: 300 },
  { projectId: casa.id, title: "Liberar concretagem da laje", priority: "critical", status: "blocked", assigneeMemberId: carla, startsAt: hora(2), dueAt: hora(6), estimatedMinutes: 90, description: "Aguardando laudo do ensaio de corpo de prova." },
  { projectId: apto.id, title: "Compatibilizar hidráulica com estrutura", status: "in_progress", assigneeMemberId: bruno, startsAt: hora(-6), dueAt: hora(8), estimatedMinutes: 480 },
  { projectId: clinica.id, title: "Vistoria final com o cliente", assigneeMemberId: ana, startsAt: hora(12), dueAt: hora(14), estimatedMinutes: 120 },
  { projectId: clinica.id, title: "Registrar diário de obra com fotos", status: "done", assigneeMemberId: carla, startsAt: hora(-3), dueAt: hora(-2), estimatedMinutes: 30 },
  { projectId: loja.id, title: "Levantamento do imóvel", status: "done", assigneeMemberId: bruno, startsAt: hora(-10), dueAt: hora(-8), estimatedMinutes: 240 },
]) tarefas.push((await api("POST", "/api/tasks", t)).task);

// ── comercial ──────────────────────────────────────────────────────────────────────
for (const o of [
  { clientId: clientes[4].id, title: "Reforma de cobertura", stage: "new", estimatedValueCents: 18_500_000, probabilityPercent: 20, ownerMemberId: ana, nextAction: "Ligar para marcar visita técnica", nextActionAt: hora(1) },
  { clientId: clientes[3].id, title: "Projeto de interiores do escritório", stage: "proposal", estimatedValueCents: 6_800_000, probabilityPercent: 55, ownerMemberId: bruno, nextAction: "Confirmar recebimento da proposta", nextActionAt: hora(-1) },
  { clientId: clientes[1].id, title: "Casa de campo 240 m²", stage: "negotiation", estimatedValueCents: 92_000_000, probabilityPercent: 70, ownerMemberId: ana, nextAction: "Enviar cronograma revisado", nextActionAt: hora(2) },
  { clientId: clientes[2].id, title: "Retrofit de fachada", stage: "proposal", estimatedValueCents: 31_000_000, probabilityPercent: 40, ownerMemberId: bruno, nextAction: "Agendar apresentação", nextActionAt: hora(4) },
]) await api("POST", "/api/crm", o).catch(async (erro) => { if (!/stage/i.test(erro.message)) throw erro; await api("POST", "/api/crm", { ...o, stage: "new" }); });

for (const item of [
  { code: "ALV-01", description: "Alvenaria de vedação em bloco cerâmico", category: "Alvenaria", unit: "m²", unitCostCents: 9_850, defaultUnitPriceCents: 12_800 },
  { code: "PIS-02", description: "Contrapiso em argamassa, 4 cm", category: "Pisos", unit: "m²", unitCostCents: 4_620, defaultUnitPriceCents: 6_000 },
  { code: "PIS-07", description: "Porcelanato 80×80 assentado", category: "Pisos", unit: "m²", unitCostCents: 18_900, defaultUnitPriceCents: 24_600 },
  { code: "ELE-11", description: "Ponto de tomada completo", category: "Elétrica", unit: "un", unitCostCents: 14_300, defaultUnitPriceCents: 18_600 },
  { code: "PIN-03", description: "Pintura acrílica, duas demãos", category: "Pintura", unit: "m²", unitCostCents: 3_240, defaultUnitPriceCents: 4_200 },
]) await api("POST", "/api/budget-library", item);
const orcamento = (await api("POST", "/api/budgets", { projectId: casa.id, code: "ORC-014", bdiPercent: 25, marginPercent: 12 })).budget;
await api("POST", `/api/budgets/${orcamento.id}/items`, { items: [
  { code: "ALV-01", description: "Alvenaria de vedação em bloco cerâmico", unit: "m²", quantity: 186, unitCostCents: 9_850, source: "library" },
  { code: "PIS-02", description: "Contrapiso em argamassa, 4 cm", unit: "m²", quantity: 142, unitCostCents: 4_620, source: "library" },
  { code: "PIS-07", description: "Porcelanato 80×80 assentado", unit: "m²", quantity: 118, unitCostCents: 18_900, source: "library" },
  { code: "ELE-11", description: "Ponto de tomada completo", unit: "un", quantity: 64, unitCostCents: 14_300, source: "library" },
  { code: "PIN-03", description: "Pintura acrílica, duas demãos", unit: "m²", quantity: 410, unitCostCents: 3_240, source: "library" },
] });
const orcamento2 = (await api("POST", "/api/budgets", { projectId: apto.id, code: "ORC-017", bdiPercent: 0, marginPercent: 30 })).budget;
await api("POST", `/api/budgets/${orcamento2.id}/items`, { items: [
  { description: "Projeto executivo de arquitetura", unit: "vb", quantity: 1, unitCostCents: 1_400_000, unitPriceCents: 2_600_000 },
  { description: "Acompanhamento de obra", unit: "visita", quantity: 8, unitCostCents: 20_000, unitPriceCents: 45_000 },
] });
const proposta = (await api("POST", "/api/proposals", { title: "Projeto Apartamento Vista Parque", budgetVersionId: orcamento2.id })).proposal;
await api("POST", "/api/proposals", { title: "Reforma de cobertura — estudo inicial", clientId: clientes[4].id });

// ── desenho, layout, conversa, diário, metas e planilha ─────────────────────────────
const prancha = (await api("POST", "/api/studio", { nome: "Planta de exemplo — térreo", especie: "planta", projectId: casa.id })).prancha;
const layout = (await api("POST", "/api/layouts", { name: "Casa térrea com garagem", projectId: casa.id, modelo: "casa-garagem" })).layout;
const layout2 = (await api("POST", "/api/layouts", { name: "Apartamento compacto", projectId: apto.id, modelo: "apartamento" })).layout;
const conversas = await api("GET", "/api/conversas");
const geral = (conversas.channels ?? conversas.conversations ?? []).find((c) => /geral/i.test(c.name ?? "")) ?? (conversas.channels ?? conversas.conversations)[0];
for (const texto of ["Bom dia! A medição da alvenaria da Casa Jardim das Acácias fecha hoje.", "A prancha de layout da Loja Conceito fica pronta amanhã cedo."]) {
  await api("POST", `/api/conversas/${geral.id}/mensagens`, { clientKey: crypto.randomUUID(), body: texto });
}
await api("POST", "/api/diary", { id: crypto.randomUUID(), projectId: casa.id, entryDate: dia(-1), weather: "clear", workforceCount: 9, summary: "Alvenaria do térreo concluída no eixo B. Início das tubulações elétricas embutidas.", blockers: "", occurrenceType: "none" });
await api("POST", "/api/diary", { id: crypto.randomUUID(), projectId: clinica.id, entryDate: dia(-2), weather: "rain", workforceCount: 5, summary: "Assentamento do porcelanato na recepção. Pintura interrompida à tarde.", blockers: "Chuva forte impediu a pintura externa.", occurrenceType: "weather" });
await api("POST", "/api/goals", { name: "Tarefas concluídas no mês", metric: "tasks_done", targetValue: 20, periodStart: dia(-12), periodEnd: dia(18), ownerMemberId: null });
const planilha = (await api("POST", "/api/worksheets", { name: "Orçamento de obra — exemplo", templateId: "orcamento-obra" })).worksheet;

// ── leitura: tudo que a interface pede ao abrir cada módulo ─────────────────────────
const leituras = [
  "/api/session", "/api/health", "/api/clients", "/api/projects", "/api/tasks", "/api/schedule", "/api/members", "/api/reminders", "/api/goals",
  "/api/crm", "/api/budgets", "/api/budget-library", `/api/budgets/${orcamento.id}/items`, `/api/budgets/${orcamento2.id}/items`,
  "/api/proposals", `/api/proposals/${proposta.id}`, "/api/studio", `/api/studio/${prancha.id}`, "/api/studio/assets",
  "/api/layouts", `/api/layouts/${layout.id}`, `/api/layouts/${layout2.id}`, "/api/conversas", `/api/conversas/${geral.id}/mensagens`,
  "/api/diary", "/api/diary/projects", "/api/files", "/api/arquivos", "/api/usage", "/api/worksheets", `/api/worksheets/${planilha.id}`, "/api/worksheets/data",
  "/api/portal-management/access", "/api/portal-management/items", "/api/organization-invitations",
  "/api/integrations/drap/connection", "/api/integrations/drap/summary", "/api/integrations/drap/capabilities", "/api/integrations/drap/charges", "/api/integrations/drap/lancamentos",
  "/api/integrations/drap/readiness", "/api/integrations/drap/catalog", "/api/integrations/drap/activation", "/api/integrations/sinapi/reference",
  ...projetos.map((p) => `/api/projects/${p.id}`),
];
const respostas = {};
for (const caminho of leituras) {
  const resposta = await fetch(base + caminho, { headers: cabecalhos });
  let corpo; try { corpo = await resposta.json(); } catch { corpo = {}; }
  respostas[caminho] = { status: resposta.status, body: corpo };
  console.log(resposta.status, caminho);
}
await writeFile(new URL("../lib/demonstracao/respostas.json", import.meta.url), JSON.stringify({ geradoEm: new Date().toISOString(), respostas }, null, 1) + "\n");
console.log("lib/demonstracao/respostas.json gravado");
