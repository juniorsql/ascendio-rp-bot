import { mkdir, readFile, open, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaults, kinds, type Config } from '../config/defaults.js';
import { imageUrl, snowflake, text, UserError } from '../validation/input.js';
import { welcomeEmbed, rulesEmbeds } from '../templates/embeds.js';
export interface Audit { time: number; action: string; userId: string; channelId?: string; messageId?: string }
export interface Receipt { key: string; draftId: string; at: number; status: 'sending' | 'sent'; messageId?: string }
export interface State { version: 1; config: Config; audit: Audit[]; receipts: Receipt[] }
export function validateConfig(c: Config): void {
  text(c.name, 80); text(c.footer, 200); imageUrl(c.logo); text(c.welcomeTitle, 200); text(c.welcomeText, 2500);
  for (const id of [c.welcomeChannelId, c.logChannelId, c.rulesChannelId, ...c.adminRoleIds]) if (id) snowflake(id);
  if (c.adminRoleIds.length > 20) throw new UserError('Máximo de 20 cargos administrativos.');
  for (const kind of kinds) {
    const t = c.templates[kind];
    if (!t || !Number.isInteger(t.color) || t.color < 0 || t.color > 0xffffff) throw new UserError('Template/cor inválido.');
    text(t.footer, 200, 'Rodapé', 0); imageUrl(t.image); imageUrl(t.thumbnail);
  }
  if (c.rules.length !== 8) throw new UserError('São necessárias oito categorias de regras.');
  for (const r of c.rules) { text(r.title, 80); text(r.content, 500); if (typeof r.official !== 'boolean') throw new UserError('Status da regra inválido.'); }
  welcomeEmbed(c, '12345678901234567890');
  rulesEmbeds(c);
}
export class Store {
  private state!: State;
  private queue: Promise<unknown> = Promise.resolve();
  readonly path: string;
  constructor(readonly dir: string) { this.path = join(dir, 'state.json'); }
  async init(seed?: Partial<Config>): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      if ((await stat(this.path)).size > 2_000_000) throw new Error('Estado excede 2 MB.');
      const data = JSON.parse(await readFile(this.path, 'utf8')) as State;
      if (data.version !== 1 || !Array.isArray(data.audit) || !Array.isArray(data.receipts) || data.audit.length > 1000 || data.receipts.length > 2000) throw new Error('Estado inválido.');
      validateConfig(data.config);
      for (const r of data.receipts) if (typeof r.key !== 'string' || typeof r.draftId !== 'string' || !Number.isFinite(r.at) || !['sending', 'sent'].includes(r.status)) throw new Error('Recibo inválido.');
      this.state = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Não foi possível ler o estado. Restaure um backup válido; o arquivo não foi sobrescrito.');
      this.state = { version: 1, config: { ...defaults(), ...seed }, audit: [], receipts: [] };
      validateConfig(this.state.config);
      await this.save(this.state);
    }
  }
  snapshot(): State { return structuredClone(this.state); }
  async transact<T>(fn: (state: State) => T): Promise<T> {
    const op = this.queue.then(async () => {
      const next = this.snapshot();
      const result = fn(next);
      validateConfig(next.config);
      next.audit = next.audit.slice(-1000);
      // Nunca descartamos reservas incertas automaticamente.
      next.receipts = next.receipts.filter(r => r.status === 'sending' || Date.now() - r.at < 86400_000);
      if (next.receipts.length > 2000) throw new UserError('Limite do registro de publicações. Revise reservas pendentes no arquivo de estado.');
      await this.save(next);
      this.state = next;
      return result;
    });
    this.queue = op.catch(() => undefined);
    return op;
  }
  async idle(): Promise<void> { await this.queue; }
  private async save(state: State): Promise<void> {
    const temp = `${this.path}.tmp`;
    const file = await open(temp, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(state, null, 2)); await file.sync(); } finally { await file.close(); }
    await rename(temp, this.path);
  }
}
