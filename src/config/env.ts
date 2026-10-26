import { resolve } from 'node:path';
import { snowflake } from '../validation/input.js';
export interface Env { token: string; clientId: string; guildId: string; dataDir: string; register: boolean; welcomeChannelId: string; logChannelId: string; adminRoleIds: string[]; joinRoleId: string }
export function loadEnv(source = process.env): Env {
  const token = source.DISCORD_TOKEN?.trim();
  if (!token || token.length < 30) throw new Error('DISCORD_TOKEN ausente ou inválido. Configure-o no ambiente secreto.');
  const clientId = snowflake(source.DISCORD_CLIENT_ID ?? '', 'DISCORD_CLIENT_ID');
  const guildId = snowflake(source.DISCORD_GUILD_ID ?? '', 'DISCORD_GUILD_ID');
  const optionalId = (s: string | undefined) => s?.trim() ? snowflake(s.trim()) : '';
  const adminRoleIds = (source.ADMIN_ROLE_IDS ?? '').split(',').filter(s => s.trim()).map(s => snowflake(s.trim()));
  const flag = source.REGISTER_COMMANDS_ON_START ?? 'true';
  if (!['true', 'false'].includes(flag)) throw new Error('REGISTER_COMMANDS_ON_START deve ser true ou false.');
  return { token, clientId, guildId, dataDir: resolve(source.DATA_DIR || './data'), register: flag === 'true',
    welcomeChannelId: optionalId(source.WELCOME_CHANNEL_ID), logChannelId: optionalId(source.LOG_CHANNEL_ID), adminRoleIds, joinRoleId: optionalId(source.JOIN_ROLE_ID) };
}
