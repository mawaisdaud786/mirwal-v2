import { ok } from '../../lib/errors.js'
import * as service from './ai.service.js'
import { recordSearch } from '../catalog/searchLog.js'

export async function ask(req, res, next) {
  try {
    const startedAt = Date.now()
    const answer = await service.ask(req.body.message)

    /**
     * Assistant questions are recorded alongside catalogue searches, tagged `assistant`, so
     * the admin search pages can show what people ask in sentences as well as in keywords —
     * they are frequently different, and the difference is the useful part.
     *
     * `totalMatches` rather than a claim of relevance: the honest measure of an assistant
     * answer is whether the catalogue could match anything at all.
     */
    await recordSearch({
      term: req.body.message,
      source: 'assistant',
      userId: req.user?.id ?? null,
      resultCount: answer?.totalMatches ?? 0,
      durationMs: Date.now() - startedAt,
    })

    return ok(res, answer)
  } catch (error) { return next(error) }
}
