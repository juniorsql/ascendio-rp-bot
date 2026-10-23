import { loadEnv } from './config/env.js';
import { register } from './utils/registration.js';
import { errorCode, log } from './logs/logger.js';
try { await register(loadEnv()); } catch (error) { log('registration_failed', { code: errorCode(error) }, 'error'); process.exitCode = 1; }
