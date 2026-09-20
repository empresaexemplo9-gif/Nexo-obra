# Tempo de uso

Cada acesso da plataforma tem o tempo online medido por dia: contratante, equipe,
parceiro, prestador, contabilidade, cliente do portal, administrador de manutenção e o
próprio superadministrador.

## Como o tempo é medido

O navegador envia um sinal a cada 30 segundos enquanto a aba está **visível**. Minimizar
a janela ou trocar de aba pausa o envio.

O servidor nunca aceita duração vinda do navegador. Ele credita apenas o intervalo entre
dois sinais que ele mesmo observou, medido com o relógio do servidor, e no máximo 90
segundos por intervalo. Na prática:

- fechar a aba, perder a rede ou desligar o computador **para** a contagem no último
  sinal recebido: o total nunca é inflado;
- um intervalo maior que 90 segundos encerra a sessão anterior no último sinal e abre
  outra, sem creditar o tempo ausente;
- duas abas ou dois aparelhos do mesmo acesso **não** somam em dobro: a contagem é tempo
  de relógio, não soma de janelas;
- dois sinais que cheguem juntos creditam uma vez só. A escrita compara e grava na mesma
  instrução, e o crédito no dia depende dessa comparação ter valido;
- um intervalo que atravessa a meia-noite é dividido na proporção exata entre os dois
  dias, no fuso da empresa.

### O erro possível, declarado

Nenhum contador de navegador pode prometer zero de erro, e este não promete. O que ele
garante é um erro **limitado e sempre para menos**: o trecho entre o último sinal e o
fechamento da aba não é contado, no máximo 30 segundos por sessão. Nada é estimado,
arredondado para cima ou preenchido por suposição.

Tudo fica auditável: `usage_sessions` guarda cada sessão com início, último sinal, fim e
o total creditado; `usage_days` guarda o total por dia. Qualquer número da tela pode ser
reconferido a partir dessas linhas.

## Quem vê o quê

| Acesso | Alcance |
| --- | --- |
| Colaborador, parceiro, prestador, gestor, contabilidade, cliente do portal | apenas o próprio histórico |
| Contratante (`owner`) e administrador (`admin`) | o próprio e todos os acessos da empresa aberta |
| Financeiro (`finance`) e RH (`hr`) | o próprio e os dependentes da empresa aberta: gestor, colaborador, parceiro, prestador, contabilidade e cliente do portal. Não veem o contratante, administradores nem outros acessos de Financeiro/RH. |
| Superadministrador | todos os acessos de todas as empresas, incluindo o próprio |

A regra é aplicada no servidor. Pedir `organizationId` de outra empresa sem ser
superadministrador responde `403`. Um `subjectId` fora da hierarquia de Financeiro/RH
não retorna registros. O cargo atual também é conferido para não expor o histórico de
quem foi promovido.

## Ações

Além do tempo, a tela mostra quantas ações cada acesso registrou no período. Esse número
vem da trilha de auditoria (`audit_events`), que já é a fonte oficial de quem escreveu o
quê, em qual empresa e em qual registro — sem criar uma segunda verdade. Os limites do
período são a meia-noite local do primeiro dia e o fim do último, no fuso da empresa
aberta.

## API

| Método | Rota | Uso |
| --- | --- | --- |
| `POST` | `/api/usage` | Sinal de presença. Corpo vazio, ou `{ "accessId": "<uuid>" }` no portal do cliente. Empresa e identidade vêm do servidor. |
| `GET` | `/api/usage?from=&to=&organizationId=&subjectId=` | Relatório por dia, já filtrado pelo alcance de quem pediu. |

O corpo do sinal é validado com `strict()`: qualquer campo desconhecido — inclusive uma
tentativa de informar empresa, pessoa ou duração — é recusado com `400`.
