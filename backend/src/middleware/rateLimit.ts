import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const apiLimiter = rateLimit({ windowMs: 60_000, max: env.rateLimitPerMin });
