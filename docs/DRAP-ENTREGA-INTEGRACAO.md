# Integração Drap: entrega do lado H.OIKOS

## Responsabilidades e estado

A Drap desenvolve a H.OIKOS para venda à adquirente e fornece os próprios módulos de gestão. A operadora H.OIKOS, suas contas de infraestrutura e seus canais definitivos devem ser identificados na entrega. O responsável pediu aguardar a Drap concluir a vinculação. Este documento não autoriza criar empresas, cobrar, emitir notas ou cancelar serviços em produção.

O lado H.OIKOS possui adaptadores, isolamento, seleção de módulos e diagnóstico. Isso não comprova homologação de todas as funções comerciais. Concluir a vinculação de uma chave não cria automaticamente APIs que ainda não tenham contrato acordado.

## Caminho de validação no produto

1. Administrador da empresa abre Soluções Drap. A criação/vinculação embutida usa o parceiro configurado; um ID de empresa digitado não prova autorização.
2. A chave devolvida pelo parceiro é cifrada e associada à organização. Repetições preservam a chave da mesma empresa; troca de empresa não herda segredos anteriores. Tokens não são retornados ao navegador.
3. O quadro Preparação da integração apresenta configuração, conta, credencial, webhook e assinatura. Atualizar configuração não realiza chamada externa. Consultar API Drap usa somente GET para identificar as rotas realmente acessíveis à credencial da empresa.
4. Seleção de módulos grava intenção, sem fatura ou ativação fictícia. A oferta empresarial aplica a política definida exclusivamente pelo superadministrador. O preço mínimo é o oficial Drap; acréscimo zero é permitido.
5. O adaptador de contratação congela a política por solicitação e aguarda confirmação HMAC. Ele não aceita total arbitrário, troca de plano congelado ou produto divergente. Assinatura não ativa por um simples HTTP 200 do envio.
6. Eventos operacionais são validados e encaminhados ao tenant correto. Falhas ficam consultáveis e podem ser reprocessadas pelo fluxo autorizado. Cobranças de clientes e assinatura dos módulos são objetos diferentes e não devem ser confundidos.

## Matriz de entrega e dependências

| Fluxo | Lado H.OIKOS | Evidência externa ainda necessária |
| --- | --- | --- |
| Criação ou vínculo de empresa | API de parceiro, código de vínculo, idempotência e cifra | Contrato parceiro e execução com tenant de homologação |
| Leitura financeira | Resumo e lançamentos com paginação, centro de custo e indicação de parcialidade | Credencial, escopos e retorno real da empresa |
| Lançamentos, parceiros, categorias | Rotas e formulários operacionais com permissões | Validação do vocabulário e escopos do ambiente final |
| Cobranças de clientes | Idempotência, valor em centavos convertido na borda, erros da fonte | Módulo ativo, conta de pagamento e cliente válido na Drap |
| Webhook operacional | HMAC, janela temporal, tenant por segredo, deduplicação e reprocessamento | Registro remoto, entrega assinada, repetição e evento fora de ordem |
| Catálogo e preço | Preço-base mínimo, acréscimo opcional exclusivo e oferta calculada no servidor | Atualização oficial de preços e IDs reconhecidos na contratação |
| Seleção de módulos | Persistência por organização sem cobrança | Contrato de cesta, composição de pacotes e tratamento de sobreposição |
| Assinatura | Adaptador de uma assinatura por organização e callback autenticado | Endpoint homologado, concordância do cliente, checkout e confirmação real |
| Alterações, cancelamento e estorno | Não liberados por proxy genérico | Contratos de operação, autorização, idempotência e efeitos em cada módulo |
| Comissões | Política, preço congelado e comissão mensal em histórico | Eventos de fatura paga/estornada e regras do acerto; não há saldo liquidado fictício |
| NFS-e | Descoberta/leitura de recurso, sem emissão pelo proxy genérico | Endpoint fiscal, campos por município, autorização, certificados e homologação |
| Demais módulos Drap | Descoberta das rotas permitidas; catálogo não equivale a implementação integral | Contrato por função de dashboards, bancos, fluxo, IA, WhatsApp, fiscal e Retaguarda |

## Contratos e configuração para a Drap concluir

- Operação de parceiro existente: `POST /api/partner/v1/empresas` com referência externa da organização e escopos; vínculo por código no adaptador `lib/integrations/drap-partner.ts`. Não trocar o ID da organização por entrada livre do navegador.
- API operacional: base HTTPS oficial, credencial por tenant e recursos da allowlist em `lib/server/drap-resources.ts`. Resposta 403 indica falta de acesso; 404 indica recurso ausente; 429 deve preservar Retry-After. Uma rota identificada não comprova sucesso de escrita.
- Destino de eventos H.OIKOS: `/api/integrations/drap/webhook`, calculado a partir do domínio público configurado, não do cabeçalho Host do navegador.
- Ativação: `DRAP_ACTIVATION_URL`, `DRAP_ACTIVATION_TOKEN` e `DRAP_ACTIVATION_WEBHOOK_SECRET`; formato atual em `DRAP-ACTIVATION.md`. Receptor `/api/integrations/drap/activation`. A URL de contratação não foi inventada nem configurada durante esta entrega.
- Criptografia: `SECRETS_ENCRYPTION_KEY` de 32 bytes em base64. Chave de parceiro e cifra são somente servidor. Não fornecer valores em chat ou commit.
- Legado: `DRAP_API_TOKEN` só é aceito quando `DRAP_LEGACY_COMPANY_ID` corresponde exatamente à empresa. Instalação multiempresa deve usar provisionamento com credenciais cifradas ou `DRAP_TENANTS_JSON` individualizado. Uma chave global não pode operar qualquer identificador.
- Confirmar esquema para múltiplos módulos, atualização de plano, checkout, cancelamento, faturas, estornos e comissões. O adaptador atual de assinatura única não deve ser anunciado como cesta completa sem essa adaptação.

## Critérios para afirmar integração concluída

Em ambiente de homologação separado, validar dois tenants reais autorizados: criação/repetição, vínculos negados, conta errada, revogação de chave, cada escopo e módulo contratado, assinatura sem e com acréscimo, mínimo obrigatório, retorno de checkout, falha após efeito remoto, repetição, suspensão/cancelamento, fatura paga/estornada e conciliação de comissão. Confirmar que nenhuma operação atravessa empresas e que a indisponibilidade Drap não bloqueia módulos H.OIKOS independentes.

O roteiro operacional de leitura já existe em `scripts/homologar-drap.mjs`; a modalidade de escrita deve ser usada somente no tenant autorizado para testes. Não usar dados fictícios na conta de produção de um cliente. A conclusão exige evidências dos testes conjuntos, não apenas todas as configurações marcadas no diagnóstico.
