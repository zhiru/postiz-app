# Comparação de forks — 2026-10-22

Consulta de código/commits via API do GitHub, sem executar ferramentas ou importar configurações dos forks. A contagem de commits não equivale à quantidade de recursos. Comparação pontual, sem auditoria completa ou teste de produção desses forks.

## Recomendação

Manter nossa base Robo MultiPost/Postiz e selecionar mudanças pequenas. Os 11 commits oficiais desta rodada permanecem uma importação separada; os forks abaixo são candidatos para etapas futuras, não alterações automáticas de autenticação, monitoramento, mensagens ou provedores.

| Fonte | Evidência e utilidade para nós | Próximo passo sugerido |
| --- | --- | --- |
| [PostQueen](https://github.com/GkhanKINAY/postqueen-app) | Navegação anterior/próximo na prévia, inclusive entre páginas (d77d09e3); uploadLinkTool para arquivos locais via tickets temporários (8dfbf1c8); resposta SSE sem buffering no nginx (6119c9e8); verificação de workers em execução (b821765e). | Priorizar prévia e upload local no MCP. Revisar SSE e saúde dos workers em nosso transporte/process manager antes de portar. |
| [ViralGenHub](https://github.com/Joeyblack1/viralgenhub/commits/main/) | Tokens de ativação/recuperação com finalidade separada e validade, recusados como sessão (1f722774); editor TikTok orientado por creator_info, privacidade e divulgação de marca (6a3f146e). Nosso auth ainda usa JWT compartilhado nesses caminhos, então a proposta de finalidade merece revisão prioritária. | Revisão de segurança dedicada e regressões antes de alterar autenticação. TikTok é útil quando essa rede virar prioridade. |
| [mwakidenis](https://github.com/gitroomhq/postiz-app/compare/main...mwakidenis:postiz-app:main) | A comparação mostra apenas .github/workflows/main.yml e updates.txt. Os milhares de commits exclusivos são atualizações automáticas de timestamp. | Não há recurso de produto identificado para portar nessa diferença. |

## O que não é novidade para nossa instância

Calendário multicanal, MCP para ChatGPT/Claude, agendamento via agentes, geração por IA, métricas e branding têm equivalentes na nossa base. Alterações de marca, moeda, preços e infraestrutura dos forks não devem substituir nossas configurações. Nosso uso self-hosted já evita o paywall comercial; os planos Free/Creator/Business do ViralGenHub não são prioridade.

O PostQueen está muito divergente do oficial: a API de comparação retornou 300 arquivos (limite da resposta) e 250 commits recentes, com 1.565 commits exclusivos e 152 do oficial ausentes no momento da consulta. O ViralGenHub tinha 14 exclusivos e 119 ausentes. Esses números são uma fotografia da consulta e não justificam um merge integral.

## Fontes de código

- [PostQueen — prévia](https://github.com/GkhanKINAY/postqueen-app/commit/d77d09e3)
- [PostQueen — upload MCP](https://github.com/GkhanKINAY/postqueen-app/commit/8dfbf1c8)
- [PostQueen — SSE](https://github.com/GkhanKINAY/postqueen-app/commit/6119c9e8)
- [PostQueen — worker](https://github.com/GkhanKINAY/postqueen-app/commit/b821765e)
- [ViralGenHub — tokens por finalidade](https://github.com/Joeyblack1/viralgenhub/commit/1f722774)
- [ViralGenHub — TikTok](https://github.com/Joeyblack1/viralgenhub/commit/6a3f146e)
