# Ascendio RP Bot

Bot modular de Discord para a comunidade brasileira Ascendio RP. Publicações em português, identidade sóbria em dourado, bordô, azul-noturno e marfim, boas-vindas automáticas e configuração pelo próprio Discord.

**Estado da entrega:** implementação, verificações locais, publicação no GitHub, autenticação real, registro dos comandos e deploy gratuito executados. O acesso aos canais privados de boas-vindas e logs foi confirmado; o aceite final do fluxo com membros reais e publicações pela equipe permanece em aberto. O token não faz parte do repositório. Consulte [VALIDACAO.md](docs/VALIDACAO.md) para as verificações e pendências.

## 1. Requisitos e versões

- Runtime do bot: **Node.js 24.22.1 LTS**, indicado em `.nvmrc` e instalado como dependência de produção. O Node do ambiente precisa ser >=22.12 para executar a instalação pelo npm.
- Discord.js **14.27.0**, TypeScript **7.0.2**; versões e dependências transitivas fixadas no `package-lock.json`.
- Um bot e um servidor Discord; uma instância deste processo para esse servidor.
- Sem banco externo, painel web, música ou downloads de mídia. Dependências diretas de produção: `discord.js` e o binário do Node usado para compatibilidade com a hospedagem.

A [documentação atual do Discord.js](https://discord.js.org/docs) informa Node >=24.17.0. O manifesto npm da versão consultada declara um mínimo inferior; adotamos o requisito mais conservador da documentação e verificamos o cliente com Node 24.22.1. A [linha 24 é LTS](https://nodejs.org/en/about/previous-releases).

A FadeHost deste deploy usa Node 22.23.4 no ambiente padrão. Por isso o projeto instala o pacote `node@24.22.1`: dentro dos scripts npm, o executável local tem precedência no PATH. Use **`npm start`**, para que o bot execute com Node 24; executar `node dist/index.js` diretamente com o Node 22 global será recusado. O evento `bot_online` informa `nodeVersion` para confirmar o runtime real. Mantenha os scripts de instalação habilitados em `npm ci`, pois o pacote instala o binário específico da plataforma. O binário ocupa espaço em disco; não adiciona um segundo processo Node à execução do bot. Não há Docker obrigatório no plano gratuito.

## 2. Criar a aplicação no Discord

1. Abra o [Discord Developer Portal](https://discord.com/developers/applications), selecione **New Application** e nomeie a aplicação como **Ascendio RP**.
2. Em **General Information**, copie o **Application ID**: será `DISCORD_CLIENT_ID`.
3. Em **Bot**, crie/redefina o token e salve-o diretamente no `.env` local ou no campo secreto da FadeHost. Nunca cole o token no chat, em issues, capturas ou commits.
4. Em **Bot → Privileged Gateway Intents**, habilite **Server Members Intent**, necessário para receber entradas de membros. O código usa apenas `Guilds` e `GuildMembers`. Deixe **Message Content** e **Presence Intent** desligados.
5. No Discord, ative **Configurações do usuário → Avançado → Modo desenvolvedor**. Clique com o botão direito no servidor → **Copiar ID**: será `DISCORD_GUILD_ID`.
6. Em **Installation** ou **OAuth2 → URL Generator**, escolha instalação em servidor e os escopos `bot` e `applications.commands`. Marque somente **View Channels**, **Send Messages** e **Embed Links**. Não é necessário conceder Administrator, Manage Roles ou Manage Messages ao bot.
7. Abra a URL gerada e escolha o servidor correto. Exemplo de formato, substituindo o ID:

```text
https://discord.com/oauth2/authorize?client_id=SEU_APPLICATION_ID&scope=bot%20applications.commands&permissions=19456
```

Confira também as substituições de permissões dos canais; elas podem bloquear o bot mesmo que o cargo permita enviar mensagens. O bot funciona em canais de texto e de anúncios, sem threads, fóruns ou DMs. `/evento` publica um comunicado de evento; não cria um Evento Agendado nativo do Discord. Canais de anúncios recebem a mensagem, sem distribuição automática aos seguidores.

Referências: [Gateway e intents](https://docs.discord.com/developers/events/gateway), [OAuth2](https://docs.discord.com/developers/topics/oauth2), [permissões](https://docs.discord.com/developers/topics/permissions).

## 3. Instalação local

Abra o terminal **nesta pasta**, onde está o `package.json`:

```powershell
node --version
npm ci
Copy-Item .env.example .env
```

Edite `.env` no seu computador, usando os IDs reais. O arquivo é ignorado pelo Git:

```dotenv
DISCORD_TOKEN=preencher_exclusivamente_no_ambiente_secreto
DISCORD_CLIENT_ID=ID_DA_APLICACAO
DISCORD_GUILD_ID=ID_DO_SERVIDOR
DATA_DIR=./data
REGISTER_COMMANDS_ON_START=true
```

Depois execute:

```powershell
npm run check
npm run doctor
npm start
```

`doctor` verifica ambiente e acesso ao arquivo de estado, sem se conectar ao Discord. `npm start` executa o JavaScript compilado com heap V8 limitado a 128 MB; isso **não** limita a memória total do processo a 128 MB. `npm run dev` oferece reinicialização em desenvolvimento e usa mais memória.

### Registrar comandos

Com `REGISTER_COMMANDS_ON_START=true`, o bot registra os comandos **somente no servidor configurado** depois de autenticar. Procure `commands_registered` no console. Para executar separadamente:

```powershell
npm run build
npm run register
```

O registro substitui a lista de comandos de servidor desta aplicação. Use uma aplicação dedicada ao Ascendio RP. Não altera comandos de outros bots. Para evitar registros a cada reinício, configure `REGISTER_COMMANDS_ON_START=false` depois da primeira inicialização e registre novamente sempre que mudar as definições.

## 4. Comandos e operação

| Comando | Função |
| --- | --- |
| `/ajuda` | Orientações privadas para membros e equipe |
| `/anuncio canal tipo` | Oito tipos: comunicado, atualização, spoiler, evento, manutenção, inscrições, regras e novidade |
| `/evento canal` | Atalho para anúncio de evento |
| `/spoiler canal` | Atalho para spoiler |
| `/comunicado canal` | Atalho para comunicado oficial |
| `/regras canal` | Prévia das oito categorias de regulamento e confirmação antes de publicar |
| `/configurar ver` | Canais, cargos e quantidade de regras oficiais |
| `/configurar canal uso destino` | Define boas-vindas, logs ou canal de regras; omitir destino desativa |
| `/configurar cargo cargo acao` | Adiciona ou remove um cargo de publicadores |
| `/configurar identidade` | Nome do servidor, rodapé e URL de logotipo |
| `/configurar boas-vindas` | Edita título e mensagem com `{membro}`, `{servidor}` e `{regras}` |
| `/configurar template tipo` | Cor, rodapé, imagem e miniatura por tipo |
| `/configurar regra categoria` | Edita título, texto e status oficial de uma categoria |
| `/configurar testar-boas-vindas` | Mostra a recepção em prévia privada |
| `/configurar historico` | Últimas ações e quantidade de envios incertos |
| `/configurar exportar` | Baixa a configuração em JSON, sem variáveis secretas |

### Primeira configuração

1. Com permissão **Gerenciar servidor**, defina os canais de boas-vindas, regras e logs usando `/configurar canal`.
2. Ajuste nome, rodapé, logotipo e templates. Imagens são opcionais; nenhum logotipo de terceiros acompanha o projeto.
3. Revise `/configurar testar-boas-vindas`.
4. Edite cada uma das oito categorias por `/configurar regra`. Digite `sim` em **Conteúdo oficial?** somente depois de aprovar o texto. As categorias começam com marcação **DEMONSTRAÇÃO — NÃO OFICIAL**. A publicação preserva o status de cada categoria.
5. Crie uma prévia de regulamento com `/regras` e confirme a publicação depois da revisão.

Alterações são persistidas imediatamente e não exigem recompilação. Os IDs opcionais de `.env.example` são apenas sementes da primeira criação de `state.json`; depois disso, use os comandos. Alterar essas variáveis não substitui uma configuração já salva.

### Publicar

Escolha um comando e o canal. O formulário possui título, descrição Markdown, imagem, miniatura e campos adicionais. Para campos, use uma linha por campo:

```text
Data | 31/10, às 20h (Brasília) | sim
Local | Salão principal | sim
Inscrições | Consulte a equipe responsável | nao
```

São permitidos dez campos no formulário. `sim` exibe o campo lado a lado quando o Discord tiver espaço. Use URLs HTTPS de arquivos de imagem públicos. O bot valida o endereço, mas não baixa a imagem e não verifica seu MIME, existência ou licença; a renderização depende do Discord. Domínios podem resolver para redes privadas: o bot nunca os acessa diretamente. Use preferencialmente o CDN do Discord ou um provedor público da comunidade.

A prévia é privada, informa o destino e oferece **Publicar**, **Cancelar**, **Editar conteúdo** e um menu de cores. Ela expira 15 minutos após a criação. Há até cinco rascunhos por autor e cem no total; rascunhos não sobrevivem ao reinício. Nenhuma publicação é enviada antes da confirmação. Um rascunho preserva o conteúdo visual aprovado; mudanças posteriores na configuração só se refletem quando ele é editado ou recriado.

Limites são verificados antes do envio: até dez embeds e 6.000 caracteres somados por mensagem, título de 256, descrição de 4.096 e limites dos campos. O formulário usa descrição de até 4.000; o regulamento limita cada categoria a 500 caracteres para caber em uma única mensagem. [Limites oficiais](https://docs.discord.com/developers/resources/message#embed-object).

### Permissões da equipe

- Publicações: **Gerenciar mensagens**, **Administrador** ou cargo incluído em `/configurar cargo`.
- Configurações e exportação: **Gerenciar servidor** ou **Administrador**. Um cargo de publicador não concede acesso à configuração.
- O autor também precisa conseguir **ver e enviar mensagens no canal de destino**.
- A identidade e as permissões são conferidas novamente em formulários, botões e confirmação. Remover o cargo antes de publicar bloqueia a ação.

Os slash commands de publicação têm permissão padrão **Gerenciar mensagens**. Se quiser publicadores autorizados por cargo sem essa permissão ampla, um administrador deve também liberar esses comandos para o cargo em **Configurações do servidor → Integrações → Ascendio RP → Comandos**. A lista de cargos do bot, isoladamente, não muda a visibilidade dos comandos no Discord. Liberar a visibilidade não remove as verificações internas. Não libere `/configurar` a publicadores.

Menções de usuário/cargo e `@everyone`/`@here` são neutralizadas em textos de publicação; todos os envios usam `allowedMentions` restritivo. Boas-vindas permite mencionar exclusivamente o novo membro. Entradas de outros bots são ignoradas.

## 5. GitHub

Use **um repositório dedicado**, com o conteúdo desta pasta na raiz. Não envie o diretório pai, que contém outros projetos. A entrega inclui um repositório Git local; consulte `git status` e `git log -1`.

1. Entre na sua conta GitHub e crie `ascendio-rp-bot`, público ou privado, **sem inicializar README ou .gitignore remotos**.
2. No terminal desta pasta, conecte o endereço que o GitHub forneceu:

```powershell
git remote add origin https://github.com/SEU_USUARIO/ascendio-rp-bot.git
git push -u origin HEAD:main
```

3. Autentique pelo Git Credential Manager, navegador ou GitHub Desktop. Nunca coloque credenciais na URL do remote.
4. Depois, use `git push origin HEAD:main` para atualizar. A branch local pode ter o prefixo `codex/`; o destino acima é `main`.

`node_modules`, `dist`, dados, `.env` e logs são ignorados. O lockfile e `.env.example` devem ser versionados. A integração contínua em `.github/workflows/ci.yml` executa instalação, TypeScript, testes, build e auditoria das dependências de produção. Se um token aparecer em um commit, gere outro no Developer Portal e remova o segredo do histórico antes de compartilhar o repositório.

## 6. FadeHost

Procedimento baseado nas páginas oficiais consultadas em **23/10/2026**: [hospedagem de bots](https://fadehost.com/docs/discord-bot-hosting/), [aplicativos e armazenamento](https://fadehost.com/docs/app-hosting/) e [condições do gratuito](https://fadehost.com/docs/app-free-plan/). Os rótulos podem variar conforme a versão do painel.

1. Verifique o e-mail da conta. Em **Bots → Host a bot** (ou a seção Aplicativos e bots), selecione **Discord bot**, depois **seu repositório**, e informe a URL do GitHub. Autorize a integração e o acesso a esse repositório caso o painel solicite; repositórios privados precisam dessa autorização.
2. Escolha a branch `main`, Node.js e o plano gratuito disponível na conta. Este repositório já tem o `package.json` na raiz.
3. Cole o token **no campo secreto do bot**. A FadeHost o disponibiliza como `DISCORD_TOKEN`.
4. Em **Settings → Environment variables**, cadastre os demais valores:

```dotenv
DISCORD_CLIENT_ID=ID_DA_APLICACAO
DISCORD_GUILD_ID=ID_DO_SERVIDOR
DATA_DIR=/data/ascendio
REGISTER_COMMANDS_ON_START=true
```

5. Em **Build & start**, configure o build como `npm run build` e a inicialização como `npm start`. A documentação informa instalação de devDependencies para o build. Use `npm ci` se houver um campo próprio de instalação; mantenha o lockfile e não use `--ignore-scripts`. Confira `nodeVersion` no evento `bot_online`, conforme a seção 1. Não configure `npm run dev` em produção.
6. Clique em **Deploy** e acompanhe o **Console**: build concluído, `bot_online` e `commands_registered`. `bot_online` indica autenticação; o funcionamento completo depende também de `commands_registered`, dos canais e das permissões.
7. Mantenha **Web address desativado**. Este bot usa conexão de saída para o Gateway e não necessita porta pública, servidor HTTP ou pings.
8. Para reiniciar, use **Restart**. Para atualizar, faça commit e push para `main`; a integração documenta deploy automático. Use **Redeploy** quando necessário. Em caso de regressão, consulte o histórico e **Rollback**; isso não reverte o arquivo de configuração persistente.

### Limitações verificadas do plano gratuito

A página específica do plano informa **um app por pessoa/conta verificada, 256 MB de RAM, 0,25 vCPU, 3 GB em `/data` e 1 GB de tráfego por dia**. Exceder o tráfego pode bloquear o app por 24 horas. A região é automática e as saídas seguem uma lista fixa; confira no Firewall a comunicação com Discord.

**Há confirmação periódica de uso:** se você não abrir o painel, a documentação informa e-mail a cada quatro dias, com dois dias para responder; sem resposta, o app pode parar. Essa condição é mais específica que a página comercial que anuncia ausência de renovações diárias. Siga os avisos reais da conta. Com Web address desativado, o processo não dorme por falta de visitas HTTP, mas isso não elimina a confirmação de uso.

Banco gerenciado não foi tratado como benefício gratuito. Backups automáticos são um adicional pago. Não há garantia de que a carga real ficará abaixo de 256 MB; monitore **Plan and usage**, o campo `rssMB` dos logs e os reinícios por memória. Os caches são limitados, o regulamento cabe em uma mensagem e o registro local tem retenção limitada. Builds podem consumir mais memória que a execução; se o build atingir o limite, use uma etapa de compilação com mais recursos ou avalie outro plano, conforme o suporte da hospedagem. Não há Dockerfile obrigatório nesta entrega.

### Testar com o computador desligado

Depois do deploy, encerre qualquer cópia local do bot. Desligue o computador e use o Discord no celular: execute `/ajuda`, publique um comunicado de teste e faça uma conta de teste entrar no servidor. As mensagens precisam continuar chegando. Ao voltar, confira logs, memória e persistência depois de um **Restart** e de um novo deploy.

## 7. Persistência, backups e envio incerto

`DATA_DIR/state.json` guarda configuração, até mil eventos administrativos e até dois mil recibos recentes/pendentes. As escritas são serializadas, feitas em arquivo temporário, sincronizadas e renomeadas. Um estado inválido interrompe a inicialização em vez de apagar os dados. IDs e horários são registrados; o logger não serializa tokens, conteúdo de anúncios, erros REST completos ou variáveis de ambiente.

Na FadeHost, use `/data/ascendio`, **fora de `/data/app`**: o checkout do código é substituído nos deploys. Em outros provedores, só use o armazenamento local se houver volume persistente. O armazenamento por arquivo suporta uma instância; não execute dois processos, importadores ou réplicas sobre o mesmo diretório. A exclusão do app/volume pode remover seus dados.

Use `/configurar exportar` após alterações importantes e guarde o JSON em local restrito. Para backup completo, com o bot parado copie o diretório de dados para outro local seguro. A exportação de configuração não inclui auditoria ou recibos e não substitui um backup completo.

Para restaurar só a configuração, **pare o bot**, envie o JSON ao ambiente e execute:

```powershell
npm run config:import -- caminho/ascendio-config.json --bot-stopped
```

O importador valida o conteúdo, cria uma cópia `state.json.backup-<horário>` e mantém auditoria/recibos. Use o mesmo `DATA_DIR` do bot e apague backups antigos quando não forem mais necessários. O parâmetro confirma sua responsabilidade de parar o processo; não há trava entre processos. Reinicie e confira `/configurar ver`.

### Prevenção de duplicidade

Cada confirmação reserva a publicação no disco **antes** de chamar o Discord. Cliques simultâneos e conteúdo idêntico no mesmo canal são bloqueados; o conteúdo é comparado sem o timestamp por dez minutos. O envio também usa `nonce` e `enforceNonce` do Discord. Recibos concluídos são limpos após 24 horas nas próximas transações; reservas incertas não expiram automaticamente.

Uma queda entre a aceitação da mensagem pelo Discord e a gravação do recibo pode deixar o status `sending`. Não existe transação atômica entre um arquivo e a API do Discord. Nesse caso, o bot mantém a reserva e pede conferência; **não reenvia automaticamente**. A deduplicação não protege contra alterações intencionais no texto para produzir outro hash.

Recuperação: consulte `/configurar historico`, confira o canal de destino e **pare o bot**. Faça backup de `state.json`. No recibo correspondente, se a mensagem existe, informe `status: "sent"` e `messageId` com o ID real; se tiver certeza de que não foi publicada, remova apenas aquele recibo pendente. Preserve o restante do JSON. Reinicie, confira os logs e crie uma nova prévia se necessário. Não remova reservas em massa. Esse procedimento é excepcional e exige acesso de operador ao arquivo.

## 8. Diagnóstico

| Situação | Verificação |
| --- | --- |
| `startup_failed` / variável ausente | Complete Environment e confira os IDs. O valor do token não é exibido |
| `TokenInvalid` / autenticação | Redefina o token no Developer Portal e atualize o ambiente secreto |
| Gateway 4014 / intents | Habilite Server Members Intent e reinicie |
| `application_id_mismatch` | O token e DISCORD_CLIENT_ID pertencem a aplicações diferentes |
| `registration_failed` | Confira Application ID, Guild ID, convite e escopo applications.commands; execute `npm run register` |
| Comando não aparece para um cargo | Confira Integrações → Comandos, permissão padrão e servidor do registro |
| Erro 50013 / `welcome_failed` | Confira Ver canal, Enviar mensagens e Inserir links no canal |
| `audit_channel_failed` | O registro principal continua em arquivo/console; revise o canal privado de logs |
| `ENOENT` / `dist/index.js` ausente | Execute build ou confira Build & start e devDependencies |
| Estado inválido | Pare o bot e restaure backup; não apague o estado para contornar o erro |
| Reinício por memória | Consulte Plan and usage e `rssMB`; não execute modo dev ou uma segunda cópia |
| Bot offline após alguns dias | Confira e-mail de confirmação de uso, tráfego, Console e situação do plano |

## 9. Estrutura e evolução

```text
src/
  index.ts                 inicialização, intents, caches e encerramento
  register.ts              registro explícito de comandos
  doctor.ts                diagnóstico local sem rede
  import-config.ts         restauração offline validada
  commands/                definições slash e roteamento
  components/              formulários, botões e menu de cores
  config/                  ambiente, identidade, templates e regras
  events/                  boas-vindas
  services/                armazenamento, rascunhos, publicação e acesso a canais
  templates/               representação dos embeds
  validation/              validação de entradas e limites
  logs/                    saída estruturada sem segredos
  utils/                   registro REST
tests/                     testes unitários e fluxos com Discord simulado
docs/                      validação e aceite em produção
.github/workflows/ci.yml   verificações no GitHub
```

`postEmbed`, `Drafts`, `publish` e `Store` separam apresentação, publicação e persistência da interface Discord. Um painel futuro pode reutilizar esses serviços, com autenticação OAuth2, autorização no servidor e uma API própria. Para várias réplicas ou uso intenso, substitua o arquivo por um banco transacional com idempotência compartilhada. O painel não faz parte desta versão e não consome recursos do plano gratuito.
