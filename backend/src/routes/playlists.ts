import { Router } from 'express';
import { z } from 'zod';
import type { DataStore } from '../store.js';
import { noStore, requireAuth, requireCsrf, requireOnboarded, type AuthedRequest } from '../auth/middleware.js';
import { http } from '../auth/accounts.js';
import {
  archivePlaylist, deletePlaylistPermanently, playlistSummary,
} from '../services/userData.js';

const versionSchema = z.object({ version: z.number().int().min(0) });
const deleteSchema = z.object({
  version: z.number().int().min(0),
  confirmTitle: z.string().min(1).max(500),
});

export function createPlaylistManagementRouter(store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(store));
  router.use(noStore);
  router.use(requireOnboarded);

  const validId = (id: string): string => {
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(id)) throw http(400, 'Invalid playlist ID.', 'INVALID_PLAYLIST_ID');
    return id;
  };

  router.get('/:playlistId/summary', async (req: AuthedRequest, res, next) => {
    try {
      const id = validId(req.params.playlistId);
      const summary = await playlistSummary(store, req.auth!.userId, id);
      if (!summary) throw http(404, 'Playlist not found for this account.', 'NOT_FOUND');
      res.json(summary);
    } catch (e) {
      next(e);
    }
  });

  router.post('/:playlistId/archive', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const id = validId(req.params.playlistId);
      const body = versionSchema.safeParse(req.body);
      if (!body.success) throw http(400, 'A valid data version is required.', 'INVALID_REQUEST');
      const result = await archivePlaylist(store, req.auth!.userId, id, true, body.data.version);
      res.json({ ok: true, mode: 'archived', ...result });
    } catch (e) {
      next(e);
    }
  });

  router.post('/:playlistId/restore', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const id = validId(req.params.playlistId);
      const body = versionSchema.safeParse(req.body);
      if (!body.success) throw http(400, 'A valid data version is required.', 'INVALID_REQUEST');
      const result = await archivePlaylist(store, req.auth!.userId, id, false, body.data.version);
      res.json({ ok: true, mode: 'restored', ...result });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/:playlistId', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const id = validId(req.params.playlistId);
      const body = deleteSchema.safeParse(req.body);
      if (!body.success) throw http(400, 'A valid data version and playlist title confirmation are required.', 'INVALID_REQUEST');
      const priorJob = await store.deletions.findOne({ userId: req.auth!.userId, playlistId: id });
      if (priorJob?.status === 'completed') {
        const activeDoc = await store.data('activeId').findOne({ userId: req.auth!.userId, key: 'singleton' });
        res.json({
          ok: true, mode: 'deleted', deleted: true, alreadyDeleted: true,
          playlistId: id, title: priorJob.title ?? 'Untitled playlist',
          deletedCounts: priorJob.deletedCounts ?? {},
          activeId: activeDoc?.value ?? null,
        });
        return;
      }
      const result = await deletePlaylistPermanently(
        store, req.auth!.userId, id, body.data.version, body.data.confirmTitle,
      );
      res.json({ ok: true, mode: 'deleted', ...result });
    } catch (e: any) {
      if (!e?.status || e.status >= 500) {
        try {
          const id = String(req.params.playlistId);
          const job = await store.deletions.findOne({ userId: req.auth!.userId, playlistId: id });
          res.status(500).json({
            error: 'Deletion did not complete. No success is being reported; retry the deletion. Unrelated playlists were not changed.',
            code: 'DELETE_INCOMPLETE',
            retryable: true,
            deletion: job ? { status: job.status, failedCollection: job.failedCollection, deletedCounts: job.deletedCounts } : null,
          });
          return;
        } catch {
          // fall through to the normal error handler
        }
      }
      next(e);
    }
  });

  return router;
}
