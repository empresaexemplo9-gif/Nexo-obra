# Homologação da credencial DRAP

Atualizado em 2026-09-17.

Roteiro pra provar, com uma chave real, que a H.OIKOS consegue operar o
financeiro de uma empresa na DRAP sem pedir um segundo login ao usuário e sem
enxergar dado de outra empresa.

Enquanto este roteiro não passar, a integração não sai de `DRAP_TENANTS_JSON`
de teste.

## O que já está provado e o que falta

A chave da DRAP resolve o tenant **no servidor dela**, a partir do hash da
própria chave. A H.OIKOS nunca envia `organization_id`, `company_id` ou
qualquer identificador de empresa — não há o que forjar pelo navegador. É isso
que sustenta "acesso restrito ao tenant correto".

O que a chave **não** resolve: emitir a própria chave. Isso exige uma sessão
humana de admin na DRAP, uma vez por empresa. Zero login no cadastro depende do
contrato service-to-service descrito em [`DRAP-ACTIVATION.md`](./DRAP-ACTIVATION.md),
que ainda não existe.

## Pré-requisitos

1. **Tenant de teste na DRAP** — empresa descartável, não a do cliente. A fase
   de escrita grava um lançamento de R$ 0,01.
2. **Módulo Integrações ativo** nesse tenant. Sem ele a DRAP recusa criar
   chave (`403 module-required`).
3. **Chave emitida** em `Configurações → Integrações`, com o preset
   **Leitura e escrita**. Não use *Acesso total*: a H.OIKOS não apaga
   lançamento nem parceiro, e o roteiro confere isso.

A chave aparece em texto puro uma única vez. Guarde no gerenciador de segredos
do ambiente, nunca no repositório e nunca em variável `NEXT_PUBLIC_*`.

## Rodar

```bash
# só leitura — não escreve nada
DRAP_API_TOKEN=drap_live_... node scripts/homologar-drap.mjs

# inclui criar e editar um lançamento de R$ 0,01
DRAP_API_TOKEN=drap_live_... node scripts/homologar-drap.mjs --escrita
```

Aceita `DRAP_API_URL` (default `https://empresa.drap.app.br`) e
`DRAP_API_KEY_HEADER`, os mesmos nomes que o adaptador lê em produção. A chave
nunca é impressa, nem em erro.

Sai `0` quando tudo que é obrigatório passou, `1` quando algo que a H.OIKOS
depende está quebrado. Aviso não derruba a homologação — é trabalho conhecido
de outra fatia.

## Como ler o resultado

| Verificação | Falhou? Então |
| --- | --- |
| Autenticação | Chave inválida, revogada ou vencida. Reemita. |
| Rota fechada sem chave | **Pare.** A API da DRAP está aceitando chamada anônima. |
| Envelope `{ items, total }` | O contrato mudou. O adaptador desempacota esses nomes. |
| Campos do lançamento | Falta campo que a H.OIKOS lê. Ajuste `lib/integrations/drap.ts`. |
| Parceiros / Categorias | A chave não cobre o recurso, ou o endpoint mudou. |

Dois avisos são esperados hoje, e são exatamente a fatia 2:

- **Vínculo de obra** — a DRAP devolve `centro_custo` (texto livre) e o
  adaptador procura `costCenterId`. Enquanto os nomes não baterem, o financeiro
  por obra volta vazio **sem erro nenhum**, que é o pior jeito de falhar.
- **Filtro `?centro_custo`** — a DRAP ignora o parâmetro, então a H.OIKOS
  pagina a empresa inteira e filtra na memória. Funciona com pouca coisa
  cadastrada; trunca em 500 lançamentos.

Um aviso **não** esperado:

- **Escopo de exclusão: 404** significa que a chave apaga lançamento. Reemita
  com o preset certo.

## Fora desta fatia

Resumo financeiro no servidor, cobranças, assinatura de webhook por API e
provisionamento de empresa sem login humano. Estado e contrato pretendido em
[`DRAP-ACTIVATION.md`](./DRAP-ACTIVATION.md) e [`DRAP-INTEGRATION.md`](./DRAP-INTEGRATION.md).
