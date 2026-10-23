# Mali Posts: edição e confirmação por API/MCP

As rotas abaixo exigem a mesma chave de organização/perfil da API pública (`Authorization: CHAVE`, sem Bearer). O MCP usa o contexto autenticado; não aceita organização/perfil no payload. IDs são os dos posts principais, não os dos comentários da sequência. A chave de organização pode acessar seus perfis; a chave de perfil só acessa o próprio. Um ID fora desse escopo retorna 404.

## Contratos

| API                                                   | MCP                                 | Resultado                             |
| ----------------------------------------------------- | ----------------------------------- | ------------------------------------- |
| `GET /public/v1/posts/:id?timeZone=America/Sao_Paulo` | `getPostTool`                       | Registro e versão atual               |
| `PATCH /public/v1/posts/:id`                          | `updatePostTool`                    | Edição parcial ou prévia              |
| `POST /public/v1/posts/:id/validate`                  | `validatePostTool`                  | Validação sem publicação              |
| `PUT /public/v1/posts/:id/status`                     | `changePostStatusTool`              | Rascunho/agendamento confirmado       |
| `PUT /public/v1/posts/:id/date`                       | `changePostDateTool`                | Data salva; ativação explícita        |
| `POST /public/v1/posts/bulk-update`                   | `bulkUpdatePostsTool`               | Resultado por ID                      |
| `GET /public/v1/posts/:id/status`                     | `getPostExecutionTool`              | Estado persistido e execução da fila  |
| `POST /public/v1/upload` (multipart)                  | `uploadFileTool` / `uploadLinkTool` | Mídia, processamento e erro           |
| `DELETE /public/v1/posts/:id`                         | `deletePostTool`                    | Exclusão local; `remoteDeleted:false` |

A leitura inclui `id`, `version` (updatedAt ISO UTC), `contentHtml`, `contentText`, `media` ordenada, `settings`, `collaborators`, comentários de revisão e `sequence`. `networkComments` reutiliza a consulta pública de comentários já sincronizados e retorna `comments`, `count`, `page`, `pageSize:20`; use `commentsPage` na API/MCP para continuar. Não dispara respostas nem nova sincronização durante a leitura. Cada item da sequência tem seu ID, versão, texto, mídias, configurações e comentários. Dados privados de convidados e credenciais do canal não são retornados. `channel` contém somente ID, nome e provedor.

Inclui também `publishDateUtc`, `timeZone`, `publishDateLocal`, `state`, erro sanitizado, `reviewUrl`, `remoteId`, `publishedUrl`, `executionState`, `queueActive`, `observedAt` e `source`. `source:stored_provider_result` significa o último resultado recebido/persistido do provedor; a consulta verifica a execução Temporal, sem fazer uma nova publicação nem uma consulta remota que possa finalizar um envio. Não garante detecção imediata de exclusões feitas diretamente na rede. Erros brutos de publicação podem conter dados de requisição/credenciais e não são expostos.

## Edição parcial, mídia e collabs

Leia antes de editar e envie exatamente `version`. Campo omitido preserva seu valor. A edição muda somente conteúdo, mídia ou configurações do registro existente: não troca ID, grupo, canal, estado, data, sequência, recorrência ou comentários. Posts publicados/importados, com ID remoto ou agendamento possivelmente em execução são bloqueados. Alterar o banco não altera uma legenda já publicada na rede.

```json
{
  "version": "2026-10-23T00:55:04.278Z",
  "content": "Primeiro bloco.\n\nSegundo bloco."
}
```

`content` aceita texto simples com quebras reais ou HTML sanitizado. Sem `normalizeSpacing:true`, não há normalização de espaçamento. `media` é a lista completa na ordem desejada; omiti-la mantém todas as mídias. Entradas são mescladas por ID ou caminho, preservando alt/capa omitidos. Exemplo de inversão de carrossel: `media:[{"id":"segunda"},{"id":"primeira"}]`. `alt` altera texto alternativo; `thumbnail:null` remove capa do item, `thumbnailTimestamp:null` remove a seleção de quadro. Mídias precisam pertencer à organização/perfil e estar prontas.

`settings` mescla objetos recursivamente e substitui arrays. `settings.cover` usa a capa já suportada pelo canal; `settings.collaborators:[{"label":"@parceiro"}]` configura e `settings.collaborators:[]` remove colaboradores. O MCP recebe esse objeto em `settingsJson`. A versão e o estado editável são comparados atomicamente na gravação (409 se houve concorrência).

Um colaborador configurado não prova convite enviado ou aceito. A resposta distingue `configured:true`, `invitationSent:"unknown"`, `invitationAccepted:"unknown"`, `profileValidation:"unknown"`. Atualmente não há consulta remota de perfis/convites nessa operação. A validação verifica sintaxe/configuração suportada e rejeita collab em Stories. Uma menção na legenda nunca é convite. Não oferecemos alteração de collab após publicação.

## Revisar espaçamento antes de aplicar

1. Leia o post e guarde versão e campos preservados.
2. Envie PATCH com `{"version":"VERSAO","normalizeSpacing":true,"dryRun":true}`.
3. Mostre `preview.contentText` e `diff` ao usuário. A prévia é somente leitura e inclui `previewHash` e validação.
4. Aplique com a mesma versão e `previewHash`, `normalizeSpacing:true`, `dryRun:false`.
5. Leia novamente e compare os campos. Só conteúdo e versão devem mudar.

A normalização insere uma linha vazia entre blocos, agrupa data/local iniciados por emojis de evento, listas e hashtags consecutivas, preserva palavras, emojis, menções e marcação inline. Quebras extras em HTML também são tratadas. Não interpreta semanticamente datas escritas sem marcadores; revise a prévia. Alterações posteriores à prévia invalidam sua versão/hash. Não publica.

Se a gravação foi concluída mas a leitura final falhou, retorna `status:updated`, `confirmation:pending` e aviso `POST_READ_PENDING`; releia, não reaplique. Falha ao verificar âncoras de revisão retorna `REVIEW_ANCHORS_PENDING`, sem declarar que a edição não ocorreu.

## Estado e horário

```json
{ "version": "VERSAO", "status": "draft" }
```

Rascunho termina a execução pendente e confirma que parou antes de retornar. `schedule` exige validação e horário futuro; posts publicados e falhas de publicação com resultado incerto não são republicados. Status/data usam um bloqueio durável por ID, compartilhado entre painel/API/MCP. Falha de confirmação mantém bloqueio para reconciliação operacional, sem expiração que possa repetir efeitos.

```json
{
  "version": "VERSAO",
  "date": "2026-11-10T13:00:00-03:00",
  "timeZone": "America/Sao_Paulo",
  "action": "update"
}
```

O offset/Z define o instante; o fuso IANA define sua apresentação na resposta. Data sem offset é rejeitada. `action:update` preserva estado; rascunho continua rascunho. Um agendamento ativo atualiza seu temporizador. `action:schedule` também ativa o rascunho. Se a ativação falhar após salvar a data, releia a data/estado antes de tentar novamente.

Estados de execução: `DRAFT_SAVED`, `SCHEDULED`, `PROCESSING`, `PUBLISHED`, `FAILED`, `AWAITING_REMOTE_CONFIRMATION`, `SCHEDULE_MISSING`, `EXECUTION_UNKNOWN`. Um resultado local `PUBLISHED` sem ID remoto conhecido não é confirmação. Aceitar uma solicitação ou enviar rascunho à rede não equivale a publicação concluída.

## Lotes e idempotência

```json
{
  "idempotencyKey": "corrigir-legendas-20261023",
  "dryRun": true,
  "updates": [
    {
      "id": "POST_ID",
      "changes": { "version": "VERSAO", "normalizeSpacing": true }
    }
  ]
}
```

Máximo 100 IDs únicos. Resultados independentes: `preview`, `updated`, `skipped`, `failed`; previews trazem diferenças antes/depois. Para aplicar, use `dryRun:false` e inclua os hashes das prévias em cada `changes`. A combinação chave/ID é persistida antes de executar; repita exatamente chave e conteúdo para recuperar resultados concluídos, inclusive falhas já conhecidas, sem reexecutar os itens. Novas correções exigem nova chave e versão. Um resultado interrompido/desconhecido exige reconciliação, não uma nova chave para repetir cegamente.

Criações em `POST /public/v1/posts` passam a exigir `Idempotency-Key` (8–200 caracteres), ou `body.idempotencyKey`. O MCP de criação exige `idempotencyKey`. O mesmo corpo/chave retorna o resultado anterior; corpo diferente com chave reutilizada dá 409. Clientes existentes precisam adicionar a chave. O antigo POST com IDs é um salvamento completo legado: para preservar campos omitidos use PATCH.

## Validação e upload local

Para transferência idempotente de bytes reais, manifesto SHA-256 e upload de arquivos maiores por sessão temporária, veja [Transferência de mídia pelo MCP](mcp-media-transfer.md). O guia inclui `uploadMediaTool`, `prepareMediaUpload`, `completeMediaUpload` e um cliente executável que preserva a ordem do carrossel e cria somente rascunhos.

`validatePostTool` aceita ID/versão e as mesmas alterações opcionais da edição. Reutiliza DTOs, limite de legenda, configurações e regras de mídia dos provedores. Retorna `valid`, `errors:[{field,code,message}]`, `warnings`. Imagens têm dimensões medidas; vídeos locais usam ffprobe e saídas do processador usam seus metadados. Um vídeo remoto sem metadados verificáveis precisa ser preparado antes. As regras de Reels seguem a [coleção oficial da Meta](https://www.postman.com/meta/instagram/folder/y6xustx/reels-publishing), incluindo codec, largura e duração quando os metadados estiverem disponíveis. O provedor ainda pode rejeitar permissões, convites ou restrições da conta que só conhece no envio. A validação nunca publica.

O cliente MCP pode enviar `fileReference:{name,base64}` com bytes reais até aproximadamente 4,5 MB; isso não é um caminho que o servidor possa ler no computador do usuário. Para arquivos maiores, `uploadLinkTool` retorna `uploadUrl`, `uploadHeaders` e `sessionId`; envie multipart `file=@arquivo` à rota de upload existente, com `X-Postiz-Upload-Ticket`. Não registre ticket, chave ou base64 nos logs. Nenhuma URL pública de origem é necessária. O arquivo armazenado ainda precisa ser acessível ao provedor quando a rede exigir download.

`mediaStatusTool` ou `uploadWidgetStatusTool` informam status, erro e progresso: `null` quando indeterminado, 100 ao terminar. MOV solicita preparação MP4 automaticamente pelo upload por referência; no multipart envie `adjust:true`. O original é preservado em `originalPath`, e a saída pronta tem outro caminho. Armazenamento local usa novo workflow `prepareLocalMediaWorkflowV1`, ffmpeg H.264/yuv420p/AAC e faststart; armazenamento externo reutiliza o processador existente. Sem capacidade de processamento, o MOV falha explicitamente. Nenhuma mídia `processing`/`failed` é liberada ao executor de publicação, mesmo se o post já estava agendado.

## Exclusão e erros

Excluir do Postiz não garante remoção na rede social. A API/MCP de exclusão é local, retorna `localDeleted` e `remoteDeleted:false`; não oferece exclusão remota sem suporte confirmado. `getPostTool.remoteDeletion.supported:false` deixa essa limitação explícita.

| HTTP | Código/resultado                                       | Ação                                                         |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------ |
| 400  | INVALID_INPUT, POST_VALIDATION_FAILED, MEDIA_NOT_READY | Corrigir os campos; não houve publicação                     |
| 404  | Post not found                                         | Conferir ID e escopo autenticado                             |
| 409  | POST_VERSION_CONFLICT                                  | Reler e revisar diferença                                    |
| 409  | POST_NOT_EDITABLE / PUBLICATION_MAY_HAVE_STARTED       | Consultar execução; não republicar                           |
| 409  | IDEMPOTENCY_KEY_REUSED                                 | Usar o corpo original ou nova operação intencional           |
| 409  | OPERATION_UNKNOWN_RESULT / POST_QUEUE_LOCKED           | Reconciliar; não repetir efeitos                             |
| 428  | PREVIEW_REQUIRED                                       | Mostrar prévia e enviar o hash                               |
| 503  | QUEUE_CANCELLATION_UNCONFIRMED / SCHEDULE_UNCONFIRMED  | Reler banco e fila; solicitação aceita não confirma execução |

## Release e aceite

Aplicar somente migração aditiva, gerar Prisma e publicar backend/orchestrator com ffmpeg/ffprobe após regressões. Ver [operação e migração](../operations/post-management-release.md). Workflows existentes não foram alterados.

Aceite concluído em produção em 23/10/2026, release da PR #52 (`1db84642f`): `cmvk9cw9i000mmoftkord2u7z` e `cmvk9cwa1000nmoftyvz7ak2c`. Executado GET → PATCH dryRun → revisão → PATCH com versão/hash → GET. Somente conteúdo/updatedAt mudaram; ambos continuam DRAFT_SAVED, queueActive:false. Mídias, ordem, configurações, canal e horário preservados. Nenhum post foi criado ou publicado. Evidência: https://github.com/zhiru/postiz-app/pull/52#issuecomment-6364865952.

A paridade do painel ainda é parcial: os caminhos legados de salvamento/data não recebem a versão lida pelo cliente. O painel aceita rascunhos incompletos; a edição nova da API/MCP exige validação completa. Esses limites não devem ser anunciados como paridade integral.


## Exclusão remota do Instagram

A exclusão local continua independente e não remove conteúdo da rede. No menu de três pontos do card publicado, “Excluir da rede social” lê a versão/ID remoto e pede confirmação explícita com a conta e o conteúdo. O histórico local é mantido após a remoção remota.

- `GET /public/v1/posts/:id/remote-deletion` / `getRemoteDeletionTool({id})`: `{id,version,remoteId,supported,status}`. `supported` é capacidade do provedor, não garantia da permissão da conta.
- `POST /public/v1/posts/:id/delete-remote` / `deleteRemotePostTool({id,version,confirmRemoteId})`: operação destrutiva; use o ID remoto exato da leitura após confirmar com o usuário. Retorna `{status:"deleted"|"unknown",remoteId,localDeleted:false}`.
- Painel autenticado usa `GET /posts/:id/remote-deletion` e `POST /posts/:id/delete-remote`, com o mesmo serviço e escopo.
- `409 REMOTE_DELETE_CONFIRMATION_REQUIRED`: versão desatualizada, ID remoto divergente ou registro não publicado. `412`: conexão/token/permissão ausente. `422 REMOTE_DELETE_UNSUPPORTED`: provedor incompatível.

A [documentação da Meta](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) exige Facebook Login, token de usuário e `instagram_manage_contents`. A autorização OAuth passa a solicitar essa permissão; conexões existentes continuam funcionando para publicação e precisam de reconexão com consentimento aprovado para exclusão. Nenhuma aprovação da Meta é presumida ou submetida automaticamente por este código. Instagram Login direto não oferece esta capacidade documentada.

Aceita posts sem anúncio, Stories, Reels e carrosséis inteiros. Não exclui uma imagem isolada do carrossel. A propriedade da mídia é conferida antes de chamar DELETE; a rede aplica as restrições restantes. Sucesso exige `success:true` e `deleted_id` igual ao solicitado.

Um recibo durável por organização/perfil/post/mídia reserva a operação antes do DELETE. Repetição devolve o resultado anterior sem reenviar. Timeout, resposta inesperada ou queda após a reserva deixam `unknown`; consultar Instagram e reconciliar manualmente. Nunca afirmar que foi excluído nem contornar a reserva com outro ID. Os testes automatizados não excluem publicações reais.

Após confirmação, `getPostTool`/GET por ID retornam `executionState:REMOTE_DELETED` e `remoteDeletion.status:deleted`; `state:PUBLISHED` permanece o estado histórico do envio original. Calendário e lista exibem “Excluído da rede social”, sem o sinal verde de publicação ativa. Lotes de Stories com várias mídias retornam `422 MULTIPLE_STORY_IDS_UNAVAILABLE`, pois o fluxo legado não guarda todos os IDs remotos. Excluir os Stories individualmente no Instagram até existir esse histórico completo.
