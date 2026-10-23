# Release da gestão de posts API/MCP

A publicação em produção é uma etapa separada, após aprovação do release. Não executar testes de comentário/DM nem alterar automações ativas.

1. Backup verificado do banco e arquivos de mídia; registrar imagem atual e contagem/estado das automações sem acessar tokens.
2. Validar o diff de schema: somente `Media.originalPath`, `Media.metadata` e tabela `PostOperation`. Aplicar `docs/migrations/post-management-additive.sql` pelo procedimento de migração ou executar o `prisma-db-push` já adotado neste projeto após revisar o diff. Não usar reset/accept-data-loss.
3. Gerar Prisma 6.5 pelo schema do repositório. Construir backend e orchestrator com Node22; a imagem precisa de ffmpeg/ffprobe (Dockerfile.dev já inclui o pacote). Os dois serviços devem ter acesso ao mesmo volume local de uploads.
4. Atualizar backend/orchestrator juntos, registrando também os novos tools no processo MCP. O novo workflow/atividade usa nomes próprios; workflows e parâmetros antigos permanecem compatíveis.
5. Conferir GET e PATCH dryRun com chave de perfil autorizada e 404 com outro perfil. Conferir OpenAPI em /docs e tools no MCP; reconectar/atualizar o catálogo do cliente se estiver em cache.
6. Em um rascunho de teste isolado, validar a edição, concorrência e inversão de mídia. Para a fila, agendar em futuro distante e voltar a rascunho; confirmar Temporal TERMINATED e queueActive:false. Não usar publicações/contas reais nessa etapa.
7. Fazer o aceite de espaçamento dos dois IDs documentados em post-management.md com snapshot anterior e posterior. Verificar DRAFT antes/depois e que nenhuma nova execução foi iniciada.
8. Conferir que as definições/estados das automações e os totais de entrega não tiveram mudanças causadas pelo teste. Remover apenas os recursos temporários de teste.

## Resultado incerto e bloqueio de fila

`PostOperation` guarda receipts e bloqueios. Receipts sem resultado significam interrupção após reserva: não apagar para tentar a mesma criação novamente. Consultar posts/executions e correlacionar a operação antes de qualquer decisão.

O ID `queue:POST_ID` é um bloqueio exclusivo de mudança de fila. Sem expiração automática: uma queda após iniciar/terminar workflow não autoriza repetir a operação. Para reconciliar, suspenda novas mudanças nesse post, leia o post e descreva `post_POST_ID` no Temporal; confirme que não há publicação em processamento nem atividade com resultado remoto desconhecido. Corrija o estado/fila pelo procedimento operacional antes de remover, via Prisma, somente a linha de bloqueio desse ID/organização. Remoção sem essas verificações pode reabrir uma corrida. Nunca remover receipts por prefixo amplo ou reiniciar envios para testar.

Rollback de imagem pode preservar as colunas/tabela aditivas. Não apagar originais preparados nem receipts ao reverter código. Vídeos que falharam ou ainda processam devem continuar bloqueados para publicação.

## Regressão reproduzível

`post.management.integration.spec.ts` só roda com `RUN_POST_MANAGEMENT_INTEGRATION=1`, DATABASE_URL apontando para PostgreSQL isolado em 127.0.0.1:65432/mcp_tests e TEMPORAL_TEST_ADDRESS=127.0.0.1:17233. Não aceita banco/Temporal de produção. Aplicar schema no banco descartável, registrar search attributes Text postId/organizationId no Temporal de teste e rodar pelo Jest do projeto nestjs-libraries. Não há worker consumidor da fila, portanto nenhuma rede social recebe publicação. Testes de MOV usam ffmpeg/ffprobe locais e comparam o hash do original.
