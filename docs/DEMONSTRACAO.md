# Demonstração pública e pedido de reunião ou proposta

Quem chega sem conta precisa ver a plataforma funcionando antes de falar com alguém. O
caminho é um só: **testar → pedir reunião ou proposta → implantar**.

## Rotas

| Rota | Quem vê | O que faz |
| --- | --- | --- |
| `/` | Visitante sem sessão | Apresentação, atalhos de teste e o pedido de reunião. **Entrar** abre o formulário de sempre. |
| `/demonstracao` | Qualquer pessoa | A área de trabalho real, com a empresa fictícia. `?module=studio`, `layout`, `documentos`… abre direto num módulo. |
| `/demonstracao/projetos/[id]` | Qualquer pessoa | A central do projeto ou da obra, dentro da demonstração. |
| `/demonstracao/prancheta/[id]` | Qualquer pessoa | O Editor CAD em página inteira. |
| `/agendar?tipo=proposta&origem=…` | Qualquer pessoa | Pedido de reunião ou de envio de proposta. |
| `/superadmin` → Pedidos de reunião e de proposta | Superadministrador | Fila dos pedidos, com andamento. |

## A demonstração é a plataforma real

Não existe uma "tela de demonstração" paralela: `/demonstracao` monta o mesmo `NexoApp`
dos clientes. A diferença está em quem responde aos pedidos de dados.

Enquanto a moldura `components/visitante/demonstracao-app.tsx` está na tela, todo pedido
`/api/...` da página é respondido por `lib/demonstracao/servidor.ts`, **dentro do
navegador do visitante**. Só `/api/reunioes` passa para o servidor de verdade.

- **Dados fictícios**: `lib/demonstracao/respostas.json` guarda as respostas reais da API
  para uma empresa inventada. Como saíram da própria API, têm sempre o formato certo. As
  datas são trazidas para hoje a cada abertura, então "atrasada" e "vence amanhã"
  continuam fazendo sentido.
- **Edições**: criar, editar e concluir funcionam em clientes, projetos, tarefas, funil
  (incluindo converter em projeto), orçamentos e itens, layouts, pranchas do CAD e
  mensagens. Elas mudam só o estado guardado na aba (`sessionStorage`): seguem valendo
  quando a pessoa abre a central do projeto ou a prancha, e somem ao fechar a aba ou em
  **Recomeçar**. Nada vai ao banco.
- **O que não é emulado é recusado**, com o aviso “Na demonstração esta ação não é
  executada. Ela funciona na conta da sua empresa.” Vale para convites, envio de arquivo,
  propostas novas, planilhas, diário, cobrança, nota fiscal e lançamento financeiro. O
  Financeiro mostra números fictícios só para leitura: na demonstração nada pode parecer
  emitido ou cobrado.
- **Navegação**: na plataforma, projeto e prancha abrem em páginas próprias (a prancha, em
  outra aba). Na demonstração os mesmos links são levados para `/demonstracao/...`, na
  mesma aba, onde o estado de exemplo existe.
- **Faixa fixa**: “Demonstração. Dados fictícios. O que você editar vale só nesta aba e não
  é salvo.”, com **Recomeçar**, **Pedir proposta** e **Agendar reunião**.

`tests/demonstracao.test.mjs` falha se outro módulo importar `lib/demonstracao/`, se uma
rota de API conhecer a demonstração, se o formato dos dados fictícios divergir do
capturado ou se uma ação não emulada responder sucesso.

### Regerar os dados fictícios

Quando a API mudar de formato, gere de novo — com um banco **local e vazio**, já migrado:

```bash
DATABASE_URL=file:/tmp/demo.db TRUST_IDENTITY_HEADERS=true SESSION_SECRET=um-segredo-local-com-32-caracteres npm run dev
```

```bash
npm run demo:gerar -- http://localhost:3000 file:/tmp/demo.db
```

O roteiro cadastra a empresa pela própria API e grava `respostas.json`. Ele se recusa a
rodar contra banco que não seja um arquivo local.

## Pedido de reunião ou de proposta

`POST /api/reunioes` é a única escrita pública sem link assinado. Barreiras, todas no
servidor:

- validação Zod (`lib/reunioes.ts`, o mesmo esquema do formulário), corpo estrito;
- `kind`: `meeting` exige dia (segunda a sexta, de amanhã até 60 dias, fuso de Brasília)
  e período; `proposal` não tem data — os dois campos ficam vazios, nunca inventados;
- origem do próprio site (`rejectCrossSiteMutation`);
- campo-isca: robô que o preenche recebe sucesso e nada é gravado;
- no máximo 5 pedidos por IP por hora (IP guardado só como hash) e 200 no total por hora;
- reenvio do mesmo pedido ainda em “Novo” não duplica.

A tela de sucesso diz que o pedido foi **recebido**: o horário ainda não está confirmado
e a proposta ainda não tem valor. Não há envio automático de e-mail nem integração com
agenda; o contato é feito a partir da fila do superadministrador, que marca cada pedido
como *Novo*, *Contato feito* ou *Encerrado*.

A tabela `meeting_requests` não tem `organization_id`: quem pede ainda não é cliente.
Publicar esta versão exige **Atualizar banco de dados** em `/superadmin` (migrações
`0027` e `0028`); até lá o formulário responde que não foi possível registrar o pedido.
