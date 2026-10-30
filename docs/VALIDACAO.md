# Verificações executadas

Data: **23/10/2026**, horário de referência America/Sao_Paulo.

## Resultado local

| Verificação | Resultado |
| --- | --- |
| Instalação das dependências pelo npm | Concluída; lockfile criado |
| TypeScript estrito, incluindo fontes e testes | Passou |
| Testes automatizados, incluindo publicações, cargo de entrada, setores ocultos, avisos e restauração de canais | **78 passaram, 0 falharam** |
| Compilação para `dist/` | Passou |
| Testes executados diretamente com Node 24.22.1 | 28 passaram |
| Criação e destruição de cliente Discord sem login, heap V8 de 128 MB | Passou; RSS observado de aproximadamente **76 MB** |
| Diagnóstico compilado com ambiente sintético e diretório temporário | Passou |
| Importação compilada de configuração com backup do estado | Passou |
| Inicialização compilada sem token | Recusada com exit code 1 e mensagem de configuração, sem vazar segredos |
| `npm audit` e `npm audit --omit=dev` | **Nenhuma vulnerabilidade reportada** na consulta |

O computador tinha Node 24.14.1; o Node 24.22.1 foi executado pontualmente pelo npm para validar a versão indicada, sem alterar a instalação global. O consumo de memória acima é uma medição pontual de cliente sem conexão e **não comprova o consumo online ou sob carga na FadeHost**.

## O que os testes cobrem

- Composição em modal, prévia privada e confirmação por botão.
- Cancelamento, seleção de cor, abertura de edição e expiração de rascunhos.
- Regras demonstrativas, aprovação de uma categoria e persistência da configuração.
- Recepção de novos membros, menção individual e exclusão de bots/outros servidores.
- Bloqueio de usuário comum, distinção entre publicador e configurador e perda de permissão antes de confirmar.
- URL inválida, cores, campos, textos e limites de embeds individuais/agregados.
- Permissões do bot no destino, cancelamento concorrente com confirmação e duplo clique.
- Deduplicação por conteúdo/canal, reserva antes da API e persistência de envio incerto após reinício.
- Falha de disco anterior ao envio, estado inválido, serialização de transações e retenção da auditoria.
- Logs que não serializam o conteúdo de erros REST.
- Ativação e desativação explícita de `@everyone`, prévia sem notificações e envio somente após confirmação; bloqueio por permissão do autor ou do bot, inclusive quando removida após ativar; falha na atualização da prévia sem ativação silenciosa; trava contra alteração durante envio e deduplicação preservada ao alternar a notificação.

O caminho de publicação com `@everyone` foi testado com canais simulados. Nenhuma notificação coletiva foi enviada automaticamente ao servidor durante o desenvolvimento.

Os fluxos de Discord são simulados com interações e canais controlados. Eles exercitam o roteamento real do código, mas não comprovam aceitação dos payloads ou eventos pelo serviço remoto.

## Reproduzir

Com Node 24.22.1 instalado:

```powershell
npm ci
npm run check
npm run verify:offline
npm audit
```

`verify:offline` usa credenciais sintéticas somente para testar validação e arquivos. Não autentica, não registra comandos e não usa rede. Os arquivos temporários são removidos ao terminar. A auditoria de pacotes consulta o registro npm e representa o estado conhecido naquele momento.

## Implantação e conexão reais — 24/10/2026

- Repositório publicado em `https://github.com/juniorsql/ascendio-rp-bot`, tornado público com autorização expressa do responsável. `.env` e `data/` permanecem ignorados.
- Token validado pela API do Discord, com ID de aplicação correspondente à configuração.
- Conexão real ao Gateway com `Guilds` e `GuildMembers` concluída; servidor Ascendios RP identificado.
- Comandos de servidor registrados com sucesso.
- Aplicação criada na FadeHost: `ascendio-rp-bot`, plano **free**, **256 MB**, branch `main`, dados em `/data/ascendio`, sem endereço web.
- O deploy atualizado compilou e os logs registraram `bot_online`, `nodeVersion: v24.22.1`, RSS de **168 MB** no início e `commands_registered`. O ambiente padrão da FadeHost usa Node 22.23.4; o projeto instala Node 24.22.1 como runtime local dos scripts npm. A medição é pontual e não constitui teste de carga.
- Após esse ajuste: TypeScript, 28 testes, compilação e `verify:offline` passaram novamente com Node 24.22.1.
- Após o responsável ajustar o cargo do bot, a verificação real confirmou **Ver canal**, **Enviar mensagens** e **Inserir links** nos canais `🚪・portão` e `📦・logs`. A FadeHost informou o processo em execução, **145 MB de 256 MB** e **zero reinícios** nessa consulta.
- Não foi simulada entrada de membro real nem enviado anúncio público automaticamente. O fluxo de prévia e confirmação continua sujeito ao aceite da equipe no Discord.

## Pendências externas originais

Na entrega inicial de 23/10/2026 ainda não havia credenciais ou contas conectadas. As etapas efetivamente realizadas em 24/10 estão registradas acima. A execução de CI do commit de runtime foi impedida pelo GitHub: a anotação do job informa bloqueio da conta por questão de cobrança. A CI remota não foi considerada aprovada. Os testes locais estão registrados separadamente; a compilação e o início na FadeHost foram confirmados nos logs. A cobrança da conta GitHub deve ser revisada pelo titular para que o Actions volte a executar.

Use [ACEITE.md](ACEITE.md) para concluir e registrar a homologação operacional. Os critérios que exigem bot online ainda dependem desse aceite.

## Tickets — 24/10/2026

- 13 testes adicionais: painel idempotente, privacidade e isolamento, usuário comum, concorrência, duplicidade entre assuntos, falta de disco, criação com resultado incerto, recuperação após reinício, permissões atuais de equipe, fechamento somente leitura, logs indisponíveis, categoria cheia e estado corrompido.
- Teste real pela API do Discord usando um canal temporário privado: abertura, bloqueio de @everyone, recuperação com outro objeto de armazenamento, retorno do mesmo ticket para outro assunto, assumir atendimento, fechamento somente leitura, mudança de categoria e registro privado passaram. Canal e mensagem de registro temporários foram removidos ao concluir.
- O teste real invocou os serviços internos autenticados. O formulário e roteamento de interações são cobertos por testes simulados; o clique no painel pela conta humana ainda precisa do aceite do responsável.

## Tópicos privados — 27/10/2026

- Testes de migração idempotente, reutilização de quatro centrais, isolamento entre equipes, bloqueio por sobrescritas adulteradas, abertura interrompida antes do convite, resultado REST incerto com tópico arquivado, retomada do fechamento e compatibilidade com tickets antigos. `/atendimentos` testa resposta privada e bloqueio de usuário comum.
- Teste real autenticado: quatro centrais fixas criadas, tópico privado com `invitable=false`, solicitante adicionado, persistência após reabrir armazenamento, prevenção de duplicidade, assumir, encerrar, `archived=true`, `locked=true` e mensagem original acessível. Todos os canais anteriores permaneceram presentes; **zero exclusões**. O tópico de teste foi preservado arquivado.
- O teste real usa serviços internos e uma conta administrativa como solicitante. A privacidade dos membros comuns é coberta pelos testes de permissões e por inspeção das sobrescritas reais; a experiência com uma conta humana comum ainda requer aceite no Discord.

## Centrais ocultas — 29/10/2026

- Seis testes adicionais: centrais invisíveis antes da abertura, liberação apenas do setor escolhido, isolamento de tópicos entre solicitantes com o mesmo cargo, manutenção de acesso ao histórico após encerrar/reiniciar, falha de atribuição sem criar tópico, migração de participantes de tópicos arquivados e bloqueio de cargo de acesso adulterado.
- Teste real: quatro cargos de acesso sem permissões globais, quatro centrais ocultas para a combinação @everyone + Convidado, liberação somente do setor com cargo correspondente, sem Gerenciar tópicos para solicitantes, atribuição real do cargo, abertura e encerramento com tópico arquivado/bloqueado. Todos os canais anteriores preservados; nenhuma exclusão. O teste usa uma conta administrativa e cálculo das permissões reais com papéis sintéticos de convidado.

## Avisos de abertura — 29/10/2026

- Seis testes adicionais: menções limitadas à equipe do setor, proteção contra texto malicioso no formulário, envio idempotente após nova solicitação/reinício, falha definitiva com retomada, resposta perdida após envio e recuperação sem duplicação, bloqueio por permissões adulteradas e compatibilidade sem notificações retroativas. Reservas de envio incerto não são repetidas sem comprovação.
- TypeScript estrito, 75 testes e compilação passaram. Quatro canais privados de avisos foram preparados na API real e suas sobrescritas verificadas. O cálculo de permissões para @everyone + Convidado + os quatro cargos de acesso confirmou que nenhum aviso fica visível a solicitantes.
- Não foi encontrado um ticket ativo do proprietário para comprovar um aviso de abertura real nessa verificação. O recebimento da menção pela equipe deve ser conferido na próxima abertura pelo painel; notificações push e som dependem das configurações individuais do Discord.

## Restauração do modo tradicional — 30/10/2026

- Três testes adicionais cobrem a transição sem alterar tickets existentes, encerramento de tópicos anteriores, abertura em canal individual, aviso direto idempotente, persistência após reiniciar, encerramento somente leitura em Tickets Fechados e registro com link.
- Doações testa menção somente ao usuário autorizado, sem ping de cargo ou @everyone. Destinatário sem cargo é bloqueado; permissões adulteradas no canal impedem envio do aviso.
- A restauração não exclui canais, tópicos, mensagens ou registros antigos. Os testes existentes continuam cobrindo categoria com 50 canais, falha no registro, isolamento de acesso e recuperação de aberturas incertas.
- Teste real autenticado em Doações: criou um canal privado individual, mencionou somente o proprietário, persistiu a confirmação do aviso, encerrou somente para leitura, moveu para Tickets Fechados e enviou registro com link. O canal de teste foi preservado, sem exclusão. Todos os canais anteriores permaneceram presentes. O teste invoca os serviços internos; a interação humana no painel continua sujeita ao aceite.
