const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const YAML = require('yaml');
const { matrixAttemptKey } = require('react-semaphor/format-utils');

const template = YAML.parse(readFileSync(join(__dirname, '../template.yaml'), 'utf8'), {
  customTags: ['!Ref', '!Sub', '!GetAtt'].map(tag => ({ tag, resolve: (_doc, node) => {
    assert.equal(typeof node.strValue, 'string');
    return node.strValue;
  } })),
});

test('existing email role can read final Matrix artifacts, not checkpoints or chunks', () => {
  const resources = template.Resources;
  assert.equal(resources.EmailSenderFunction.Properties.Role, 'EmailSenderFunctionRole.Arn');
  const role = resources.EmailSenderFunctionRole.Properties.Policies[0].PolicyDocument.Statement
    .find(statement => statement.Action.includes('s3:GetObject'));
  const bucket = resources.PdfBucketPolicy.Properties.PolicyDocument.Statement
    .find(statement => statement.Sid === 'AllowLambdaAccessEmailSender');
  assert.equal(bucket.Principal.AWS, 'EmailSenderFunctionRole.Arn');
  for (const statement of [role, bucket]) {
    assert.deepEqual(statement.Action, ['s3:GetObject']);
    const exportResources = statement.Resource.filter(resource => resource.includes('/exports/'));
    assert.equal(exportResources.length, 1);
    const path = exportResources[0].split('/').slice(1);
    assert.deepEqual(path, ['exports', '*', 'attempts', '*', 'export.csv.gz']);
    const key = matrixAttemptKey('job', 'attempt', 'export.csv.gz').split('/');
    assert.ok(path.every((part, index) => part === '*' || part === key[index]));
    assert.equal(path.length, key.length);
  }
});
