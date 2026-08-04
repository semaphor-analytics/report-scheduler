import { fetchChunkStatus, queryData } from './api-client';

describe('queryData table totals projection', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ records: [] }),
    }) as jest.Mock;
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
      (global.fetch as jest.Mock).mock.calls[0][1].body,
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
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(body.tableTotalsRequest).toEqual(tableTotalsRequest);
  });
});

describe('fetchChunkStatus', () => {
  it('returns null only for a missing chunk', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as jest.Mock;

    await expect(
      fetchChunkStatus('missing', 'https://app.example.com', 'key'),
    ).resolves.toBeNull();
  });

  it('fails closed when chunk status is unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    }) as jest.Mock;

    await expect(
      fetchChunkStatus('chunk-1', 'https://app.example.com', 'key'),
    ).rejects.toThrow('Failed to fetch chunk status (503)');

    global.fetch = jest.fn().mockRejectedValue(
      new Error('network unavailable'),
    ) as jest.Mock;
    await expect(
      fetchChunkStatus('chunk-1', 'https://app.example.com', 'key'),
    ).rejects.toThrow('network unavailable');
  });
});
