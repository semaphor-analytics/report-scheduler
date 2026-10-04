import { Readable, PassThrough } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { compactChunks } from './compactor';
import { csvFilePreamble, csvRecord, encodeCsvFile } from 'react-semaphor/format-utils';

describe('compactChunks', () => {
  it('destroys a stalled download and awaits upload shutdown on cancellation', async () => {
    const controller = new AbortController();
    const source = new PassThrough();
    let uploadedStopped = false;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const outcome = expect(compactChunks({ jobId: 'job', chunkKeys: ['one', 'two'], signal: controller.signal }, {
      getObjectStream: async (_key, signal) => { expect(signal).toBeDefined(); started(); return source; },
      uploadStream: async (_key, stream, _type, signal) => {
        try { for await (const _chunk of stream) { /* drain */ } }
        finally { expect(signal?.aborted).toBe(true); uploadedStopped = true; }
        return 0;
      },
    })).rejects.toThrow();
    await ready;
    controller.abort(Error('deadline'));
    await outcome;
    expect(source.destroyed).toBe(true);
    expect(uploadedStopped).toBe(true);
  });

  it('stops the active source and waits for both sides when upload fails', async () => {
    const source = new PassThrough();
    let failUpload!: (error: Error) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const outcome = expect(compactChunks({ jobId: 'job', chunkKeys: ['one'], signal: new AbortController().signal }, {
      getObjectStream: async () => { started(); return source; },
      uploadStream: async () => new Promise((_resolve, reject) => { failUpload = reject; }),
    })).rejects.toThrow('upload failed');
    await ready;
    failUpload(Error('upload failed'));
    await outcome;
    expect(source.destroyed).toBe(true);
  });
  it('preserves DB-selected sequence rather than sorting immutable attempt names', async () => {
    let csv = '';
    await compactChunks({ jobId: 'job', chunkKeys: ['z', 'a'], preserveOrder: true, finalKey: 'attempt/final' }, {
      getObjectStream: async key => Readable.from([key]),
      uploadStream: async (key, stream) => {
        expect(key).toBe('attempt/final'); const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        csv = gunzipSync(Buffer.concat(chunks)).toString(); return 1;
      },
    });
    expect(csv).toBe('za');
  });
  it('propagates source failure instead of publishing a successful partial file', async () => {
    await expect(compactChunks({ jobId: 'job', chunkKeys: ['bad'] }, {
      getObjectStream: async () => { throw Error('source missing'); },
      uploadStream: async (_key, stream) => { for await (const _ of stream) { /* drain */ } return 0; },
    })).rejects.toThrow('source missing');
  });
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
  it('keeps a contract file intact: one BOM at byte 0, CRLF records, the footer last', async () => {
    const chunk1 = csvFilePreamble('utf-8-bom') + csvRecord(['Region', 'Revenue'], ',') + csvRecord(['East', '1'], ',');
    const chunk2 = csvRecord(['Café, "Nord"', '2'], ',');
    const footer = csvRecord(['Total', '3'], ',');
    let uploaded = Buffer.alloc(0);
    const result = await compactChunks(
      { jobId: 'job-2', chunkKeys: ['002.csv', '001.csv'], footer },
      {
        getObjectStream: async (key) => Readable.from([key === '001.csv' ? chunk1 : chunk2]),
        uploadStream: async (_key, stream) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          uploaded = Buffer.concat(chunks);
          return uploaded.length;
        },
      },
    );

    const file = gunzipSync(uploaded);
    expect(file.toString('utf8')).toBe(
      encodeCsvFile({
        header: ['Region', 'Revenue'],
        rows: [['East', '1'], ['Café, "Nord"', '2'], ['Total', '3']],
        delimiter: ',',
        encoding: 'utf-8-bom',
      }),
    );
    expect([...file.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.indexOf(Buffer.from([0xef, 0xbb, 0xbf]), 1)).toBe(-1);
    expect(result.totalBytes).toBe(file.length);
  });
});
