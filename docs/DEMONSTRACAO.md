# Demonstração pública e pedido de reunião

Quem chega sem conta precisa entender a plataforma antes de falar com alguém. O caminho é
um só: **testar → pedir reunião → implantar**.

## Rotas

| Rota | Quem vê | O que faz |
| --- | --- | --- |
| `/` | Visitante sem sessão | Apresentação, quatro testes e o pedido de reunião. **Entrar** abre o formulário de sempre. Sessão vencida continua indo direto ao formulário. |
| `/demonstracao?area=painel\|cad\|layout\|documentos` | Qualquer pessoa | As ferramentas em modo de demonstração. |
| `/agendar?origem=…` | Qualquer pessoa | Formulário do pedido de reunião. |
| `/superadmin` → Pedidos de reunião | Superadministrador | Fila dos pedidos, com andamento. |

## O que é fictício e onde fica

O produto proíbe dado inventado no runtime. A demonstração é a única exceção, e ela é
estreita de propósito:

- o dado fictício mora só em `lib/demonstracao/dados.ts` (empresa, tarefas, funil,
  projetos, orçamento e a planta de exemplo do CAD);
- só `components/visitante/demonstracao-app.tsx` e `painel-exemplo.tsx` importam dali;
- tudo vive na memória da aba: fechar a aba descarta;
- nenhuma tela da demonstração chama a API; nenhuma rota de API conhece a demonstração;
- a faixa do topo diz o tempo todo “Demonstração. Dados fictícios; nada é salvo.”

`tests/demonstracao.test.mjs` falha se outro módulo importar esses dados ou se uma tela da
demonstração passar a fazer chamada de rede.

## Ferramentas em modo de demonstração

O Editor CAD (`PranchetaEditor`) e o Criador de layout (`LayoutEditor`) recebem a
propriedade `demonstracao`. Com ela:

- **salvar não grava**: a função sai antes do pedido ao servidor e a tela abre o aviso
  “Na demonstração nada é salvo”, com **Agendar reunião** e **Continuar testando**;
- exportações (DXF, SVG, PNG, NEXO, imagem 3D, planta e prancha em PDF) são baixadas no
  navegador, sem ir para a biblioteca;
- o CAD não lê DWG/DXF (a leitura é no servidor) e diz isso em vez de falhar;
- Documentos e PDF já roda no navegador; na demonstração some o botão “Da biblioteca”,
  porque não existe biblioteca para abrir.

Sem a propriedade, os dois editores se comportam exatamente como antes.

## Pedido de reunião

`POST /api/reunioes` é a única escrita pública sem link assinado. Barreiras, todas no
servidor:

- validação Zod (`lib/reunioes.ts`, o mesmo esquema do formulário), corpo estrito;
- dia preferido de segunda a sexta, de amanhã até 60 dias, no fuso de Brasília;
- origem do próprio site (`rejectCrossSiteMutation`);
- campo-isca: robô que o preenche recebe sucesso e nada é gravado;
- no máximo 5 pedidos por IP por hora (IP guardado só como hash) e 200 no total por hora;
- reenvio do mesmo e-mail, dia e período ainda em “Novo” não duplica.

A tela de sucesso diz que o pedido foi **recebido** e que o horário **ainda não está
confirmado**: a reunião só existe quando alguém da plataforma combina a data. Não há
envio automático de e-mail nem integração com agenda; o contato é feito a partir da fila
do superadministrador, que marca cada pedido como *Novo*, *Contato feito* ou *Encerrado*.

A tabela `meeting_requests` não tem `organization_id`: quem pede ainda não é cliente.
Publicar esta versão exige **Atualizar banco de dados** em `/superadmin` (migração
`0027`); até lá o formulário responde que não foi possível registrar o pedido.
