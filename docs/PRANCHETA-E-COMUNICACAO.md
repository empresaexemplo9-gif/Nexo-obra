# Prancheta e Comunicação

## Antes de usar em produção

1. Aplique a migração `0023` em `/superadmin` → **Atualizar banco de dados**. Sem ela, as duas
   abas respondem `503 database_not_migrated`.
2. `BLOB_READ_WRITE_TOKEN` e `MEDIA_ENCRYPTION_KEY` precisam estar configuradas (as mesmas das
   fotos do diário). Sem elas, o envio de arquivo responde `503 storage_unavailable`. As mensagens
   de texto funcionam sem elas.

## Como o arquivo trafega

A função da Vercel recusa corpo acima de 4,5 MB. Por isso o navegador parte o arquivo em
pedaços de 3 MB (`/api/arquivos/{id}/partes/{n}`), cada um cifrado com AES-256-GCM antes de ir
para o Vercel Blob. Para baixar, o navegador junta as partes e salva com o nome e o tipo
originais, byte a byte. Limite: 150 MB por arquivo. Envio abandonado some depois de um dia.

O mesmo arquivo serve à Prancheta e à Comunicação (`org_files`). Enviar um arquivo da
Prancheta numa conversa não copia os bytes. O objeto só é apagado quando sai da biblioteca e
nenhuma mensagem o usa.

Quem pode ler:

- arquivo da biblioteca: quem tem leitura em "Prancheta e projeto";
- anexo: quem participa da conversa em que ele foi enviado (canal: toda a empresa; conversa
  direta: só as duas pessoas);
- quem enviou sempre lê o que enviou.

Qualquer outro pedido, inclusive de outra empresa, responde 404.

## Formatos

| Formato | Na tela | Conversões |
| --- | --- | --- |
| DWG | Convertido uma vez no servidor (LibreDWG) e exibido como DXF | DXF, PDF vetorial, SVG, PNG |
| DXF | Camadas, fundo claro/escuro, medir, enquadrar | PDF vetorial, SVG, PNG |
| PDF | Páginas sob demanda, zoom | PNG ou JPG por página (200 dpi) |
| IFC, STL, OBJ, glTF/GLB, PLY, 3MF | Modelo 3D com órbita | — |
| DOCX | Documento isolado, sem script | — |
| XLSX, CSV | Abas em tabela (até 1000 linhas × 60 colunas) | — |
| PNG, JPG, WebP, GIF, BMP, AVIF, SVG | Zoom, tamanho real | PDF sem perda (JPEG entra byte a byte) |
| MP4, WebM, MOV, MP3, WAV, M4A, OGG | Player do navegador | — |
| TXT, IES, LDT, JSON, XML, STEP, KML, GeoJSON | Texto (primeiros 2 MB) | — |
| RVT, SKP, DGN, DWF, PLN, DOC, XLS, PPT(X), TIFF, HEIC, nuvem de pontos | Motivo e como exportar | — |

Executáveis e scripts (`.exe`, `.bat`, `.ps1`, `.js`, `.lnk`…) são recusados, inclusive com
extensão dupla (`planta.pdf.exe`).

O PDF, o SVG e o PNG de desenho saem da mesma geometria que o visualizador desenhou, com as
camadas ligadas no momento. O texto vira contorno vetorial. Limitações do leitor de DXF: tipos
de linha tracejada saem contínuos, espessura de linha não é aplicada, e chamadas de texto
(LEADER/MULTILEADER) e o espaço de papel não são desenhados.

## Comunicação

- Canal Geral em toda empresa. Qualquer pessoa cria canal; só quem criou ou quem administra a
  empresa exclui. O Geral não pode ser excluído.
- Conversa direta só entre pessoas ativas da mesma empresa.
- Cada envio leva uma chave gerada no navegador: reenviar depois de erro de rede devolve a
  mesma mensagem, sem duplicar.
- Editar: só o autor. Apagar: o autor ou quem administra a empresa (fica registrado na auditoria).
- Lembrete: texto, data e destinatário (uma pessoa ou todos da conversa). Aparece em Lembretes
  do dia de quem ele vale até ser marcado como feito pela pessoa lembrada ou por quem criou.
- A tela aberta busca novidades a cada 4 s; o contador do menu, a cada minuto. Não há
  notificação push nem por e-mail.
