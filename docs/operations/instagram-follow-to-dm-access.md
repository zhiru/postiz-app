# Follow to DM — preparação e solicitação de acesso

## Estado em 02/11/2026

O gatilho `new_follower` permite preparar e salvar um grafo no editor visual.
**Não recebe eventos de seguidores e não envia mensagens.** A ativação permanece
bloqueada no backend e no painel, inclusive quando o cliente tenta alterar o
status diretamente. Não existe variável de ambiente para contornar o bloqueio.

O app Chat NeuralTalk (747165607585964) não apresenta evento de novo seguidor na
lista de webhooks consultada. A tela de Unified Login informa que não existe
configuração compatível. O produto expõe a preparação como tal; não confundir com
verificar se um contato já segue após uma interação.

O grafo usa o contrato de canvas existente: TRIGGER com
`{"triggerType":"new_follower","executionVersion":2}`, mensagem de abertura em
SEND_DM, DELAY `{"mode":"reply","timeoutHours":24}` e próximos passos de texto
ou mídia. A validação de preparação é conservadora: uma primeira mensagem de
texto e resposta antes de mais envios. Isso **não declara** que o futuro beta
usará o mesmo contrato ou aceitará esse comportamento. Após a liberação será
necessário implementar e testar o evento e envio inicial conforme a documentação
oficial, em novo workflow versionado.

O servidor seleciona V2 ao salvar essa preparação, exige fluxo pausado/rascunho,
recusa ativar e exclui o tipo das entradas de comentário, Story e resposta de DM.
O serviço de envio V2 também bloqueia preparações mesmo se o status no banco
estiver incorretamente ACTIVE. Campos do grafo não são credenciais. Não há
migração, mudança de callback nem alteração automática das contas existentes.

## Caminho para pedir acesso

1. Abrir o [painel do app](https://developers.facebook.com/apps/747165607585964/dashboard/)
   e o [suporte oficial da plataforma Instagram](https://developers.facebook.com/documentation/instagram-platform/support).
2. Usar a opção de suporte ao desenvolvedor/parceiro disponível para a empresa;
   se só houver Assistente do Desenvolvedor, solicitar encaminhamento ao canal
   responsável por acesso ao beta. Não há formulário público de adesão confirmado
   nesta pesquisa. Não declarar uma solicitação enviada sem protocolo/resposta.
3. Revisar e enviar o texto abaixo pelo responsável pelo app. Ele contém apenas
   nome e ID públicos do app e o objetivo da integração; nunca anexar tokens,
   App Secret, contatos, conversas ou dados de seguidores.
4. Registrar o protocolo e a resposta na issue #71. Confirmar se acesso é por app,
   empresa, conta profissional ou combinação deles; a elegibilidade no Manychat
   não comprova acesso do nosso app.
5. Configurar Unified Login somente após revisar os requisitos e em uma integração
   de teste. Não substituir callback, alterar roteamento de conversas nem reconectar
   contas da automação ativa para tentar obter acesso.

### Texto pronto para revisão/envio

Subject: Request developer/partner access to Instagram Follow to DM beta

Hello Meta Developer Support,

We maintain the Chat NeuralTalk app (App ID 747165607585964), used by our
self-hosted Mali Posts platform to manage authorized Instagram professional
accounts. We would like to request official developer or partner access to the
Instagram Follow to DM beta for welcoming newly acquired followers.

Our app dashboard exposes Unified Instagram Login setup, but no compatible login
configuration is currently selected, and no follow/new-follower event is offered
among the Instagram webhook fields available to this app. We have prepared a
draft-only flow editor; activation and all sends from this trigger remain blocked.

Please confirm:
- Whether independent apps can apply, and which team or program handles access.
- Whether eligibility is app-, business-, or Instagram-account-specific, and
  which onboarding, permissions and App Review requirements apply.
- The official webhook field, sample payload, signature verification, identity,
  redelivery and deduplication contract.
- The supported initial-send endpoint, recipient identifier and authorization
  requirements, plus opt-in, frequency limits and messaging-window rules.
- Whether official sandbox/test accounts are available to validate the feature
  before requesting consent from production users.

We will preserve existing subscriptions and automations, honor all consent,
frequency and messaging-window rules, and will not scrape follower lists or use
private/unofficial APIs. Please provide the current documentation and next steps.

Thank you.

## Evidências e aceite futuro

- [Issue #71](https://github.com/zhiru/postiz-app/issues/71)
- [Meta Unified Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/)
- [Manychat Follow to DM beta](https://help.manychat.com/en/articles/17741911-follow-to-dm-on-instagram-say-hi-to-new-followers-beta)

Só remover o bloqueio após contrato e entitlement oficiais verificados. O aceite
precisa provar evento autenticado, isolamento de organização/perfil, deduplicação,
limites, opt-in, cancelamento e ausência de impacto nas automações originais.
Não usar aumento do contador de seguidores como identidade/evento de um seguidor.
