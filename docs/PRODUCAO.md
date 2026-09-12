# Produção: Vercel + Turso

Este documento define quando a H.OIKOS pode ser considerada tecnicamente pronta para uso operacional. Ele não substitui homologação contratual de integrações externas nem revisão jurídica.

## Arquitetura de produção

- **Vercel** publica a aplicação Next.js a partir da branch `main`.
- **Turso/libSQL** é a fonte relacional da plataforma: empresas, pessoas, clientes, CRM, projetos, tarefas, cronograma, orçamentos, diário, metadados de arquivos, financeiro operacional, auditoria e controles de acesso.
- **Vercel Blob** guarda somente os binários. Fotos e documentos são cifrados em AES-256-GCM antes do upload; o Turso guarda a referência e os metadados, não o arquivo bruto.
- **Drap** continua sendo a fonte financeira externa. A H.OIKOS não fabrica saldo nem confirmação de pagamento quando a Drap está indisponível.

Não copie binários para o Turso. Banco relacional e armazenamento de objetos têm responsabilidades diferentes e a aplicação já está desenhada dessa forma.

## Recurso Turso conectado à Vercel

A integração Turso/Vercel deve injetar no projeto de produção uma URL libSQL e seu token. O adaptador reconhece os nomes oficiais da integração:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

Também aceita `DATABASE_URL` + `DATABASE_AUTH_TOKEN` e variáveis prefixadas pela integração que terminem em `_DATABASE_URL` ou `_CONNECTION_URL` com o token correspondente. Não duplique URLs diferentes sob nomes diferentes: deve existir uma única fonte de produção deliberadamente escolhida.

O recurso deve estar conectado aos ambientes que realmente executam a aplicação. Preview e Production podem apontar para bancos diferentes; nunca assuma que uma integração visível no projeto está disponível no deployment sem verificar `/api/health` naquele deployment.

## Segredos obrigatórios

Produção profissional exige, no mínimo:

```text
TURSO_DATABASE_URL        # ou DATABASE_URL / equivalente prefixado
TURSO_AUTH_TOKEN          # ou DATABASE_AUTH_TOKEN / equivalente prefixado
SESSION_SECRET            # >= 32 caracteres aleatórios
SUPERADMIN_EMAIL
SUPERADMIN_PASSWORD_HASH  # use o formato com ':' gerado pelo script do projeto
SUPERADMIN_SESSION_SECRET
BLOB_READ_WRITE_TOKEN
MEDIA_ENCRYPTION_KEY      # 32 bytes em base64, gerada por npm run media:key
```

Se o administrador de manutenção for usado, configure também `MAINTENANCE_ADMIN_EMAIL`, `MAINTENANCE_ADMIN_PASSWORD_HASH` e `MAINTENANCE_ADMIN_SESSION_SECRET`.

`TRUST_IDENTITY_HEADERS` deve permanecer vazio na Vercel comum. Só habilite atrás de uma borda que sobrescreva os cabeçalhos de identidade em toda requisição.

## Migrações

O deploy não aplica migrações às cegas. Depois de publicar uma versão que contenha migração nova:

1. abra `/superadmin`;
2. confira o aviso de banco;
3. use **Atualizar banco de dados**;
4. volte a `/api/health` e confirme `migracoes.pendentes = 0`.

A aplicação não deve receber operação real enquanto o health indicar `falta_migrar`.

## Critério objetivo de prontidão

No domínio de produção, `GET /api/health` precisa retornar simultaneamente:

```json
{
  "pronto": true,
  "banco": "ok",
  "sessao": "ok",
  "superadmin": "ok",
  "armazenamento": "ok",
  "migracoes": { "pendentes": 0 }
}
```

Além disso, `versao` deve corresponder ao commit esperado da `main`. O health nunca devolve valores de segredo, URL de banco, token ou e-mail administrativo.

## Portão de publicação

A branch `main` só deve avançar depois de todos estes passos passarem no GitHub Actions:

- `npm ci` em ambiente limpo;
- `npm run typecheck`;
- `npm run lint`;
- `npm test`;
- `npm run build`.

O deployment da Vercel para o mesmo SHA também precisa concluir com sucesso. Build verde não substitui o health de runtime: variável faltante ou banco não migrado só aparece depois que a função está executando.

## Arquivos e fotos

- limite do arquivo de projeto: 15 MB;
- formatos executáveis, HTML e SVG não são aceitos pelo fluxo de documentos;
- download passa pela autorização da empresa e é servido como `attachment`, `no-store` e `nosniff`;
- os bytes no Blob permanecem cifrados; a chave não é armazenada junto do objeto;
- perder ou trocar `MEDIA_ENCRYPTION_KEY` sem migração torna os objetos antigos ilegíveis. A chave precisa fazer parte do procedimento seguro de backup de segredos.

## Integração Drap

O webhook usa HMAC SHA-256, limite de payload, identificação da empresa e idempotência. Eventos de cobrança com semântica conhecida atualizam a solicitação local; tipos ainda não homologados ficam preservados e marcados como ignorados em vez de produzir efeito financeiro inventado. Eventos falhos podem ser reprocessados pela rota administrativa de integração e deixam auditoria.

A criação real de cobranças e a ativação comercial continuam condicionadas ao contrato técnico oficial da Drap (URL, autenticação, sandbox, payloads, eventos e política de idempotência). Não declare esses fluxos homologados apenas porque o adaptador existe.

## SINAPI

Nenhum preço fictício é usado. A fonte SINAPI depende de provedor/licença/credenciais válidos. Até essa configuração existir, a interface deve tratar a fonte como indisponível.

## Backup, restauração e continuidade

Antes de atender clientes pagantes:

1. habilite a política de backup/recuperação adequada ao plano do Turso;
2. registre onde ficam os segredos da Vercel e a `MEDIA_ENCRYPTION_KEY` e quem pode recuperá-los;
3. execute uma restauração de teste em ambiente separado e valide login, migrações e leitura dos principais registros;
4. teste pelo menos um upload/download cifrado depois da restauração;
5. documente RPO/RTO e responsável por incidente.

A existência de um backup não é suficiente: restauração precisa ser testada.

## Homologação antes de serviço profissional

Código e infraestrutura verdes são apenas a parte técnica. Antes de vender/operar dados reais, ainda é necessário concluir externamente:

- revisão jurídica dos Termos, Privacidade e fluxo de aceite, incluindo LGPD e retenção;
- homologação oficial Drap em sandbox e depois produção;
- licença/fonte oficial SINAPI, se o recurso for oferecido;
- política operacional de suporte, incidentes, backup e restauração;
- teste de aceitação com uma empresa piloto usando somente dados controlados.

Esses itens não devem ser marcados como concluídos por código quando dependem de fornecedor, contrato, licença ou decisão jurídica.
