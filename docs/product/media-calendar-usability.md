# Biblioteca de mídia e calendário

A biblioteca mantém a visualização por cards. A busca procura o nome original do arquivo; os filtros Imagens/Vídeos e a ordenação são aplicados antes da paginação. É possível escolher 12, 24, 48 ou 96 itens por página. A preferência fica salva no navegador. Contagem, navegação e seletor de quantidade aparecem acima e abaixo da grade. Alterar busca, filtro, ordenação ou quantidade retorna à primeira página.

Arrastar arquivos para a área da biblioteca inicia o upload automaticamente, assim como selecionar arquivos pelo botão Enviar. A interface informa esse comportamento e o limite de 1 GB por upload; os formatos aceitos continuam sendo validados pelo uploader. A seleção para inserir mídia e as proteções contra apagar mídia em uso continuam independentes.

No calendário e na listagem, use a busca por texto, o filtro de formato (Feed, Stories, Reels/vídeos, Carrosséis) e o de estado. Formato é deduzido das configurações, anexos e URL da publicação. Quando não há metadados suficientes, o item entra em Feed. Uma publicação tem um formato principal: carrosséis de várias mídias ficam em Carrosséis, mesmo contendo vídeo.

A listagem permite 10, 20, 50 ou 100 posts por página e inclui rascunhos passados. O filtro Rascunhos atrasados mostra somente rascunhos com data anterior ao horário atual. Eles recebem X vermelho e “Não publicado”; o verde continua reservado aos publicados. Esse indicador não altera o estado nem agenda/publica o conteúdo automaticamente.

Ao abrir Dia/Semana contendo a data atual, a tela posiciona a linha do horário atual no campo de visão. Clicar em Hoje repete o foco. Atualizações dos dados e do relógio preservam a rolagem manual. Datas sem o dia atual não são reposicionadas. A barra de canais reduzida mantém avatares proporcionais e o botão acessível de expandir/recolher.

## Compatibilidade

Os filtros privados respeitam organização e perfil permitido. A API pública e o MCP mantêm os parâmetros e o tamanho padrão da biblioteca. Não há migração de schema, alteração de workflows, envio de mensagens ou edição de automações. O filtro de formato da listagem classifica metadados do escopo antes de paginar; em históricos muito grandes, considerar um campo normalizado e indexado após medição.
