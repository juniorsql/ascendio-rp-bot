import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'ascendio-smoke-'));
const env = { ...process.env, DISCORD_TOKEN: 'synthetic-offline-placeholder-not-a-real-token', DISCORD_CLIENT_ID: '123456789012345678', DISCORD_GUILD_ID: '223456789012345678', WELCOME_CHANNEL_ID: '323456789012345678', LOG_CHANNEL_ID: '', ADMIN_ROLE_IDS: '', DATA_DIR: dir };
const run = (file, args = [], overrides = {}) => spawnSync(process.execPath, [file, ...args], { env: { ...env, ...overrides }, encoding: 'utf8', timeout: 20_000 });
try {
  const doctor = run('dist/doctor.js'); assert.equal(doctor.status, 0, doctor.stderr);
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.config.welcomeChannelId, env.WELCOME_CHANNEL_ID);
  const source = join(dir, 'config.json'); state.config.footer = 'Configuração restaurada.';
  await writeFile(source, JSON.stringify(state.config));
  const imported = run('dist/import-config.js', [source, '--bot-stopped']); assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).config.footer, 'Configuração restaurada.');
  assert.ok((await readdir(dir)).some(f => f.startsWith('state.json.backup-')));
  const missing = run('dist/index.js', [], { DISCORD_TOKEN: '' });
  assert.equal(missing.status, 1); assert.match(missing.stdout, /startup_failed/); assert.match(missing.stderr, /DISCORD_TOKEN/);
  assert.ok(![missing.stdout, missing.stderr, doctor.stdout, imported.stdout].join('').includes(env.DISCORD_TOKEN));
  console.log(JSON.stringify({ node: process.version, doctor: 'pass', configImport: 'pass', missingSecretStartup: 'pass', network: 'not used' }));
} finally { await rm(dir, { recursive: true, force: true }); }
