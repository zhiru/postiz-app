# Sincronização de publicações do Instagram

O calendário e a lista de publicados incluem publicações feitas fora do Postiz.
Suporte: `instagram` (Facebook Login) e `instagram-standalone` (Instagram Login),
usando as credenciais do canal conectado e a API oficial da Meta.

## Uso

No menu de três pontos do canal, selecionar **Sincronizar agora**. O modal mostra
fila, execução, última sincronização e conclusão da importação inicial.
A execução continua quando o modal é fechado. O calendário atualiza a cada minuto
enquanto está visível; o modal atualiza o calendário ao concluir uma sincronização.

Publicações importadas recebem a indicação **Publicado pela rede social** e
preservam a data original em UTC, exibida no fuso configurado no Postiz.
O card abre uma visualização somente para leitura com link para o original.
Não podem ser arrastadas, editadas ou transformadas em agendamento, inclusive
pela API. Ocultar um importado no Postiz não apaga o original nem o recria na
próxima importação. A sincronização nunca apaga posts por ausência em uma resposta.

## Histórico, execução automática e retomada

- A primeira execução percorre todas as páginas disponibilizadas pela API.
- Cada página é gravada antes de avançar o cursor. Uma repetição é idempotente.
- Históricos grandes continuam em novas execuções Temporal a cada 50 páginas.
- Com `RUN_CRON` habilitado, o scheduler consulta canais elegíveis a cada 15 minutos.
- Depois da primeira carga, atualiza até três páginas de publicações recentes
  por execução e reconcilia o histórico completo diariamente. A revisão completa
  não depende de ordenação temporal da API nem de encontrar um post já conhecido.
- Um workflow por canal impede sobreposição de solicitações manuais e automáticas.
- Falhas definitivas aparecem no modal; a próxima tentativa reinicia a leitura
  com segurança (inclusive se um cursor expirou). Tokens nunca entram nos argumentos
  de workflows nem nas mensagens persistidas de erro da sincronização.

## Identidade e concorrência

`Post.externalId` é opcional, com índice único `(integrationId, externalId)`.
`Post.importedFromPlatform` separa registros importados dos criados pelo Postiz.
O importer reconhece também os `releaseId` existentes antes desta implementação.

Importação, confirmação de publicação e vinculação de IDs usam transações
serializáveis com repetição em conflitos. Se a publicação for confirmada depois
da importação, o registro nativo vence: mantém seu ID e seus relacionamentos;
o registro importado vira um tombstone fora do calendário. Não há índice único
em `releaseId`, pois o valor sentinela `missing` pode ocorrer em vários posts.

Raízes recorrentes continuam como templates de programação. Cada publicação nova
gera um snapshot imutável, identificado por mídia/slot, na mesma transação da
confirmação; por isso aparece imediatamente, inclusive quando é um Story. Após
a carga completa, templates cobertos pela API deixam de produzir ocorrências
virtuais passadas; suas ocorrências futuras continuam visíveis. Históricos de
Stories não são marcados como cobertos e suas ocorrências antigas são preservadas.
Snapshots de sucesso são criados somente para raízes, nunca para respostas de
threads ou confirmações parciais com erro. Analytics e coleta de comentários
usam os registros efetivos em vez de contar/consultar também o template.
Importações e snapshots não consomem novamente a cota mensal de agendamento.

Cada operação de sincronização é limitada à organização e ao canal. O contrato
opcional `SocialProvider.listPublishedPosts` permite adicionar outros provedores
sem condicionais específicas de Instagram em serviços genéricos.

## Ativação / deploy

1. Fazer backup do banco e implantar backend e orchestrator da mesma versão.
2. Aplicar o schema aditivo antes de iniciar essa versão, seguindo o processo
   existente do projeto:

   ```bash
   pnpm exec prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma --skip-generate
   pnpm run prisma-generate
   ```

   Não usar `--accept-data-loss`. Os campos novos são opcionais ou têm default;
   os IDs externos existentes continuam nulos até a conciliação.
3. Publicar frontend, backend e orchestrator. Verificar worker na fila `main`.
4. Para atualização automática, manter `RUN_CRON` habilitado em uma instância
   inicializadora. O ID fixo do scheduler impede criações simultâneas duplicadas.
5. Abrir o canal Instagram conectado e executar **Sincronizar agora**.

Endpoints autenticados do painel:

- `GET /integrations/:id/posts-sync`: somente datas/estado/erro seguro.
- `POST /integrations/:id/posts-sync`: enfileira a execução; não recebe tokens.

Sem conta real conectada, os testes não comprovam permissões aprovadas do app
Meta nem disponibilidade do histórico daquele perfil. Escopos de leitura já estão
declarados pelos providers, mas um token antigo pode exigir reconexão.

## Limites

Importa feed, Reels e carrosséis retornados por `/{profile-id}/media`. Não recupera
Stories expirados, rascunhos do Instagram, itens arquivados/indisponíveis ou posts
de outro autor que a API não devolva para aquele perfil. Collabs recebidas de
outros autores dependem da cobertura da API e não são presumidas completas.
Os anexos guardam os URLs retornados pela Meta, renovados nas reconciliações;
isso não é um backup permanente dos arquivos de mídia.

## Validação

Testes de provider, serviço e workflow usam respostas simuladas. Os testes de
concorrência usam PostgreSQL real, nunca um banco de produção:

```bash
# PostgreSQL descartável local, nome de banco terminado em _test.
DATABASE_URL="$POSTIZ_SYNC_TEST_DATABASE_URL" pnpm exec prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma --skip-generate
pnpm exec jest --config jest.posts-sync.config.cjs --runInBand
```

Definir `POSTIZ_SYNC_TEST_DATABASE_URL` explicitamente para executar os testes
de banco; sem ela, essa suíte é ignorada. As outras suítes continuam executando.

QA com conta de teste:

1. [ ] Conectar uma conta profissional com posts publicados diretamente no Instagram.
2. [ ] Sincronizar e conferir legendas/datas, incluindo um carrossel e um Reel.
3. [ ] Sincronizar novamente e confirmar a mesma quantidade de cards.
4. [ ] Publicar pelo Postiz durante uma sincronização e confirmar um único card.
5. [ ] Publicar diretamente no Instagram e aguardar o ciclo de 15 minutos.
6. [ ] Abrir o importado, verificar o link original e a proteção contra arraste/edição.
7. [ ] Ocultar um importado, sincronizar e confirmar que ele não reaparece.
8. [ ] Tentar consultar/sincronizar o ID do canal usando outra organização: 404.

## Referência analisada

Foi inspecionado `maiconramos/robo-multipost` em `b6686fe0`. É um fork AGPL do
Postiz com adaptações próprias; não foi encontrada uma importação de publicações
externas pronta para portar. Nenhum merge amplo ou código desse fork foi incluído.
