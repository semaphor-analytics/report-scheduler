const {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityDkimSigningAttributesCommand,
  SESv2Client,
} = require('@aws-sdk/client-sesv2');

const { isValidSendingDomain, parseSendingAddress } = require('./branding');
const { parseConfiguredSender } = require('./envelope');

const SENDER_DOMAIN_SETUP_ACTION = 'sender_domain_setup';
const SENDER_DOMAIN_STATUS_ACTION = 'sender_domain_status';
const SENDER_DOMAIN_DELETE_ACTION = 'sender_domain_delete';

class SenderDomainRequestError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'SenderDomainRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function isPlatformDomain(domain, platformDomain) {
  return domain === platformDomain || domain.endsWith(`.${platformDomain}`);
}

function isNamedAwsError(error, name) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error.name === name || error.Code === name || error.code === name)
  );
}

function isSafeDnsText(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1024 &&
    value === value.trim() &&
    /^[\x21-\x7e]+$/u.test(value)
  );
}

function isValidSigningHostedZone(value) {
  if (!isSafeDnsText(value)) {
    return false;
  }
  const hostname = value.endsWith('.') ? value.slice(0, -1) : value;
  if (hostname.length < 3 || hostname.length > 253) {
    return false;
  }
  const labels = hostname.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label)
    )
  );
}

function isValidDnsRecordName(value) {
  const maximumLength = value.endsWith('.') ? 254 : 253;
  return isSafeDnsText(value) && value.length <= maximumLength;
}

function getDkimDnsRecords(domain, response) {
  const tokens = response?.DkimAttributes?.Tokens;
  const signingHostedZone = response?.DkimAttributes?.SigningHostedZone;
  if (
    !Array.isArray(tokens) ||
    tokens.length !== 3 ||
    new Set(tokens.map((token) => String(token).toLowerCase())).size !== 3 ||
    !isValidSigningHostedZone(signingHostedZone)
  ) {
    throw invalidSesResponse();
  }

  const records = tokens.map((token) => {
    if (
      !isSafeDnsText(token) ||
      token.length > 63 ||
      !/^[a-z0-9_-]+$/iu.test(token)
    ) {
      throw invalidSesResponse();
    }
    return {
      type: 'CNAME',
      name: `${token}._domainkey.${domain}`,
      value: `${token}.${signingHostedZone}`,
    };
  });

  if (
    records.some(
      (record) =>
        !isValidDnsRecordName(record.name) ||
        !isValidDnsRecordName(record.value)
    )
  ) {
    throw invalidSesResponse();
  }

  return records;
}

function mapVerificationStatus(response) {
  const dkimStatus = response?.DkimAttributes?.Status;
  if (response?.IdentityType !== 'DOMAIN') {
    return 'FAILED';
  }
  if (
    dkimStatus === 'SUCCESS' &&
    response?.VerifiedForSendingStatus === true
  ) {
    return 'VERIFIED';
  }
  if (
    dkimStatus === 'PENDING' ||
    dkimStatus === 'TEMPORARY_FAILURE' ||
    dkimStatus === 'NOT_STARTED'
  ) {
    return 'PENDING';
  }
  return 'FAILED';
}

function invalidSesResponse() {
  return new SenderDomainRequestError(
    'DOMAIN_OPERATION_FAILED',
    'The email service returned an invalid domain response.',
    502
  );
}

function domainOperationFailed(error) {
  if (error instanceof SenderDomainRequestError) {
    return error;
  }
  return new SenderDomainRequestError(
    'DOMAIN_OPERATION_FAILED',
    error instanceof Error ? error.message : 'The domain operation failed.',
    502
  );
}

function createSenderDomainService({
  emailProviderMode,
  configuredSender,
  sesRegion = 'us-east-1',
  sesClient,
} = {}) {
  let resolvedClient = sesClient || null;

  function requireDomain(domain) {
    if (emailProviderMode !== 'SES') {
      throw new SenderDomainRequestError(
        'UNSUPPORTED_PROVIDER',
        'Sending-domain setup is only available with the SES email provider.',
        400
      );
    }
    if (!isValidSendingDomain(domain)) {
      throw new SenderDomainRequestError(
        'INVALID_DOMAIN',
        'domain must be a valid lowercase DNS name',
        400
      );
    }

    let platformDomain;
    try {
      const platformAddress = parseConfiguredSender(configuredSender).address;
      platformDomain = parseSendingAddress(
        platformAddress,
        'configuredSender'
      ).domain;
    } catch (error) {
      throw domainOperationFailed(error);
    }
    if (isPlatformDomain(domain, platformDomain)) {
      throw new SenderDomainRequestError(
        'PLATFORM_DOMAIN',
        'Use a domain controlled by the organization.',
        400
      );
    }
  }

  function getClient() {
    if (!resolvedClient) {
      resolvedClient = new SESv2Client({ region: sesRegion });
    }
    return resolvedClient;
  }

  async function getIdentity(domain, { allowMissing = false } = {}) {
    try {
      return await getClient().send(
        new GetEmailIdentityCommand({ EmailIdentity: domain })
      );
    } catch (error) {
      if (allowMissing && isNamedAwsError(error, 'NotFoundException')) {
        return null;
      }
      throw domainOperationFailed(error);
    }
  }

  async function restartEasyDkim(domain, previous) {
    let restarted;
    try {
      restarted = await getClient().send(
        new PutEmailIdentityDkimSigningAttributesCommand({
          EmailIdentity: domain,
          SigningAttributesOrigin: 'AWS_SES',
          SigningAttributes: {
            NextSigningKeyLength:
              previous.DkimAttributes?.NextSigningKeyLength ??
              previous.DkimAttributes?.CurrentSigningKeyLength ??
              'RSA_2048_BIT',
          },
        })
      );
    } catch (error) {
      throw domainOperationFailed(error);
    }
    // The restart response carries the DKIM status and tokens but not the
    // identity type or sending status; keep those from the earlier read.
    return {
      ...previous,
      DkimAttributes: {
        ...previous.DkimAttributes,
        Status: restarted?.DkimStatus ?? previous.DkimAttributes?.Status,
        Tokens: restarted?.DkimTokens ?? previous.DkimAttributes?.Tokens,
        SigningHostedZone:
          restarted?.SigningHostedZone ??
          previous.DkimAttributes?.SigningHostedZone,
      },
    };
  }

  function normalizeIdentity(domain, response) {
    return {
      success: true,
      verificationStatus: mapVerificationStatus(response),
      dnsRecords: getDkimDnsRecords(domain, response),
    };
  }

  return {
    async setup(domain, allowExisting) {
      requireDomain(domain);
      if (typeof allowExisting !== 'boolean') {
        throw new SenderDomainRequestError(
          'INVALID_DOMAIN',
          'allowExisting must be a boolean',
          400
        );
      }

      let response;
      try {
        response = await getClient().send(
          new CreateEmailIdentityCommand({ EmailIdentity: domain })
        );
      } catch (error) {
        if (!isNamedAwsError(error, 'AlreadyExistsException')) {
          throw domainOperationFailed(error);
        }
        if (!allowExisting) {
          throw new SenderDomainRequestError(
            'IDENTITY_EXISTS',
            'This domain already exists in the email service.',
            409
          );
        }
        response = await getIdentity(domain);
      }

      return normalizeIdentity(domain, response);
    },

    async status(domain) {
      requireDomain(domain);
      let response = await getIdentity(domain, { allowMissing: true });
      if (!response) {
        return {
          success: true,
          verificationStatus: 'FAILED',
          dnsRecords: [],
        };
      }
      // SES searches DNS for 72 hours after setup and then marks Easy DKIM
      // FAILED and stops looking. An admin who published the records late
      // would otherwise stay FAILED forever, so a manual check on a failed
      // identity re-arms the search. This keeps the existing tokens; the
      // returned records are stored in case SES ever issues new ones.
      // Only plain Easy DKIM is restarted: the restart call sets the signing
      // method to AWS_SES, so on a BYODKIM (EXTERNAL) or regional
      // (AWS_SES_<REGION>) identity it would replace the owner's DKIM setup.
      if (
        response.IdentityType === 'DOMAIN' &&
        response.DkimAttributes?.Status === 'FAILED' &&
        response.DkimAttributes?.SigningAttributesOrigin === 'AWS_SES'
      ) {
        response = await restartEasyDkim(domain, response);
      }
      return normalizeIdentity(domain, response);
    },

    async delete(domain) {
      requireDomain(domain);
      try {
        await getClient().send(
          new DeleteEmailIdentityCommand({ EmailIdentity: domain })
        );
      } catch (error) {
        // Retried removal is successful when the first request deleted the
        // identity but its response was lost.
        if (!isNamedAwsError(error, 'NotFoundException')) {
          throw domainOperationFailed(error);
        }
      }
      return { success: true };
    },
  };
}

function handleSenderDomainAction(payload, config, dependencies = {}) {
  const service = createSenderDomainService({
    emailProviderMode: config.emailProviderMode,
    configuredSender: config.sesSenderEmail,
    sesRegion: config.sesRegion,
    sesClient: dependencies.sesClient,
  });
  if (payload?.action === SENDER_DOMAIN_SETUP_ACTION) {
    return service.setup(payload.domain, payload.allowExisting);
  }
  if (payload?.action === SENDER_DOMAIN_STATUS_ACTION) {
    return service.status(payload.domain);
  }
  if (payload?.action === SENDER_DOMAIN_DELETE_ACTION) {
    return service.delete(payload.domain);
  }
  throw new SenderDomainRequestError(
    'INVALID_DOMAIN',
    'Unsupported sending-domain action.',
    400
  );
}

module.exports = {
  SENDER_DOMAIN_SETUP_ACTION,
  SENDER_DOMAIN_STATUS_ACTION,
  SENDER_DOMAIN_DELETE_ACTION,
  SenderDomainRequestError,
  createSenderDomainService,
  getDkimDnsRecords,
  handleSenderDomainAction,
  mapVerificationStatus,
};
