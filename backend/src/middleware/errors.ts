import type { Request, Response, NextFunction } from 'express';

/** User-facing errors only — never leak stacks or secrets. */
export function errorHandler(e: any, _req: Request, res: Response, _next: NextFunction): void {
  const status = typeof e?.status === 'number' ? e.status : 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : (e?.message ?? 'Request failed.') });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}
