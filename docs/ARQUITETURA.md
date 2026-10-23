# Decisões da primeira versão

## Limites operacionais

Uma aplicação, um servidor e um processo. Intents `Guilds` e `GuildMembers`; nenhum acesso a mensagens comuns ou presenças. Caches de membros e usuários têm limite e varredura; mensagens e reações não são armazenadas. O processo publica imagens por URL sem baixar arquivos. Não há servidor HTTP.

## Publicação

As definições slash são independentes do roteamento. Formulários produzem um `Post`, e templates convertem esse modelo em objetos `APIEmbed`, com validação dos limites agregados. Uma prévia privada guarda a representação que será enviada. Só seu autor, ainda autorizado no servidor, pode confirmá-la.

`Drafts` limita quantidade e duração dos rascunhos. A trava em memória é ativada antes das esperas da confirmação para evitar corridas com cancelamento e edição. `publish` mantém uma reserva durável, envia usando nonce estável e conclui o recibo; o hash por conteúdo e canal impede repetição próxima, independentemente do autor. Um erro com resultado incerto mantém a reserva para análise do operador.

## Persistência e auditoria

`Store.transact` trabalha sobre cópia do estado, valida a configuração, escreve e sincroniza um temporário e faz rename antes de publicar a nova cópia em memória. Falhas deixam a fila disponível para próximas operações, sem aplicar mutações incompletas em memória. O armazenamento não implementa consenso, trava entre processos ou transação distribuída com o Discord. Use uma única instância.

Os registros persistentes são limitados e não constituem trilha de auditoria imutável. O console recebe metadados permitidos e códigos de erro, sem serializar objetos de erro externos ou conteúdos. O canal privado de logs é complementar; falha nele não transforma uma publicação bem-sucedida em falha de envio.

## Caminho para um painel

O painel deve usar autenticação OAuth2 do Discord e resolver a autorização no servidor a cada ação sensível. Ele poderá reutilizar templates, validações e o serviço de publicação. Antes de executar painel e bot em processos distintos, migre `Store` e a idempotência para banco transacional compartilhado. Não exponha o token ao navegador, não aceite channelId sem conferir guild e permissões e não transforme URLs de imagem em downloads arbitrários no servidor.
