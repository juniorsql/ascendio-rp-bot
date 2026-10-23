import { copyFile, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from './config/env.js';
import { Store, validateConfig } from './services/store.js';
import type { Config } from './config/defaults.js';
import { errorCode, log } from './logs/logger.js';
try {
  const source = process.argv[2];
  if (!source || !process.argv.includes('--bot-stopped')) throw new Error('Uso: npm run config:import -- caminho/ascendio-config.json --bot-stopped. Pare o bot antes de importar.');
  const path = resolve(source);
  if ((await stat(path)).size > 100_000) throw new Error('Configuração excede 100 KB.');
  const config = JSON.parse(await readFile(path, 'utf8')) as Config;
  validateConfig(config);
  const env = loadEnv(); const store = new Store(env.dataDir);
  await store.init({ welcomeChannelId: env.welcomeChannelId, logChannelId: env.logChannelId, adminRoleIds: env.adminRoleIds });
  await copyFile(store.path, `${store.path}.backup-${Date.now()}`);
  await store.transact(state => { state.config = config; state.audit.push({ time: Date.now(), userId: 'offline', action: 'configuration_imported' }); });
  log('configuration_imported');
} catch (error) {
  log('configuration_import_failed', { code: errorCode(error) }, 'error');
  if (error instanceof Error && error.message.startsWith('Uso:')) console.error(error.message);
  process.exitCode = 1;
}
