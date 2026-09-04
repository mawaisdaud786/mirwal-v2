import { z } from 'zod'

export const askSchema = z.object({
  // Long enough for a real sentence, capped so the endpoint can't be used to push
  // arbitrary-length payloads through the intent extractor's regexes.
  message: z.string().trim().min(2, 'Tell me a little more about what you need.').max(500),
})
