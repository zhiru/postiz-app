# Integração da base Robô MultiPost

Esta branch combina `maiconramos/robo-multipost@b6686fe0` com
`zhiru/postiz-app@741a4f70`. O repositório de entrega continua sendo
`zhiru/postiz-app`.

## Recursos preservados

- Base Robô: automações de comentários e Stories, editor de fluxos,
  ativação/pausa e histórico, perfis de clientes, credenciais por perfil,
  persona/base de conhecimento, republicação entre redes e mídia em lote.
- Aireset: histórico do Instagram no calendário, sincronização automática e
  manual, identidade única das publicações, snapshots de recorrência,
  relatórios/CSV, caixa de comentários, webhooks assinados e registro de
  entregas, ferramentas de API/MCP e administração da instância.
- Configurações do cliente, autenticação, modelos, MCPs, rotas e publicação de
  imagens da instância atual não são substituídas pelas configurações de
  desenvolvimento do projeto doador.

## Comentários por palavra-chave

1. Configurar o webhook oficial da Meta conforme
   [o guia de automações](automacoes-instagram.md), usando as credenciais do
   aplicativo que possui o canal. Validar as permissões para esse canal.
2. Em Automações, escolher o perfil/canal e criar uma regra de comentário com
   palavra-chave, resposta pública e mensagem privada. Salvar e ativar.
3. Conferir o histórico da execução. Pausar a regra impede os próximos envios;
   uma chamada já iniciada na Meta pode terminar depois da pausa.

Eventos têm identidade única no banco e workflow fixo. Cada ação pública tem
uma reserva durável própria; a DM privada compartilha a reserva do comentário,
pois a API permite apenas uma resposta privada por comentário. Stories e
postbacks também possuem reservas duráveis. Nenhuma mutação repete uma chamada
HTTP automaticamente nem muda de token depois de iniciá-la.

Se a Meta aceitar uma mensagem mas a resposta se perder, não é possível provar
a entrega. O registro fica com resultado desconhecido e a execução apresenta
falha de confirmação no histórico. O sistema bloqueia o reenvio automático.
Isso evita duplicação, mas pode deixar um envio sem confirmação ou até sem
envio caso o processo pare entre reservar e chamar a Meta. Conferir o Instagram
antes de qualquer ação manual.

## Migração de uma instalação existente

1. Guardar backup verificável do PostgreSQL, Temporal, compose, ambiente,
   arquivos de mídia e identificador da imagem anterior.
2. Testar a migração em uma cópia isolada. Nunca apontar testes para produção.
3. Aplicar o SQL gerado pelo Prisma em
   [robo-multipost-additive.sql](migrations/robo-multipost-additive.sql) antes de
   iniciar o código novo. O arquivo não remove tabelas/colunas nem altera
   tipos existentes. Não usar reset ou `--accept-data-loss`.
4. Preservar `JWT_SECRET`, `ENCRYPTION_KEY` e credenciais existentes. Os campos
   de perfil são opcionais; o bootstrap atribui os registros legados ao perfil
   Default. Conferir membros, canais, posts e mídia antes de liberar usuários.
5. Implantar backend/orchestrator/frontend da mesma versão. As implementações
   de workflows já existentes são preservadas; as versões novas têm nomes
   próprios. A publicação padrão continua em V113; o pipeline do doador é V114
   e depende de habilitação explícita. Mudanças de provider Late/Zernio também
   são opt-in (`MIGRATE_LATE_TO_ZERNIO=true`).
6. Validar login, isolamento entre perfis, calendário, importados, recorrência,
   relatório, comentários e uma regra controlada com uma conta de teste.

O rollback exige parar os serviços novos antes de voltar à imagem anterior;
restaurar os backups se a etapa de migração de dados exigir reversão. Não apagar
as tabelas novas para tentar reverter uma instalação em funcionamento.

## Validação desta integração

- Build completo do frontend, backend e orchestrator; TypeScript e bundle
  Temporal verificados separadamente.
- Migração executada em PostgreSQL descartável com 1.214 posts sintéticos:
  conteúdo e contagem de todos os 89 modelos anteriores permaneceram iguais.
- Sincronização testada com concorrência real no PostgreSQL: importação versus
  publicação nativa, recorrências, tombstones, cotas e isolamento.
- Reservas de envio testadas com concorrência, resultado desconhecido, reinício
  do serviço e falha de gravação após sucesso externo.
- Clipping e geração legada de vídeo ficam disponíveis com escopo de
  organização/admin; geração configurada por perfil continua independente.

Esses testes não substituem a validação das permissões da Meta e da entrega de
mensagens em uma conta real. A integração não ativa regras nem envia mensagens
em produção por conta própria.
