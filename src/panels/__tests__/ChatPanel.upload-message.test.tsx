/**
 * Chat attach posts to /api/documents/upload without asking for background;
 * video, audio and long scans come back 202 + a job id. The chat line must
 * say the file is being read, not "? chunks ingested".
 */
import { chatUploadMessage } from '../ChatPanel'

describe('chatUploadMessage', () => {
  it('says a 202 attachment is being read in the background', () => {
    const msg = chatUploadMessage('animatic.mp4', 202, { job_id: 'j1' })
    expect(msg).toMatch(/^Reading animatic\.mp4 in the background/)
    expect(msg).not.toMatch(/chunks/)
  })

  it('reports the chunk count for an inline upload', () => {
    expect(chatUploadMessage('notes.txt', 200, { chunks_created: 4 }))
      .toBe('Uploaded notes.txt (4 chunks ingested)')
    expect(chatUploadMessage('old.txt', 200, { chunk_count: 2 }))
      .toBe('Uploaded old.txt (2 chunks ingested)')
  })
})
