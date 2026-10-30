import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { snowflake, text, UserError } from '../validation/input.js';

export const departments = ['suporte', 'doacoes', 'rp', 'bug'] as const;
export type Department = typeof departments[number];
export const ticketLabels: Record<Department, { label: string; emoji: string; description: string }> = {
  suporte: { label: 'Suporte', emoji: '📩', description: 'Dúvidas e ajuda com o servidor' },
  doacoes: { label: 'Doações', emoji: '💎', description: 'Informações e atendimento sobre doações' },
  rp: { label: 'Solicitar RP', emoji: '📖', description: 'Pedidos e propostas de roleplay' },
  bug: { label: 'Reportar bug', emoji: '⚠️', description: 'Problemas técnicos e erros encontrados' },
};
export interface TicketConfig {
  mode?: 'channel' | 'thread';
  panelChannelId: string; logChannelId: string; closedCategoryId: string;
  routes: Record<Department, { categoryId: string; roleIds: string[]; mentionRoleIds?: string[]; mentionUserIds?: string[]; parentChannelId?: string; accessRoleId?: string; notificationChannelId?: string }>;
}
export interface Ticket {
  id: string; ownerId: string; department: Department; categoryId: string; roleIds: string[];
  subject: string; description: string; createdAt: number;
  status: 'creating' | 'open' | 'closing' | 'closed'; channelId?: string; messageId?: string;
  claimedBy?: string; closedBy?: string; closedAt?: number; reason?: string; logMessageId?: string;
  creationAttempted?: boolean;
  kind?: 'thread'; parentChannelId?: string;
  notificationStatus?: 'pending' | 'sending' | 'sent'; notificationChannelId?: string; notificationMessageId?: string;
}
export interface TicketState { version: 1; config: TicketConfig; panelMessageId?: string; tickets: Ticket[] }
export function ticketDefaults(): TicketConfig {
  const route = () => ({ categoryId: '', roleIds: [] as string[] });
  return { panelChannelId: '', logChannelId: '', closedCategoryId: '', routes: { suporte: route(), doacoes: route(), rp: route(), bug: route() } };
}
export function department(value: string): Department {
  if (!departments.includes(value as Department)) throw new UserError('Tipo de atendimento inválido.');
  return value as Department;
}
export function validateTicketConfig(c: TicketConfig): void {
  if (c.mode !== undefined && !['channel', 'thread'].includes(c.mode)) throw new UserError('Modo de tickets inválido.');
  for (const id of [c.panelChannelId, c.logChannelId, c.closedCategoryId]) if (id) snowflake(id);
  for (const d of departments) {
    const route = c.routes[d];
    if (!route || !Array.isArray(route.roleIds) || route.roleIds.length > 10) throw new UserError('Configuração de atendimento inválida.');
    if (route.categoryId) snowflake(route.categoryId);
    if (route.parentChannelId) snowflake(route.parentChannelId);
    if (route.accessRoleId) snowflake(route.accessRoleId);
    if (route.notificationChannelId) snowflake(route.notificationChannelId);
    for (const id of route.roleIds) snowflake(id);
    for (const list of [route.mentionRoleIds, route.mentionUserIds]) {
      if (list !== undefined && (!Array.isArray(list) || list.length > 10)) throw new UserError('Destinatários do atendimento inválidos.');
      for (const id of list ?? []) snowflake(id);
    }
    if (route.mentionRoleIds?.some(id => !route.roleIds.includes(id))) throw new UserError('Mencione apenas cargos da equipe do setor.');
  }
}
export function ticketSeed(value: string | undefined): TicketConfig | undefined {
  if (!value) return;
  try { const c = JSON.parse(value) as TicketConfig; validateTicketConfig(c); return c; }
  catch { throw new Error('TICKETS_CONFIG inválido; confira os IDs e os cargos.'); }
}
function validateState(s: TicketState): void {
  if (s.version !== 1 || !Array.isArray(s.tickets) || s.tickets.length > 700) throw new Error('Estado de tickets inválido.');
  validateTicketConfig(s.config);
  if (s.panelMessageId) snowflake(s.panelMessageId);
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const t of s.tickets) {
    if (!/^[a-f0-9]{20}$/.test(t.id) || ids.has(t.id)) throw new Error('ID de ticket inválido.');
    ids.add(t.id); snowflake(t.ownerId); department(t.department); snowflake(t.categoryId);
    if (!Array.isArray(t.roleIds) || t.roleIds.length > 10) throw new Error('Cargos inválidos.');
    for (const id of t.roleIds) snowflake(id);
    for (const id of [t.channelId, t.messageId, t.claimedBy, t.closedBy, t.logMessageId]) if (id) snowflake(id);
    if (t.kind !== undefined && t.kind !== 'thread') throw new Error('Formato de ticket inválido.');
    if (t.parentChannelId) snowflake(t.parentChannelId);
    if (t.kind === 'thread' && !t.parentChannelId) throw new Error('Central do tópico ausente.');
    if (t.notificationStatus !== undefined && !['pending', 'sending', 'sent'].includes(t.notificationStatus)) throw new Error('Notificação inválida.');
    for (const id of [t.notificationChannelId, t.notificationMessageId]) if (id) snowflake(id);
    if (t.notificationStatus && !t.notificationChannelId) throw new Error('Destino do aviso ausente.');
    text(t.subject, 100); text(t.description, 1800);
    if (!Number.isFinite(t.createdAt) || !['creating', 'open', 'closing', 'closed'].includes(t.status)) throw new Error('Ticket inválido.');
    if (t.status !== 'creating' && !t.channelId) throw new Error('Canal do ticket ausente.');
    if (t.status !== 'closed') { if (owners.has(t.ownerId)) throw new Error('Ticket ativo duplicado.'); owners.add(t.ownerId); }
    if (t.reason !== undefined) text(t.reason, 500, 'Motivo', 0);
  }
}
export class TicketStore {
  private state!: TicketState;
  private queue: Promise<unknown> = Promise.resolve();
  readonly path: string;
  constructor(readonly dir: string) { this.path = join(dir, 'tickets.json'); }
  async init(seed?: TicketConfig): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      if ((await stat(this.path)).size > 4_000_000) throw new Error('Arquivo de tickets muito grande.');
      this.state = JSON.parse(await readFile(this.path, 'utf8')) as TicketState;
      validateState(this.state);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Não foi possível ler os tickets. O arquivo não foi sobrescrito.');
      this.state = { version: 1, config: seed ?? ticketDefaults(), tickets: [] };
      validateState(this.state); await this.save(this.state);
    }
  }
  snapshot(): TicketState { return structuredClone(this.state); }
  async transact<T>(fn: (s: TicketState) => T): Promise<T> {
    const op = this.queue.then(async () => {
      const next = this.snapshot(); const result = fn(next);
      // O histórico completo continua no Discord. Limitamos apenas o índice local de encerrados.
      const closed = next.tickets.filter(t => t.status === 'closed').slice(-500);
      next.tickets = [...closed, ...next.tickets.filter(t => t.status !== 'closed')];
      validateState(next); await this.save(next); this.state = next; return result;
    });
    this.queue = op.catch(() => undefined); return op;
  }
  async idle(): Promise<void> { await this.queue; }
  private async save(s: TicketState): Promise<void> {
    const file = await open(`${this.path}.tmp`, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(s)); await file.sync(); } finally { await file.close(); }
    await rename(`${this.path}.tmp`, this.path);
  }
}
