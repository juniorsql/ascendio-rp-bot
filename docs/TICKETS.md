# Central de atendimento — 1.3.0

## Tópicos privados: modo atual

Novos tickets são criados em tópicos **PrivateThread**, com convites de participantes desativados (`invitable: false`). O solicitante é adicionado explicitamente. A equipe acessa os tópicos por **Gerenciar tópicos**, concedido somente na central do respectivo departamento. Cada setor tem um canal fixo `atendimentos-suporte`, `atendimentos-doacoes`, `atendimentos-rp` ou `atendimentos-bug`, dentro da categoria existente.

Essas centrais são visíveis aos membros para que os solicitantes possam acessar seus tópicos, mas não permitem postar diretamente nem criar tópicos manualmente. Ver uma central não permite ver os tickets de outras pessoas. @everyone tem Gerenciar tópicos negado; somente os cargos definidos para aquele setor e o próprio bot recebem essa permissão no canal. Administradores do Discord conservam seu acesso inerente. Mudanças manuais nas sobrescritas bloqueiam novas aberturas até a administração restaurar a central com `/ticket topicos`.

O encerramento bloqueia e arquiva o tópico **no mesmo canal pai**, sem excluir, copiar mensagens ou mover para Tickets Fechados. Mensagens e anexos continuam no próprio tópico. O registro privado mantém um link para a conversa, inclusive arquivada. Usuários sem Gerenciar tópicos não podem reabrir um tópico bloqueado. A equipe com essa permissão e administradores podem reabri-lo pela interface nativa do Discord; o estado administrativo do bot permanece encerrado.

`/atendimentos` mostra uma lista privada de até 20 chamados abertos acessíveis à equipe. As autorizações são conferidas novamente antes de assumir ou encerrar. O bot não concede convite permanente adicional ao atendente ao assumir. Como em qualquer tópico privado do Discord, membros adicionados manualmente e participantes que ingressarem por outros meios seguem as regras nativas de acesso; a administração deve revisar essas participações ao mudar a equipe.

Ative com `/ticket topicos`, que prepara os quatro canais e atualiza o painel. Alternativamente, `TICKETS_USE_THREADS=true` ativa o modo na próxima inicialização. O modo e os IDs das centrais ficam persistidos em `tickets.json`; reinícios os preservam. Novas inicializações atualizam as centrais existentes, sem duplicá-las. O bot precisa criar/gerenciar tópicos e enviar mensagens neles, além das permissões anteriores de canais.

Tópicos não ocupam uma vaga por atendimento na categoria. Continuam existindo limites do Discord para tópicos ativos e o limite do bot de 200 atendimentos ativos; o sistema não é ilimitado. O índice local mantém os últimos 500 encerrados, mas não exclui tópicos anteriores. A busca de abertura interrompida verifica tópicos ativos e páginas dos arquivados pelo nome com ID completo.

Nenhum ticket antigo é convertido ou excluído. Registros anteriores sem `kind: thread` continuam operando pelo fluxo de canais descrito abaixo.

Referências: [tópicos, privacidade e arquivamento](https://docs.discord.com/developers/topics/threads), [canais e limites](https://docs.discord.com/developers/resources/channel).

## Compatibilidade com tickets antigos em canais

O painel próprio tem quatro assuntos: Suporte, Doações, Solicitar RP e Reportar bug. O solicitante preenche assunto e descrição em um formulário e recebe um link privado para o canal criado. Existe um ticket ativo por membro e um intervalo mínimo de um minuto entre aberturas. Bots não abrem nem assumem tickets.

Cada canal contém somente sobrescritas explícitas de @everyone (sem acesso), solicitante, bot e cargos responsáveis pelo departamento. Administradores do Discord continuam tendo o acesso inerente à permissão Administrator. Não se herdam os acessos genéricos da categoria. As permissões do membro são consultadas novamente a cada ação; possuir Gerenciar mensagens ou ser publicador não concede acesso ao atendimento.

## Equipes instaladas no Ascendios RP

| Assunto | Categoria existente | Equipe |
| --- | --- | --- |
| Suporte | Ticket Suporte | Administrador, Moderador e Suporte |
| Doações | Ticket Doações | CEO e Coordenador |
| Solicitar RP | Ticket Storytelling | Administrador e Storytelling |
| Reportar bug | Ticket Bugs | Administrador, Moderador, Suporte e Desenvolvedor |

O canal de entrada existente é reutilizado. Os registros ficam em um novo canal privado, `📁・registros-de-tickets`, visível ao bot e aos administradores com Administrator. Não há menções coletivas automáticas; textos do formulário são neutralizados.

## Operação

- **Assumir atendimento:** somente a equipe do departamento ou administradores. O primeiro atendente fica registrado.
- **Encerrar ticket:** o solicitante ou a equipe abre um formulário para confirmar o motivo. Não existe botão de excluir conversa.
- Nos tickets antigos em canais, o canal fica somente para leitura e vai para **Tickets Fechados**, mantendo as mesmas pessoas autorizadas. Toda a conversa permanece no Discord. Se a categoria já tiver 50 canais, o canal permanece fechado na categoria atual.
- O registro privado informa solicitante, responsável, atendente, motivo e link para o canal arquivado.
- **Não gera transcrição HTML/TXT nem baixa anexos.** Os anexos e as mensagens permanecem no canal original; se alguém excluir o canal ou uma mensagem, esse conteúdo não é recuperável por este módulo. Não há exclusão automática de tickets.

## Comandos administrativos

Exigem **Gerenciar servidor**:

- `/ticket status`: configuração, atendimentos ativos e operações pendentes.
- `/ticket canais painel logs fechados`: define canal do painel, canal privado de registros e categoria de arquivo.
- `/ticket equipe tipo categoria cargo acao`: adiciona ou remove um cargo responsável. Repita para incluir vários cargos.
- `/ticket painel`: valida a configuração e publica ou atualiza a mesma mensagem. Não republica painéis duplicados.
- `/ticket recuperar`: tenta concluir operações interrompidas. Também ocorre ao iniciar e a cada cinco minutos.

Configurar o canal de entrada não muda automaticamente os cargos que podem vê-lo; respeita-se o acesso existente do servidor. O bot precisa gerenciar canais e permissões e ter acesso às categorias de abertura e arquivo. O painel e os registros precisam permitir envio, histórico, links e anexos ao bot. O canal de registros não pode estar aberto a @everyone.

## Persistência e configuração inicial

`DATA_DIR/tickets.json` é independente do estado de publicações. Contém configuração, ID do painel e o índice dos tickets. Escritas são serializadas, sincronizadas e trocadas por rename. Uma instância por servidor. Estado inválido causa recusa de início, sem sobrescrever os dados.

`TICKETS_CONFIG` pode conter um JSON inicial com `panelChannelId`, `logChannelId`, `closedCategoryId` e `routes`. Cada chave de `routes` (`suporte`, `doacoes`, `rp`, `bug`) contém `categoryId` e `roleIds` (lista de IDs). Esse JSON só é usado quando `tickets.json` ainda não existe; as alterações administrativas posteriores ficam preservadas. Faça backup de `state.json` e `tickets.json` com o processo parado.

O índice guarda até 500 encerrados e 200 ativos. A remoção de um encerrado antigo do índice **não apaga o canal no Discord**. Não usa Message Content Intent, cache de conversas, banco externo ou dependência adicional.

## Recuperação de falhas

Antes de criar o canal, persiste-se uma reserva `creating`. O tópico `ascendio-ticket:v1:ID:MEMBRO:TIPO` permite reencontrar canais quando a resposta da API se perde. Depois de um reinício, uma reserva com canal correspondente é concluída sem criar outro. Mensagens iniciais e registros usam nonce e busca de mensagens do próprio bot para evitar duplicação após falhas.

Se uma criação ficar incerta **e nenhum canal correspondente for encontrado**, a reserva continua bloqueada. Para liberar: pare o bot, faça backup de `tickets.json`, confira no Discord a inexistência do canal pelo tópico e só então remova a reserva `creating` correspondente. Não apague reservas indiscriminadamente. Uma resposta REST definitiva de erro 4xx, exceto 429, permite nova tentativa sem essa intervenção.

Um encerramento interrompido fica `closing`. As próximas tentativas repetem o bloqueio e arquivamento, procuram o registro pelo ID e concluem o estado. Não eliminam o canal se o envio do registro falhar. Se um canal ativo for removido manualmente, a próxima abertura atualiza o índice e pede nova tentativa.
