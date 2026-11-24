const { randomUUID } = require('node:crypto');

function encodeHeaderFilename(value) {
  return encodeURIComponent(value.toWellFormed()).replace(
    /['()*]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function prepareReportDownloadLinks(attachments, storage, config) {
  if (attachments.length === 0) return [];

  const { reportDownloadBucket: bucket, appUrl, lambdaApiKey } = config;
  if (!bucket || !appUrl || !lambdaApiKey) {
    throw new Error('Report download links are not configured');
  }

  const fileIds = await Promise.all(attachments.map(async (attachment) => {
    const id = randomUUID();
    const copySource = [attachment.s3Bucket, ...attachment.s3Key.split('/')]
      .map(encodeURIComponent).join('/');
    const fallbackFilename = attachment.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    await storage.copyObject({
      Bucket: bucket,
      Key: 'report-downloads/' + id,
      CopySource: copySource,
      MetadataDirective: 'REPLACE',
      TaggingDirective: 'REPLACE',
      CacheControl: 'private, no-store',
      ContentType: attachment.contentType,
      ContentDisposition: 'attachment; filename="' + fallbackFilename +
        '"; filename*=UTF-8\'\'' + encodeHeaderFilename(attachment.name),
      ...(attachment.contentEncoding ? { ContentEncoding: attachment.contentEncoding } : {}),
    }).promise();
    return id;
  }));

  const response = await fetch(new URL('/api/v1/briefings/internal/report-downloads', appUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': lambdaApiKey },
    body: JSON.stringify({ bucket, fileIds }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error('Could not issue report download links (' + response.status + ')');
  }

  const { tokens } = await response.json();
  if (!Array.isArray(tokens) || tokens.length !== fileIds.length ||
      tokens.some((token) => typeof token !== 'string' || !token)) {
    throw new Error('Invalid report download links response');
  }
  return attachments.map((attachment, index) => {
    const url = new URL('/api/v1/briefings/report-download', appUrl);
    url.searchParams.set('token', tokens[index]);
    return { name: attachment.rawName, format: attachment.format, url: url.toString() };
  });
}

module.exports = { prepareReportDownloadLinks };
