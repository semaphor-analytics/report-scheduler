const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const YAML = require('yaml');

const template = YAML.parse(readFileSync(join(__dirname, '../template.yaml'), 'utf8'), {
  customTags: ['!Ref', '!Sub', '!GetAtt'].map(tag => ({ tag, resolve: (_doc, node) => {
    assert.equal(typeof node.strValue, 'string');
    return node.strValue;
  } })),
});

test('existing email role can read final Matrix artifacts, not checkpoints or chunks', async () => {
  const { matrixAttemptKey } = await import('react-semaphor/format-utils');
  const resources = template.Resources;
  assert.equal(resources.EmailSenderFunction.Properties.Role, 'EmailSenderFunctionRole.Arn');
  const role = resources.EmailSenderFunctionRole.Properties.Policies[0].PolicyDocument.Statement
    .find(statement => statement.Action.includes('s3:GetObject'));
  const bucket = resources.PdfBucketPolicy.Properties.PolicyDocument.Statement
    .find(statement => statement.Sid === 'AllowLambdaAccessEmailSender');
  assert.equal(bucket.Principal.AWS, 'EmailSenderFunctionRole.Arn');
  for (const statement of [role, bucket]) {
    assert.deepEqual(statement.Action, ['s3:GetObject']);
    // Every finished export file is granted (pinned by email-sender-file-access.test.js);
    // here, the Matrix attempt react-semaphor names is one of them, and no grant reaches a chunk.
    const paths = statement.Resource.filter(resource => resource.includes('/exports/'))
      .map(resource => resource.split('/').slice(1));
    assert.ok(paths.some(path => path.join('/') === 'exports/*/attempts/*/export.csv.gz'));
    const key = matrixAttemptKey('job', 'attempt', 'export.csv.gz').split('/');
    assert.ok(paths.some(path => path.length === key.length && path.every((part, index) => part === '*' || part === key[index])));
    assert.ok(paths.every(path => !path.includes('chunks') && !path.includes('checkpoints') && !path.at(-1).startsWith('*')));
  }
});

test('report copies have a dedicated write grant and outlive the emailed token', () => {
  const resources = template.Resources;
  const role = resources.EmailSenderFunctionRole.Properties.Policies[0].PolicyDocument.Statement
    .find(statement => statement.Action.includes('s3:PutObject'));
  const bucket = resources.PdfBucketPolicy.Properties.PolicyDocument.Statement
    .find(statement => statement.Sid === 'AllowEmailSenderToStoreReportDownloads');
  assert.equal(bucket.Principal.AWS, 'EmailSenderFunctionRole.Arn');
  for (const statement of [role, bucket]) {
    assert.deepEqual(statement.Action, ['s3:PutObject']);
    assert.equal(statement.Resource.length, 1);
    assert.ok(statement.Resource[0].endsWith('/report-downloads/*'));
  }
  assert.equal(resources.EmailSenderFunction.Properties.Environment.Variables.S3_BUCKET_NAME, 'PdfBucket');
  const rules = resources.PdfBucket.Properties.LifecycleConfiguration.Rules;
  assert.equal(rules.find(rule => rule.Prefix === 'exports/').ExpirationInDays, 1);
  const downloads = rules.find(rule => rule.Id === 'DeleteReportDownloads');
  assert.equal(downloads.Prefix, 'report-downloads/');
  assert.equal(downloads.ExpirationInDays, 8);
  assert.equal(downloads.Status, 'Enabled');
  assert.equal(downloads.NoncurrentVersionExpiration.NoncurrentDays, 1);
});
