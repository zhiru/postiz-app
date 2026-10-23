# Canal NeuralTalk (Hermes Premium)

O NeuralTalk é um canal de envio no editor existente do Mali Posts. Não é um disparo automático vinculado à publicação em outra rede.

## Conectar e enviar

1. Em adicionar canal, escolha NeuralTalk. Informe a URL HTTPS da instância (ex.: https://chat.neuraltalk.com.br) e a chave de API do seu usuário NeuralTalk. A chave fica em memória só durante a conexão e é criptografada no servidor; não a envie pelo chat.
2. Selecione uma conta/tenant autorizada (ex.: Abrasel) e uma caixa disponível para mensagens de saída. A conexão representa essa conta e caixa dentro do perfil atual do Mali Posts.
3. Crie um post, selecione o canal NeuralTalk e busque os contatos/grupos. É possível selecionar vários destinos e manter a seleção ao pesquisar ou trocar de página.
4. Escreva a mensagem no editor, anexe imagens/vídeos e inclua links. Use rascunho, enviar agora ou agendar como nos demais canais. O envio só acontece pela ação explícita de publicar/agendar.
5. O calendário acompanha o processamento. O post só é concluído após confirmar o identificador remoto ou o status delivered/read de todos os destinos. O link abre a primeira conversa no NeuralTalk.

Para grupos, é necessária uma caixa QuePasa com suporte a grupos. Os contatos/grupos devem já existir no NeuralTalk e estar vinculados à caixa selecionada. O acesso é revalidado na execução. Esta integração não cria grupos nem importa a agenda do WhatsApp.

## Limites e recuperação

Uma mensagem por post, até 50 destinos, 10 arquivos e 50 MB por arquivo, legenda até 4096 caracteres. As limitações da caixa/provedor também se aplicam. Os anexos são enviados na ordem do editor; a apresentação final depende do canal de destino. Sequência de comentários e repetição periódica não estão habilitadas para este canal. Use um envio imediato ou agendamento único; o editor e o backend rejeitam recorrência sem apagar a seleção existente.

Há um recibo durável por organização, perfil, canal, post e destino, reutilizando PostOperation. Reexecutar um envio confirmado recupera o resultado salvo sem criar outra mensagem. Se houver timeout após a requisição, a reserva permanece: consulte a conversa e reconcilie antes de reenviar. Não crie uma cópia do post para contornar uma situação desconhecida.

O NeuralTalk pode aceitar uma mensagem e falhar no envio posterior. `sent` sem source_id é tratado como processamento, pois esse estado também é o valor inicial no Hermes. Falha de leitura transitória pode ser repetida; a criação da mensagem não é repetida automaticamente. Envio parcial é possível: destinos já aceitos mantêm seus recibos mesmo que outro falhe; os seguintes não são enviados e o post fica em erro. Não há retomada automática dos destinos restantes após falha.

Excluir o post do Mali Posts não apaga mensagens enviadas no NeuralTalk.

## Contratos

Rotas autenticadas do painel, com permissão de gestão do perfil e criação de canal:

- POST /integrations/neuraltalk/accounts `{baseUrl,apiToken}` → `{accounts:[{id,name}]}`.
- POST /integrations/neuraltalk/inboxes `{baseUrl,apiToken,accountId}` → `{inboxes:[{id,name,channelType,supportsGroups,available}]}`.
- POST /integrations/neuraltalk/connect `{baseUrl,apiToken,accountId,inboxId}` → `{id}` do canal.

IDs são strings; accountId pode ser UUID. As respostas não incluem a chave, pubsub_token, hmac_token ou credenciais de caixa. Requisições externas usam HTTPS público e proteção contra SSRF/redirect.

Após conectar, API/MCP usam o canal existente e as operações de posts habituais. Configuração:

```json
{"__type":"neuraltalk","targets":["group:123","group:456","contact:789"]}
```

Ambos os sufixos são IDs de Contact no tenant NeuralTalk, não números de telefone ou identificadores livres do WhatsApp. A ferramenta do provedor `destinations` aceita `{query,page}` e `{ids:[...]}` para consultar nomes dos destinos salvos. Os contratos de versão, idempotência, validação, mídia pronta e estado do documento [API/MCP](api/post-management.md) continuam aplicáveis.

## Testes

Testes automatizados usam respostas falsas no formato dos controllers/jbuilders do Hermes; não enviam mensagens reais. Conferir permissões da conta/caixa e destinos na instância publicada antes do primeiro envio. Publicar o release é uma etapa separada da implementação. Não há alteração de schema nem de workflows existentes nesta integração.
