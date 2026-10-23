# Calendário, listagem e prévia

## Origem do reaproveitamento

Trechos adaptados de [GkhanKINAY/postqueen-app](https://github.com/GkhanKINAY/postqueen-app/tree/f8e33f52067c18efd6f958ed70bb708522aa6bdf), commit `f8e33f52067c18efd6f958ed70bb708522aa6bdf` (AGPL-3.0, mesma licença desta base).

- `calendar.tsx`: leitura da primeira mídia e renderização da miniatura, indicação de vídeo e composição compacta dos cards mensais.
- `calendar.context.tsx`: períodos rápidos da listagem; adaptados para limites UTC enviados ao servidor, antes da contagem e paginação.
- Referência de interação móvel: seletor de dias seguido da agenda; reutiliza nosso `DayView`, sem outro fluxo de criação ou agendamento.

Não foi importado o calendário inteiro: menu ancorado, permissões, edição, revisão, erros, rascunhos atrasados, exclusão remota, filtros de formato/status e atualização reativa continuam usando nossa implementação. A data passada de uma publicação em fila nunca é interpretada como confirmação de publicação.

## Prévia

- Modal centralizado com `size: 80vw` e `height: 80vh`, usando o gerenciador de modais existente.
- O conteúdo da rota `/p/:id` permanece no aplicativo, com rolagem interna. Nenhuma nova aba é criada.
- O iframe mostra carregamento e exige o marcador SSR `data-post-preview-content` para confirmar que uma prévia real carregou; eventos iniciais `about:blank` são ignorados.
- Após erro ou 20 segundos sem carregamento, exibe uma mensagem e **Tentar novamente**. Uma resposta tardia válida ainda pode recuperar a prévia.
- Fechar não salva, agenda, publica ou altera filtros e paginação.

## Miniaturas e calendário móvel

`mediaPreview: { src, video } | null` é derivado da primeira mídia na lista privada e no calendário privado. Não expõe o JSON completo de mídias, configurações ou credenciais. Consultas públicas existentes mantêm seu contrato.

Imagens carregam sob demanda. Vídeos usam a capa quando disponível; sem capa, usam um elemento silencioso com `preload=metadata`, sem reprodução automática. Cards publicados mantêm cores e o indicador verde; atrasados mantêm o X vermelho. O menu de ações continua acessível nos cards compactos.

Na semana móvel, escolher um dia abre seus horários. No mês móvel, dias com posts recebem um ponto e a agenda fica abaixo do seletor. Dias externos ao mês são desabilitados, pois os dados desse mês não foram consultados. Os controles anterior/próximo continuam disponíveis para mudar o mês.

## Períodos da lista

Todos, hoje, amanhã, ontem, semana atual, próximos sete dias, mês atual e dia específico. O dia específico oferece anterior/próximo. O cabeçalho de cada dia da lista abre esse dia no calendário; o número do dia no mês abre a lista desse dia. A ordem pode seguir o padrão de cada estado, ou ser explicitamente crescente/decrescente.

A lista envia `order=asc|desc` opcional e `startDate`/`endDate` em ISO 8601 UTC ao `GET /posts/list`, calculados no fuso selecionado pelo usuário, incluindo limites de horário de verão. Esses parâmetros são opcionais e validados pelo DTO. O repositório combina o período com os demais filtros e com organização/perfil **antes** de `count`, `skip` e `take`. Mudar período volta à primeira página. A virada do dia recalcula períodos relativos, inclusive com a tela aberta.

Exemplo interno:

```http
GET /posts/list?page=0&limit=20&state=draft&startDate=2026-10-23T03%3A00%3A00.000Z&endDate=2026-10-24T02%3A59%3A59.999Z
```

O período restringe a consulta; não muda datas nem ativa agendamento. Os filtros existentes de canal, status, formato e busca permanecem combináveis.

## Validação

Regressões de iframe vazio/erro/repetição, tamanho solicitado, menu, miniaturas/JSON legado, estado em fila, limites UTC e horário de verão, virada de dia no SWR, filtros antes da paginação e isolamento por perfil. A conferência visual local usa os componentes reais com dados fictícios e serviços externos substituídos; não envia mensagens ou publica posts reais.

Nenhuma alteração de schema, workflow, atividade, credencial ou configuração da automação. Publicação em produção é uma etapa separada.

O painel opcional de posts ao lado do calendário continua no backlog da issue #58; esta entrega mantém calendário e lista como visões independentes.
