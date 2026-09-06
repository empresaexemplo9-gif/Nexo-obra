# Instruções para o Claude Code

Leia este arquivo e o `README.md` inteiro antes de alterar o projeto.

## Missão

Construir um SaaS simples e confiável para arquitetura e construção civil. O produto deve reduzir tempo de cadastro, retrabalho, troca de contexto e procura por informação. “Completo” significa cobrir o fluxo inteiro; não significa colocar todas as informações em todas as telas.

## Regras que não podem ser quebradas

1. Preserve o modelo multiempresa. Toda query de dados de negócio deve filtrar a organização resolvida pela sessão no servidor.
2. Nunca confie em `organization_id`, papel, preço, margem ou permissão vindos do navegador.
3. A Drap é a fonte oficial dos dados financeiros. Não replique saldo ou lançamentos como segunda verdade.
4. Nunca importe o cliente Drap em componente React cliente e nunca exponha token em variável `NEXT_PUBLIC_*`.
5. Trate toda escrita financeira como operação distribuída: idempotency key, timeout, retry seguro e reconciliação.
6. Não reescreva o projeto inteiro para concluir uma tarefa. Faça uma fatia vertical pequena e verificável.
7. Use as primitivas existentes em `components/ui` para controles com equivalente direto.
8. Não adicione dependência sem explicar no resumo final por que a plataforma atual não resolve o caso.
9. Texto visível deve ser português do Brasil, curto e específico.
10. Não crie card, menu, gráfico ou filtro sem uma pergunta real que ele responda.

## Regra de interface

Cada tela precisa ter:

- uma tarefa principal clara;
- a informação mínima para executá-la;
- estados de carregamento, vazio, erro e sucesso;
- boa leitura em 320 px e em desktop;
- controles com label acessível e navegação por teclado;
- números monetários em centavos no banco e formatados apenas na borda da interface.

Evite:

- dashboards cheios de indicadores sem ação;
- formulários longos de uma só vez;
- modais dentro de modais;
- repetir cliente, projeto e status em várias hierarquias;
- esconder ações básicas em menus de três pontos;
- salvar silenciosamente após erro de rede.

## Sequência de trabalho

Para cada fatia:

1. Descreva em uma frase o comportamento que será entregue.
2. Identifique o dono do dado e a regra de autorização.
3. Altere schema/migração, API e interface na mesma fatia quando aplicável.
4. Valide entradas com Zod na borda do servidor.
5. Adicione pelo menos um teste do caminho feliz e um de permissão/erro para regras críticas.
6. Execute `npm run build`.
7. Se o schema mudou, execute `npm run db:generate` e inspecione o SQL.
8. Atualize a seção correspondente do README quando o estado do produto mudar.

## Prioridade atual

1. Ampliar CRM, orçamento e obra usando somente dados persistentes.
2. Implementar convites e administração de membros por empresa.
3. Preparar planos, limites e cobrança para monetização.
4. Homologar a integração Drap antes de liberar operações financeiras.

## Integração Drap

O código atual é um adaptador de referência, porque os endpoints públicos não estão documentados no briefing. Antes de conectar:

- peça ou leia a especificação OpenAPI oficial;
- crie testes de contrato com payloads anonimizados reais;
- mapeie IDs de empresa, cliente, projeto/centro de custo e cobrança;
- mantenha os nomes remotos dentro de `lib/integrations/drap.ts`;
- não espalhe formato Drap pelo restante do domínio;
- registre eventos recebidos antes de processar;
- aceite o mesmo evento mais de uma vez sem duplicar efeito;
- mostre falha de sincronização sem substituir dados reais por dados de demonstração em produção.

Em produção, fallback demonstrativo deve ficar desativado por configuração. Uma falha remota deve mostrar o último snapshot conhecido, o horário e um estado de indisponibilidade.

## Definição de pronto para uma funcionalidade

- regra de negócio no servidor;
- autorização multiempresa;
- persistência real;
- validação e mensagens úteis;
- carregamento, vazio, erro e sucesso;
- uso móvel aceitável;
- auditoria quando houver efeito relevante;
- build sem erro;
- documentação curta atualizada.
