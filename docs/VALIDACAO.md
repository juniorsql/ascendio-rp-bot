# Verificações executadas

Data: **23/10/2026**, horário de referência America/Sao_Paulo.

## Resultado local

| Verificação | Resultado |
| --- | --- |
| Instalação das dependências pelo npm | Concluída; lockfile criado |
| TypeScript estrito, incluindo fontes e testes | Passou |
| Testes automatizados, incluindo notificação opcional e tickets | **48 passaram, 0 falharam** |
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
