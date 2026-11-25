import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { snowflake, UserError } from '../validation/input.js';

export type Decision = 'approved' | 'rejected';
export type Stage = 'draft' | 'submitting' | 'review' | 'awaiting' | 'publishing' | Decision;
interface ApplicationRecord {
  id: string;
  userId: string;
  character: string;
  answers: Record<string, string>;
  formDraft?: string[];
  stage: Stage;
  submittedAt?: number;
  formApprovedAt?: number;
  decidedAt?: number;
  resultStartedAt?: number;
  resultDecision?: Decision;
  reviewId?: string;
  resultId?: string;
  reviewerId?: string;
  formApprovalDm?: 'sent' | 'failed';
  formApprovalResultId?: string | null;
  rejectionDm?: 'pending' | 'sent' | 'failed';
  nicknameApplied?: boolean;
  interviewerId?: string;
  rejectedById?: string;
  feedback?: string;
  ownerResetRequest?: string;
}

export interface Application extends ApplicationRecord {
  previousAttempts?: ApplicationRecord[];
}

export const allowlistAttemptLimit = 3;
export function attemptNumber(app: Application) {
  return (app.previousAttempts?.length ?? 0) + 1;
}

export function retriesRemaining(app: Application) {
  return Math.max(0, allowlistAttemptLimit - attemptNumber(app));
}

export function newApplication(userId: string): Application {
  return { id: randomBytes(10).toString('hex'), userId, character: '', answers: {}, stage: 'draft' };
}

export class AllowlistStore {
  private readonly directory: string;
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) { this.directory = join(dataDir, 'allowlist'); }

  async init() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }

  async userIds() {
    const files = await readdir(this.directory);
    return files.filter(file => /^\d{17,20}\.json$/.test(file)).map(file => file.slice(0, -5));
  }

  private file(userId: string) { return join(this.directory, `${snowflake(userId)}.json`); }

  async get(userId: string): Promise<Application | undefined> {
    try { return JSON.parse(await readFile(this.file(userId), 'utf8')) as Application; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  async save(app: Application): Promise<void> {
    const path = this.file(app.userId);
    const temp = `${path}.tmp`;
    const file = await open(temp, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(app)); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, path);
  }

  async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    if (this.pending.has(userId)) throw new UserError('Já existe uma atualização desta ficha em andamento. Tente novamente em instantes.');
    const operation = work();
    this.pending.set(userId, operation);
    try { return await operation; }
    finally { this.pending.delete(userId); }
  }

  async idle() { await Promise.allSettled(this.pending.values()); }
}
