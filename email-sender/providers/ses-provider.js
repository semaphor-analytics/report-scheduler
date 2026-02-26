const AWS = require('aws-sdk');
const { createRawEmail } = require('../lib/email-content');

function createSesProvider({ sesRegion = 'us-east-1' } = {}) {
  const ses = new AWS.SES({ region: sesRegion });

  return {
    name: 'SES',
    requiresFileBuffer: true,
    async send(message) {
      try {
        if (!message?.attachment?.fileBuffer) {
          throw new Error('Attachment fileBuffer is required for SES provider');
        }

        const rawEmail = createRawEmail({
          from: message.from,
          to: message.to,
          subject: message.subject,
          textBody: message.textBody,
          htmlBody: message.htmlBody,
          attachmentFilename: message.attachment.name,
          attachmentContentType: message.attachment.contentType,
          fileBuffer: message.attachment.fileBuffer,
        });

        const response = await ses
          .sendRawEmail({
            RawMessage: {
              Data: rawEmail,
            },
          })
          .promise();

        return {
          success: true,
          providerMessageId: response?.MessageId || null,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

module.exports = {
  createSesProvider,
};
