import { describe, expect, it, vi } from 'vitest';
import { waitForDocumentReady } from '../lib/modes/document.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ5ZXMifQ.c2lnbmF0dXJl';

describe('waitForDocumentReady failure message', () => {
  it('names the reason and keeps diagnostics, without the view token', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const page = {
      emulateMediaType: vi.fn(async () => {}),
      evaluate: vi
        .fn()
        // The two animation frames.
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          ready: false,
          reason: 'Document still showed loading content',
          diagnostics: {
            url: `http://localhost:3000/view/dashboard/d_1/document/s_1?token=${JWT}&isPdfRender=true&printRenderRef=ref`,
            hasDocumentPageStack: true,
          },
        }),
    };

    const failure = await waitForDocumentReady(page, 10).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Document still showed loading content');
    expect(failure.message).toContain('token=[redacted]');
    expect(failure.message).toContain('"hasDocumentPageStack":true');
    expect(failure.message).not.toContain(JWT);
  });
});
