const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SenderDomainRequestError,
  createSenderDomainService,
} = require('./sender-domain');

const TOKENS = ['tokenOne', 'tokenTwo', 'tokenThree'];
const SIGNING_HOSTED_ZONE = 'dkim.amazonses.com';

function identityResponse(overrides = {}) {
  return {
    IdentityType: 'DOMAIN',
    VerifiedForSendingStatus: false,
    DkimAttributes: {
      Status: 'PENDING',
      Tokens: TOKENS,
      SigningHostedZone: SIGNING_HOSTED_ZONE,
    },
    ...overrides,
  };
}

function createService(send, overrides = {}) {
  return createSenderDomainService({
    emailProviderMode: 'SES',
    configuredSender: 'Semaphor <noreply@semaphor.cloud>',
    sesRegion: 'us-east-1',
    sesClient: { send },
    ...overrides,
  });
}

test('provider, domain, and platform guards run before any SES command', async () => {
  let calls = 0;
  const send = async () => {
    calls += 1;
    throw new Error('must not call SES');
  };

  await assert.rejects(
    createService(send, { emailProviderMode: 'EXTERNAL' }).setup(
      'respark.com',
      false
    ),
    (error) =>
      error instanceof SenderDomainRequestError &&
      error.code === 'UNSUPPORTED_PROVIDER'
  );
  await assert.rejects(
    createService(send).status('Respark.com'),
    (error) => error.code === 'INVALID_DOMAIN'
  );
  await assert.rejects(
    createService(send).setup('reports.semaphor.cloud', false),
    (error) => error.code === 'PLATFORM_DOMAIN'
  );
  assert.equal(calls, 0);
});

test('setup creates the exact identity and returns three SigningHostedZone CNAMEs', async () => {
  const commands = [];
  const service = createService(async (command) => {
    commands.push(command);
    return identityResponse();
  });

  const result = await service.setup('respark.com', false);

  assert.deepEqual(commands.map((command) => command.constructor.name), [
    'CreateEmailIdentityCommand',
  ]);
  assert.deepEqual(commands[0].input, { EmailIdentity: 'respark.com' });
  assert.deepEqual(result, {
    success: true,
    verificationStatus: 'PENDING',
    dnsRecords: TOKENS.map((token) => ({
      type: 'CNAME',
      name: `${token}._domainkey.respark.com`,
      value: `${token}.${SIGNING_HOSTED_ZONE}`,
    })),
  });
});

test('exact identity proof requires DOMAIN, DKIM SUCCESS, and verified-for-sending', async () => {
  const responses = [
    identityResponse({
      IdentityType: 'EMAIL_ADDRESS',
      VerifiedForSendingStatus: true,
      DkimAttributes: {
        Status: 'PENDING',
        Tokens: TOKENS,
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    }),
    identityResponse({
      VerifiedForSendingStatus: true,
      DkimAttributes: {
        Status: 'PENDING',
        Tokens: TOKENS,
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    }),
    identityResponse({
      VerifiedForSendingStatus: false,
      DkimAttributes: {
        Status: 'SUCCESS',
        Tokens: TOKENS,
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    }),
    identityResponse({
      VerifiedForSendingStatus: true,
      DkimAttributes: {
        Status: 'SUCCESS',
        Tokens: TOKENS,
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    }),
  ];
  const service = createService(async () => responses.shift());

  assert.equal(
    (await service.status('reports.respark.com')).verificationStatus,
    'FAILED'
  );
  assert.equal(
    (await service.status('reports.respark.com')).verificationStatus,
    'PENDING',
    'parent-inherited send permission cannot verify a pending exact identity'
  );
  assert.equal(
    (await service.status('reports.respark.com')).verificationStatus,
    'FAILED'
  );
  assert.equal(
    (await service.status('reports.respark.com')).verificationStatus,
    'VERIFIED'
  );
});

test('initial setup refuses an existing identity without inspecting it', async () => {
  const commands = [];
  const service = createService(async (command) => {
    commands.push(command);
    const error = new Error('already exists');
    error.name = 'AlreadyExistsException';
    throw error;
  });

  await assert.rejects(
    service.setup('respark.com', false),
    (error) =>
      error.code === 'IDENTITY_EXISTS' && error.statusCode === 409
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    'CreateEmailIdentityCommand',
  ]);
});

test('explicit ambiguous retry inspects an existing identity', async () => {
  const commands = [];
  const service = createService(async (command) => {
    commands.push(command);
    if (command.constructor.name === 'CreateEmailIdentityCommand') {
      const error = new Error('already exists');
      error.name = 'AlreadyExistsException';
      throw error;
    }
    return identityResponse();
  });

  const result = await service.setup('respark.com', true);

  assert.equal(result.verificationStatus, 'PENDING');
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    'CreateEmailIdentityCommand',
    'GetEmailIdentityCommand',
  ]);
  assert.deepEqual(commands[1].input, { EmailIdentity: 'respark.com' });
});

test('missing status identity returns FAILED without creating it', async () => {
  const commands = [];
  const service = createService(async (command) => {
    commands.push(command);
    const error = new Error('not found');
    error.name = 'NotFoundException';
    throw error;
  });

  assert.deepEqual(await service.status('respark.com'), {
    success: true,
    verificationStatus: 'FAILED',
    dnsRecords: [],
  });
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    'GetEmailIdentityCommand',
  ]);
});

test('delete removes the exact identity and treats missing as already removed', async () => {
  const commands = [];
  const service = createService(async (command) => {
    commands.push(command);
    if (commands.length === 2) {
      const error = new Error('not found');
      error.name = 'NotFoundException';
      throw error;
    }
    return {};
  });

  assert.deepEqual(await service.delete('respark.com'), { success: true });
  assert.deepEqual(await service.delete('respark.com'), { success: true });
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    'DeleteEmailIdentityCommand',
    'DeleteEmailIdentityCommand',
  ]);
  assert.deepEqual(commands[0].input, { EmailIdentity: 'respark.com' });
});

for (const [name, response] of [
  [
    'missing SigningHostedZone',
    identityResponse({
      DkimAttributes: { Status: 'PENDING', Tokens: TOKENS },
    }),
  ],
  [
    'wrong token count',
    identityResponse({
      DkimAttributes: {
        Status: 'PENDING',
        Tokens: TOKENS.slice(0, 2),
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    }),
  ],
  [
    'duplicate tokens',
    identityResponse({
      DkimAttributes: {
        Status: 'PENDING',
        Tokens: [TOKENS[0], TOKENS[0], TOKENS[2]],
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    }),
  ],
  [
    'malformed SigningHostedZone',
    identityResponse({
      DkimAttributes: {
        Status: 'PENDING',
        Tokens: TOKENS,
        SigningHostedZone: 'dkim..amazonses.com',
      },
    }),
  ],
]) {
  test(`invalid SES response rejects ${name} as an ambiguous 5xx failure`, async () => {
    const service = createService(async () => response);
    await assert.rejects(
      service.status('respark.com'),
      (error) =>
        error.code === 'DOMAIN_OPERATION_FAILED' && error.statusCode === 502
    );
  });
}

test('constructed records that exceed DNS name length are invalid', async () => {
  const longDomain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(60)}`;
  const service = createService(async () =>
    identityResponse({
      DkimAttributes: {
        Status: 'PENDING',
        Tokens: ['d'.repeat(63), 'e'.repeat(63), 'f'.repeat(63)],
        SigningHostedZone: SIGNING_HOSTED_ZONE,
      },
    })
  );

  await assert.rejects(
    service.status(longDomain),
    (error) =>
      error.code === 'DOMAIN_OPERATION_FAILED' && error.statusCode === 502
  );
});
