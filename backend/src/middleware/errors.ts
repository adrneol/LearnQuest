import type { Request, Response, NextFunction } from 'express';

/** User-facing errors only — never leak stacks, bodies, or secrets. */
export function errorHandler(e: any, req: Request, res: Response, _next: NextFunction): void {
  const status = typeof e?.status === 'number' && e.status >= 400 && e.status <= 599 ? e.status : 500;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  if (status >= 500) {
    // Safe structured log: request id, method, route, status — never bodies,
    // cookies, credentials, OTPs, or connection strings.
    console.error(JSON.stringify({
      level: 'error',
      requestId: res.getHeader('X-Request-Id') ?? null,
      method: req.method,
      path: req.path,
      status,
      code: code ?? null,
      message: e?.message ?? 'internal error',
    }));
  }
  res.status(status).json({
    error: status === 500 ? 'Internal server error. The operation was not reported as successful; retry if appropriate.' : (e?.message ?? 'Request failed.'),
    ...(code ? { code } : {}),
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}
