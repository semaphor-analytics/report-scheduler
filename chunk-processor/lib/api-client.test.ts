import { jest } from '@jest/globals';
import {
  ExportQueryRejectedError,
  fetchChunkStatus,
  queryData,
} from './api-client';

describe('queryData table totals projection', () => {
  beforeEach(() => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ records: [] }),
    } as Response);
  });

  it('omits tableTotalsRequest from an ordinary chunk query', async () => {
    await queryData({
      url: 'https://app.example.com',
      token: 'token',
      queryPayload: { cardType: 'table', cardConfig: {} },
      chunkNumber: 2,
      chunkSize: 100,
    });

    const body = JSON.parse(
      String(jest.mocked(global.fetch).mock.calls[0][1]?.body),
    );
    expect(body).not.toHaveProperty('tableTotalsRequest');
  });

  it('forwards the governed request when supplied to the first chunk', async () => {
    const tableTotalsRequest = {
      source: 'documentFlatTable' as const,
      columns: [
        {
          fieldId: 'revenue-id',
          role: 'metric' as const,
          behavior: 'sum' as const,
        },
      ],
    };
    await queryData({
      url: 'https://app.example.com',
      token: 'token',
      queryPayload: { cardType: 'table', cardConfig: {} },
      chunkNumber: 1,
      chunkSize: 100,
      tableTotalsRequest,
    });

    const body = JSON.parse(
      String(jest.mocked(global.fetch).mock.calls[0][1]?.body),
    );
    expect(body.tableTotalsRequest).toEqual(tableTotalsRequest);
  });

  it('classifies an HTTP 400 query rejection as non-retryable', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'stable ordering is required',
    } as Response);

    await expect(
      queryData({
        url: 'https://app.example.com',
        token: 'token',
        queryPayload: { cardType: 'table', cardConfig: {} },
        chunkNumber: 1,
        chunkSize: 100,
      }),
    ).rejects.toMatchObject({
      name: 'ExportQueryRejectedError',
      retryable: false,
      message: 'Query failed (400): stable ordering is required',
    } satisfies Partial<ExportQueryRejectedError>);
  });

  it('keeps server failures retryable', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'temporarily unavailable',
    } as Response);

    await expect(
      queryData({
        url: 'https://app.example.com',
        token: 'token',
        queryPayload: { cardType: 'table', cardConfig: {} },
        chunkNumber: 1,
        chunkSize: 100,
      }),
    ).rejects.toMatchObject({
      name: 'Error',
      message: 'Query failed (503): temporarily unavailable',
    });
  });
});

describe('fetchChunkStatus', () => {
  it('returns null only for a missing chunk', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await expect(
      fetchChunkStatus('missing', 'https://app.example.com', 'key'),
    ).resolves.toBeNull();
  });

  it('fails closed when chunk status is unavailable', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    } as Response);

    await expect(
      fetchChunkStatus('chunk-1', 'https://app.example.com', 'key'),
    ).rejects.toThrow('Failed to fetch chunk status (503)');

    global.fetch = jest.fn<typeof fetch>().mockRejectedValue(
      new Error('network unavailable'),
    );
    await expect(
      fetchChunkStatus('chunk-1', 'https://app.example.com', 'key'),
    ).rejects.toThrow('network unavailable');
  });
});
