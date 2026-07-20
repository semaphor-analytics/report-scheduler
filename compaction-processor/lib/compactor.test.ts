import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { compactChunks } from './compactor';

describe('compactChunks', () => {
  it('streams ordered chunks and one footer through the same gzip upload', async () => {
    let uploaded = Buffer.alloc(0);
    const result = await compactChunks(
      {
        jobId: 'job-1',
        chunkKeys: [
          'exports/job-1/deltas/002.csv',
          'exports/job-1/deltas/001.csv',
        ],
        footer: 'Total,"$3.00"\n',
      },
      {
        getObjectStream: async (key) =>
          Readable.from(
            key.endsWith('001.csv')
              ? ['Region,Revenue\nEast,1\n']
              : ['West,2\n'],
          ),
        uploadStream: async (_key, stream) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          uploaded = Buffer.concat(chunks);
          return uploaded.length;
        },
      },
    );

    expect(gunzipSync(uploaded).toString('utf8')).toBe(
      'Region,Revenue\nEast,1\nWest,2\nTotal,"$3.00"\n',
    );
    expect(result.totalBytes).toBe(43);
  });
});
