import type { APIEmbed } from 'discord.js';
import { safeText } from '../validation/input.js';
import { ticketLabels, type Ticket } from './store.js';

type ClosedRecord = Pick<Ticket, 'id' | 'department' | 'ownerId' | 'closedBy' | 'claimedBy' | 'reason' | 'closedAt'> & { subject?: string };
export function closedTicketRecord(ticket: ClosedRecord, channelId: string) {
  const label = ticketLabels[ticket.department].label;
  const description = [
    `Solicitante: <@${ticket.ownerId}>`,
    `Setor: ${label}`,
    ...(ticket.subject ? [`Assunto: ${safeText(ticket.subject)}`] : []),
    ...(ticket.closedBy ? [`Responsável: <@${ticket.closedBy}>`] : []),
    ...(ticket.claimedBy ? [`Atendido por: <@${ticket.claimedBy}>`] : []),
    `Motivo: ${safeText(ticket.reason || 'Atendimento concluído.')}`,
    `Histórico preservado: <#${channelId}>`,
  ].join('\n');
  const embed: APIEmbed = {
    color: 0xe06767, title: '📤 Ticket encerrado', description,
    footer: { text: `Ticket: ${ticket.id} • ${label}` },
    ...(ticket.closedAt ? { timestamp: new Date(ticket.closedAt).toISOString() } : {}),
  };
  return { embeds: [embed], allowedMentions: { parse: [] as never[], repliedUser: false } };
}

export function isClosedTicketRecord(message: { content: string; embeds?: readonly { footer?: { text: string } | null }[] }, ticketId: string): boolean {
  const marker = `Ticket: ${ticketId}`;
  return message.content.includes(marker) || !!message.embeds?.some(e => e.footer?.text.startsWith(`${marker} • `));
}
