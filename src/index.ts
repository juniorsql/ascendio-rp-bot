import { Client, Events, GatewayIntentBits, Options, ActivityType } from 'discord.js';
import { loadEnv } from './config/env.js';
import { Store } from './services/store.js';
import { Drafts } from './services/drafts.js';
import { onInteraction } from './commands/handler.js';
import { onMemberAdd } from './events/welcome.js';
import { register } from './utils/registration.js';
import { errorCode, log } from './logs/logger.js';
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
  const ctx = { client, env, store, drafts: new Drafts() };
  let registered = false;
  client.once(Events.ClientReady, async ready => {
    if (ready.user.id !== env.clientId) { log('application_id_mismatch', {}, 'error'); await shutdown(1); return; }
    ready.user.setActivity(store.snapshot().config.name, { type: ActivityType.Watching });
    log('bot_online', { guildId: env.guildId, rssMB: Math.round(process.memoryUsage().rss / 1048576), nodeVersion: process.version });
    if (env.register && !registered) {
      try { await register(env); registered = true; } catch (error) { log('registration_failed', { code: errorCode(error) }, 'error'); }
    }
  });
  client.on(Events.InteractionCreate, i => { void onInteraction(i, ctx); });
  client.on(Events.GuildMemberAdd, member => { void onMemberAdd(member, ctx); });
  client.on(Events.Error, error => log('discord_client_error', { code: errorCode(error) }, 'error'));
  client.on(Events.ShardError, error => log('discord_gateway_error', { code: errorCode(error) }, 'error'));
  const timer = setInterval(() => { ctx.drafts.sweep(); log('health', { rssMB: Math.round(process.memoryUsage().rss / 1048576) }); }, 300_000);
  timer.unref();
  let stopping = false;
  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), 20_000); deadline.unref();
    await client.destroy(); await store.idle();
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
