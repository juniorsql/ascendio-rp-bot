# Verificações executadas

Data: **23/10/2026**, horário de referência America/Sao_Paulo.

## Resultado local

| Verificação | Resultado |
| --- | --- |
| Instalação das dependências pelo npm | Concluída; lockfile criado |
| TypeScript estrito, incluindo fontes e testes | Passou |
| Testes automatizados | **28 passaram, 0 falharam** |
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

## Pendências externas

Não havia token Discord, aplicação, servidor da comunidade ou conta FadeHost conectada a esta execução. Não foi fornecido repositório remoto autorizado. Portanto não foram executados login real, registro remoto, recepção real de membro, publicação real de mensagem, push para GitHub ou deploy na FadeHost. A entrega contém scripts, configuração de CI e o procedimento manual para essas etapas; nenhum resultado remoto foi presumido.

Use [ACEITE.md](ACEITE.md) para concluir e registrar a homologação operacional. Os critérios que exigem bot online ainda dependem desse aceite.
