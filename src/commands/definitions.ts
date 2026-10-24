import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { kinds, labels, defaults } from '../config/defaults.js';
import { departments, ticketLabels } from '../tickets/store.js';
const choices = kinds.map(value => ({ name: labels[value], value }));
const channels = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
const admin = (name: string, description: string, config = false) => new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(config ? PermissionFlagsBits.ManageGuild : PermissionFlagsBits.ManageMessages);
export const commands = [
  admin('ticket', 'Configure e publique a central de atendimento.', true)
    .addSubcommand(s => s.setName('recuperar').setDescription('Retome operações de tickets interrompidas.'))
    .addSubcommand(s => s.setName('status').setDescription('Veja os canais, as equipes e os atendimentos.'))
    .addSubcommand(s => s.setName('painel').setDescription('Publique ou atualize o painel de tickets.'))
    .addSubcommand(s => s.setName('canais').setDescription('Defina os canais da central.')
      .addChannelOption(o => o.setName('painel').setDescription('Canal de abertura de tickets').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('logs').setDescription('Canal privado dos registros').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('fechados').setDescription('Categoria dos atendimentos encerrados').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand(s => s.setName('equipe').setDescription('Defina categoria e cargos responsáveis pelo assunto.')
      .addStringOption(o => o.setName('tipo').setDescription('Assunto').setRequired(true).addChoices(...departments.map(value => ({ name: ticketLabels[value].label, value }))))
      .addChannelOption(o => o.setName('categoria').setDescription('Categoria para abrir os canais privados').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo da equipe responsável').setRequired(true))
      .addStringOption(o => o.setName('acao').setDescription('Adicionar ou remover o cargo').addChoices({ name: 'Adicionar', value: 'adicionar' }, { name: 'Remover', value: 'remover' }))),
  admin('anuncio', 'Monte uma publicação com prévia privada.').addChannelOption(o => o.setName('canal').setDescription('Destino da publicação').setRequired(true).addChannelTypes(...channels))
    .addStringOption(o => o.setName('tipo').setDescription('Tipo de publicação').setRequired(true).addChoices(...choices)),
  ...(['evento', 'spoiler', 'comunicado'] as const).map(name => admin(name, `Monte um ${name} com prévia privada.`)
    .addChannelOption(o => o.setName('canal').setDescription('Destino da publicação').setRequired(true).addChannelTypes(...channels))),
  admin('regras', 'Veja a prévia das oito categorias de regras.').addChannelOption(o => o.setName('canal').setDescription('Destino do regulamento').setRequired(true).addChannelTypes(...channels)),
  admin('configurar', 'Configure a identidade e a operação do bot.', true)
    .addSubcommand(s => s.setName('ver').setDescription('Veja a configuração atual.'))
    .addSubcommand(s => s.setName('exportar').setDescription('Exporte configurações sem segredos.'))
    .addSubcommand(s => s.setName('historico').setDescription('Veja as últimas ações e reservas pendentes.'))
    .addSubcommand(s => s.setName('canal').setDescription('Defina um canal; omita o destino para desativar.')
      .addStringOption(o => o.setName('uso').setDescription('Função').setRequired(true).addChoices({ name: 'Boas-vindas', value: 'welcomeChannelId' }, { name: 'Logs', value: 'logChannelId' }, { name: 'Regras', value: 'rulesChannelId' }))
      .addChannelOption(o => o.setName('destino').setDescription('Canal configurado').addChannelTypes(...channels)))
    .addSubcommand(s => s.setName('cargo').setDescription('Adicione ou remova um cargo de publicadores.')
      .addRoleOption(o => o.setName('cargo').setDescription('Cargo autorizado').setRequired(true))
      .addStringOption(o => o.setName('acao').setDescription('Operação').setRequired(true).addChoices({ name: 'Adicionar', value: 'adicionar' }, { name: 'Remover', value: 'remover' })))
    .addSubcommand(s => s.setName('identidade').setDescription('Edite nome e logotipo.'))
    .addSubcommand(s => s.setName('boas-vindas').setDescription('Edite o título e a mensagem de recepção.'))
    .addSubcommand(s => s.setName('template').setDescription('Edite a aparência de um tipo de publicação.')
      .addStringOption(o => o.setName('tipo').setDescription('Tipo').setRequired(true).addChoices(...choices)))
    .addSubcommand(s => s.setName('regra').setDescription('Edite uma categoria do regulamento.')
      .addIntegerOption(o => o.setName('categoria').setDescription('Categoria de regras').setRequired(true).addChoices(...defaults().rules.map((r, i) => ({ name: r.title, value: i })))))
    .addSubcommand(s => s.setName('testar-boas-vindas').setDescription('Mostre uma prévia privada da recepção.')),
  new SlashCommandBuilder().setName('ajuda').setDescription('Como usar o Ascendio RP Bot.').setContexts(InteractionContextType.Guild),
].map(command => command.toJSON());
