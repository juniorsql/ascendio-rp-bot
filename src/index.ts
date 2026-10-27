import { Client, Events, GatewayIntentBits, Options, ActivityType } from 'discord.js';
import { loadEnv } from './config/env.js';
import { Store } from './services/store.js';
import { Drafts } from './services/drafts.js';
import { onInteraction } from './commands/handler.js';
import { onMemberAdd } from './events/welcome.js';
import { joinRole } from './events/member-role.js';
import { register } from './utils/registration.js';
import { errorCode, log } from './logs/logger.js';
import { TicketStore, ticketSeed } from './tickets/store.js';
import { Tickets } from './tickets/service.js';
async function main(): Promise<void> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || (minor ?? 0) < 17) throw new Error('NodeRuntimeMismatch: execute npm ci e npm start para usar o Node 24 incluído no projeto.');
  const env = loadEnv();
  const store = new Store(env.dataDir);
  await store.init({ welcomeChannelId: env.welcomeChannelId, logChannelId: env.logChannelId, adminRoleIds: env.adminRoleIds });
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    allowedMentions: { parse: [], repliedUser: false },
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0, ReactionManager: 0, GuildMemberManager: { maxSize: 20, keepOverLimit: member => member.id === member.client.user?.id }, UserManager: { maxSize: 50, keepOverLimit: user => user.id === user.client.user?.id }, PresenceManager: 0, GuildScheduledEventManager: 0, VoiceStateManager: 0 }),
    sweepers: { ...Options.DefaultSweeperSettings, users: { interval: 300, filter: () => user => user.id !== user.client.user?.id }, guildMembers: { interval: 300, filter: () => member => member.id !== member.client.user?.id } },
    rest: { timeout: 15_000, retries: 2 },
  });
  const ticketStore = new TicketStore(env.dataDir);
  await ticketStore.init(ticketSeed(process.env.TICKETS_CONFIG));
  const tickets = new Tickets(client, env.guildId, ticketStore);
  const ctx = { client, env, store, drafts: new Drafts(), tickets };
  let registered = false;
  client.once(Events.ClientReady, async ready => {
    if (ready.user.id !== env.clientId) { log('application_id_mismatch', {}, 'error'); await shutdown(1); return; }
    ready.user.setActivity(store.snapshot().config.name, { type: ActivityType.Watching });
    log('bot_online', { guildId: env.guildId, rssMB: Math.round(process.memoryUsage().rss / 1048576), nodeVersion: process.version });
    if (env.joinRoleId) {
      try { await joinRole(await client.guilds.fetch(env.guildId), env.joinRoleId); log('join_role_ready', { roleId: env.joinRoleId }); }
      catch (error) { log('join_role_setup_failed', { roleId: env.joinRoleId, code: errorCode(error) }, 'error'); }
    }
    if (env.register && !registered) {
      try { await register(env); registered = true; } catch (error) { log('registration_failed', { code: errorCode(error) }, 'error'); }
    }
    if (ticketStore.snapshot().config.panelChannelId) {
      try {
        if (process.env.TICKETS_USE_THREADS === 'true' || ticketStore.snapshot().config.mode === 'thread') await tickets.enableThreads();
        await tickets.recover(); const messageId = await tickets.ensurePanel(); log('tickets_ready', { messageId });
      }
      catch (error) { log('tickets_setup_failed', { code: errorCode(error) }, 'error'); }
    }
  });
  client.on(Events.InteractionCreate, i => { void onInteraction(i, ctx); });
  client.on(Events.GuildMemberAdd, member => { void onMemberAdd(member, ctx); });
  client.on(Events.Error, error => log('discord_client_error', { code: errorCode(error) }, 'error'));
  client.on(Events.ShardError, error => log('discord_gateway_error', { code: errorCode(error) }, 'error'));
  const timer = setInterval(() => {
    ctx.drafts.sweep(); log('health', { rssMB: Math.round(process.memoryUsage().rss / 1048576) });
    void tickets.recover().catch(error => log('ticket_recovery_failed', { code: errorCode(error) }, 'warn'));
  }, 300_000);
  timer.unref();
  let stopping = false;
  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), 20_000); deadline.unref();
    await client.destroy(); await store.idle(); await ticketStore.idle();
    clearTimeout(deadline); process.exitCode = code;
    log('bot_stopped');
  }
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.on('unhandledRejection', error => { log('unhandled_rejection', { code: errorCode(error) }, 'error'); void shutdown(1); });
  process.on('uncaughtException', error => { log('uncaught_exception', { code: errorCode(error) }, 'error'); void shutdown(1); });
  try { await client.login(env.token); }
  catch (error) { await shutdown(1); throw error; }
}
main().catch(error => {
  log('startup_failed', { code: errorCode(error) }, 'error');
  // Erros de configuração conhecidos têm mensagem estática, sem valores secretos.
  if (error instanceof Error && /^(DISCORD_|REGISTER_COMMANDS_|Não foi possível ler o estado)/.test(error.message)) console.error(error.message);
  process.exitCode = 1;
});
