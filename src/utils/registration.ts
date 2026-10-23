import { REST, Routes } from 'discord.js';
import type { Env } from '../config/env.js';
import { commands } from '../commands/definitions.js';
import { log } from '../logs/logger.js';
export async function register(env: Env): Promise<void> {
  const rest = new REST({ version: '10', timeout: 15_000, retries: 2 }).setToken(env.token);
  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
  log('commands_registered', { guildId: env.guildId });
}
