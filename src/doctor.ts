import { loadEnv } from './config/env.js';
import { Store } from './services/store.js';
import { log, errorCode } from './logs/logger.js';
try {
  const env = loadEnv(); const store = new Store(env.dataDir);
  await store.init({ welcomeChannelId: env.welcomeChannelId, logChannelId: env.logChannelId, adminRoleIds: env.adminRoleIds });
  log('configuration_and_storage_ok', { guildId: env.guildId });
  console.log('Ambiente e armazenamento válidos. Este comando não autentica no Discord nem registra comandos.');
} catch (error) { log('doctor_failed', { code: errorCode(error) }, 'error'); process.exitCode = 1; }
