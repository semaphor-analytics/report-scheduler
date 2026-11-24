const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareReportDownloadLinks } = require('./report-downloads');

test('copies the exact report files before requesting tokens and preserves download metadata', async (t) => {
  const copies = [];
  const storage = { copyObject: (params) => ({ promise: async () => { copies.push(params); } }) };
  const config = { reportDownloadBucket: 'reports', appUrl: 'https://app.example', lambdaApiKey: 'internal-test-key' };
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url.href, 'https://app.example/api/v1/briefings/internal/report-downloads');
    assert.equal(request.headers['X-API-Key'], config.lambdaApiKey);
    assert.deepEqual(JSON.parse(request.body), {
      bucket: 'reports',
      fileIds: copies.map((copy) => copy.Key.split('/')[1]),
    });
    assert.equal(copies.length, 2);
    return Response.json({ tokens: ['csv-token', 'pdf-token'] });
  });

  const links = await prepareReportDownloadLinks([
    { s3Bucket: 'reports', s3Key: 'exports/job/final/export.csv.gz', name: 'Café.csv',
      rawName: 'Café', contentEncoding: 'gzip', contentType: 'text/csv; charset=utf-8', format: 'csv' },
    { s3Bucket: 'reports', s3Key: 'pdfs/Weekly + current.pdf', name: 'Weekly.pdf',
      rawName: 'Weekly', contentType: 'application/pdf', format: 'pdf' },
  ], storage, config);

  assert.ok(copies.every((copy) => /^report-downloads\/[0-9a-f-]{36}$/.test(copy.Key)));
  assert.notEqual(copies[0].Key, copies[1].Key);
  assert.equal(copies[0].ContentEncoding, 'gzip');
  assert.equal(copies[0].ContentType, 'text/csv; charset=utf-8');
  assert.match(copies[0].ContentDisposition, /Caf%C3%A9\.csv$/);
  assert.equal(copies[1].ContentEncoding, undefined);
  assert.equal(copies[1].CopySource, 'reports/pdfs/Weekly%20%2B%20current.pdf');
  assert.deepEqual(links, [
    { name: 'Café', format: 'csv', url: 'https://app.example/api/v1/briefings/report-download?token=csv-token' },
    { name: 'Weekly', format: 'pdf', url: 'https://app.example/api/v1/briefings/report-download?token=pdf-token' },
  ]);
});

test('does not request a token when the copy fails', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected call'); });
  await assert.rejects(prepareReportDownloadLinks([
    { s3Bucket: 'reports', s3Key: 'pdfs/report.pdf', name: 'Report.pdf' },
  ], { copyObject: () => ({ promise: async () => { throw new Error('copy failed'); } }) },
  { reportDownloadBucket: 'reports', appUrl: 'https://app.example', lambdaApiKey: 'internal-test-key' }),
  /copy failed/);
  assert.equal(fetch.mock.callCount(), 0);
});
