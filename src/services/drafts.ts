import { randomUUID, createHash } from 'node:crypto';
import type { APIEmbed } from 'discord.js';
import { UserError, validateEmbeds } from '../validation/input.js';
import type { Post } from '../templates/embeds.js';
import type { Store } from './store.js';
export interface Draft { id: string; ownerId: string; guildId: string; channelId: string; expiresAt: number; post?: Post; embeds: APIEmbed[]; busy: boolean }
export class Drafts {
  private items = new Map<string, Draft>();
  constructor(private now = () => Date.now()) {}
  create(input: Omit<Draft, 'id' | 'expiresAt' | 'busy'>): Draft {
    this.sweep();
    if (this.items.size >= 100 || [...this.items.values()].filter(d => d.ownerId === input.ownerId).length >= 5) throw new UserError('Limite de rascunhos. Cancele uma prévia ou aguarde 15 minutos.');
    const draft = { ...input, id: randomUUID(), expiresAt: this.now() + 15 * 60_000, busy: false };
    this.items.set(draft.id, draft); return draft;
  }
  get(id: string, ownerId: string, guildId: string): Draft {
    const draft = this.items.get(id);
    if (!draft || draft.expiresAt <= this.now()) { this.items.delete(id); throw new UserError('Prévia expirada. Crie uma nova publicação.'); }
    if (draft.ownerId !== ownerId || draft.guildId !== guildId) throw new UserError('Esta prévia pertence a outro administrador.');
    if (draft.busy) throw new UserError('Esta publicação já está sendo processada.');
    return draft;
  }
  remove(id: string): void { this.items.delete(id); }
  sweep(): void { for (const [id, draft] of this.items) if (draft.expiresAt <= this.now() && !draft.busy) this.items.delete(id); }
}
export function fingerprint(d: Draft): string {
  const embeds = d.embeds.map(({ timestamp: _timestamp, ...e }) => e);
  return createHash('sha256').update(JSON.stringify([d.guildId, d.channelId, embeds])).digest('hex');
}
export async function publish(draft: Draft, store: Store, send: (embeds: APIEmbed[], nonce: string) => Promise<{ id: string }>): Promise<string> {
  if (draft.busy) throw new UserError('Publicação em processamento.');
  validateEmbeds(draft.embeds);
  draft.busy = true;
  const key = fingerprint(draft);
  let reserved = false;
  try {
    await store.transact(state => {
      if (state.receipts.some(r => r.draftId === draft.id || (r.key === key && (r.status === 'sending' || Date.now() - r.at < 600_000)))) throw new UserError('Publicação duplicada ou com envio pendente. Confira o canal e o registro antes de tentar novamente.');
      state.receipts.push({ key, draftId: draft.id, at: Date.now(), status: 'sending' });
      state.audit.push({ time: Date.now(), action: 'publication_reserved', userId: draft.ownerId, channelId: draft.channelId });
    });
    reserved = true;
    // Nonce com no máximo 25 caracteres e reserva persistida antes da chamada externa.
    const message = await send(draft.embeds, createHash('sha256').update(draft.id).digest('hex').slice(0, 24));
    await store.transact(state => {
      const receipt = state.receipts.find(r => r.draftId === draft.id)!;
      receipt.status = 'sent'; receipt.messageId = message.id;
      state.audit.push({ time: Date.now(), action: 'publication_sent', userId: draft.ownerId, channelId: draft.channelId, messageId: message.id });
    });
    return message.id;
  } catch (error) {
    if (reserved) throw new UserError('O resultado do envio precisa ser conferido no canal. A reserva foi mantida para evitar duplicidade; consulte /configurar historico.');
    throw error;
  } finally { draft.busy = false; }
}
