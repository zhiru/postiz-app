# Biblioteca de mídia e calendário

A biblioteca mantém a visualização por cards. A busca procura o nome original do arquivo; os filtros Imagens/Vídeos e a ordenação são aplicados antes da paginação. É possível escolher 12, 24, 48 ou 96 itens por página. A preferência fica salva no navegador. Contagem, navegação e seletor de quantidade aparecem acima e abaixo da grade. Alterar busca, filtro, ordenação ou quantidade retorna à primeira página.

Arrastar arquivos para a área da biblioteca inicia o upload automaticamente, assim como selecionar arquivos pelo botão Enviar. A interface informa esse comportamento e o limite de 1 GB por upload; os formatos aceitos continuam sendo validados pelo uploader. A seleção para inserir mídia e as proteções contra apagar mídia em uso continuam independentes.

No calendário e na listagem, use a busca por texto, o filtro de formato (Feed, Stories, Reels/vídeos, Carrosséis) e o de estado. Formato é deduzido das configurações, anexos e URL da publicação. Quando não há metadados suficientes, o item entra em Feed. Uma publicação tem um formato principal: carrosséis de várias mídias ficam em Carrosséis, mesmo contendo vídeo.

O menu de três pontos recebe foco sem rolar a página ao abrir ou navegar pelo teclado, evitando que a rolagem causada pelo foco feche o próprio menu. Escape, clique externo e rolagem manual continuam fechando o menu. Publicações importadas mantêm prévia e ações permitidas pelo perfil; edição, mudança de data e duplicação continuam indisponíveis para importados.

A listagem permite 10, 20, 50 ou 100 posts por página e inclui rascunhos passados. O filtro Rascunhos atrasados mostra somente rascunhos com data anterior ao horário atual. Eles recebem X vermelho e “Não publicado”; o verde continua reservado aos publicados. Esse indicador não altera o estado nem agenda/publica o conteúdo automaticamente.

Ao abrir Dia/Semana contendo a data atual, a tela posiciona a linha do horário atual no campo de visão. Clicar em Hoje repete o foco. Atualizações dos dados e do relógio preservam a rolagem manual. Datas sem o dia atual não são reposicionadas. A barra de canais reduzida mantém avatares proporcionais e o botão acessível de expandir/recolher.

O selo “Reel de Teste” aparece no calendário e na listagem somente quando `settings.is_trial_reel` está explicitamente habilitado (`true` ou a string legada `"true"`, sem distinção de maiúsculas). `false`, `"false"`, dados ausentes ou inválidos não exibem o selo. O filtro continua sendo Reels/vídeos. Posts importados seguem a mesma regra: vídeo, URL de Reel e origem importada não comprovam teste. A importação atual de mídia do Instagram não consulta nem persiste esse sinal; sem evidência nas configurações locais, não há selo.

## Compatibilidade

Os filtros privados respeitam organização e perfil permitido. A API pública e o MCP mantêm os parâmetros e o tamanho padrão da biblioteca. Não há migração de schema, alteração de workflows, envio de mensagens ou edição de automações. O filtro de formato da listagem classifica metadados do escopo antes de paginar; em históricos muito grandes, considerar um campo normalizado e indexado após medição.

A prévia mantém o modal centralizado em **80vw × 80vh**. O corpo e o conteúdo usam uma cadeia flex com `min-h-0`; a barra de ações não encolhe e o iframe ocupa toda a área restante, inclusive quando as ações quebram em mais de uma linha.


A edição segue o estado do post em todos os canais, incluindo Instagram: rascunhos, fila e erros sem identidade publicada usam **Editar publicação** no menu e na barra da prévia. Publicados, importados e itens com identidade remota não entram no editor de agendamento pela ação Editar. O contrato atual dos provedores não oferece atualização remota de publicações: com permissão de escrita e link HTTP(S) conhecido, **Editar na plataforma original** abre a publicação para usar as opções disponíveis na própria rede. Isso não confirma que a rede permita editar aquele formato. Sem link conhecido, ou após exclusão remota, essa ação não aparece. Duplicar/copiar permanece uma ação separada, explícita, que abre um novo composer.

O modal **Visualizar publicação** em métricas e a prévia do calendário usam o gerenciador real, com 80vw/80vh e conteúdo limitado à altura restante após o título. No calendário, desconta-se também a barra de ações; ela pode quebrar linhas em telas menores. O conteúdo longo pode rolar sem aumentar o painel. A prévia autenticada mantém `private=true`; nomes e destinatários privados continuam fora dos links públicos e de revisão. A fixture reproduzível e a limitação da evidência visual deste executor estão em [qa/preview-modal](../../qa/preview-modal/README.md).
