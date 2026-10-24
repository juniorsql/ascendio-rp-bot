// Lista de campos permitidos: nunca serializa erros REST, payloads, tokens ou conteúdo.
export function log(event: string, meta: { guildId?: string; userId?: string; channelId?: string; messageId?: string; action?: string; code?: string | number; rssMB?: number; nodeVersion?: string } = {}, level = 'info'): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, event, ...meta }));
}
export function errorCode(error: unknown): string | number {
  if (error && typeof error === 'object' && 'code' in error && ['string', 'number'].includes(typeof error.code)) return String(error.code).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50);
  return error instanceof Error ? error.name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50) : 'UnknownError';
}
