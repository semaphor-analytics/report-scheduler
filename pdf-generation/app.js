import AWS from 'aws-sdk';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';

// Initialize S3 client
const s3 = new AWS.S3();

export const handler = async (event) => {
  try {
    // Extract parameters from query string
    const url = event?.queryStringParameters?.url;
    const email = event?.queryStringParameters?.email;
    const subject = event?.queryStringParameters?.subject;
    const scheduleId = event?.queryStringParameters?.scheduleId;
    const format = event?.queryStringParameters?.format || 'pdf';

    // Parse attachment metadata if provided
    let attachmentMetadata = {};
    const attachmentMetadataRaw =
      event?.queryStringParameters?.attachmentMetadata;
    if (attachmentMetadataRaw) {
      try {
        attachmentMetadata = JSON.parse(attachmentMetadataRaw);
        console.log('Parsed attachmentMetadata:', attachmentMetadata);
      } catch (e) {
        console.error('Error parsing attachmentMetadata:', e);
        attachmentMetadata = {};
      }
    }

    // Url
    // console.log('Url:', url);

    // Parse reportParams if provided
    let reportParams = {};
    const reportParamsRaw = event?.queryStringParameters?.reportParams;
    console.log('Raw reportParams received:', reportParamsRaw);

    if (reportParamsRaw) {
      try {
        reportParams = JSON.parse(reportParamsRaw);
        console.log('Parsed reportParams successfully:', reportParams);
      } catch (e) {
        console.error('Error parsing reportParams:', e);
        console.error('Raw value was:', reportParamsRaw);
        reportParams = {};
      }
    } else {
      console.log('No reportParams provided in query parameters');
    }

    // Generation options
    const options = {
      isLambda: true,
      tableMode: event?.queryStringParameters?.tableMode === 'true',
      pageSize: event?.queryStringParameters?.pageSize || 'A4',
      orientation: event?.queryStringParameters?.orientation || 'portrait',
      password: event?.queryStringParameters?.password,
      reportTitle:
        attachmentMetadata?.name ||
        event?.queryStringParameters?.reportTitle ||
        'Report',
      filterLine: event?.queryStringParameters?.filterLine || '',
      timezone: event?.queryStringParameters?.timezone || 'UTC',
      debug: false,
      scheduleId: scheduleId,
      reportParams: reportParams,
      format: format,
      delimiter: event?.queryStringParameters?.delimiter || ',',
    };

    console.log(
      'Lambda handler - Format:',
      format,
      'ScheduleId:',
      scheduleId || 'none'
    );
    if (attachmentMetadata?.name) {
      console.log(
        'Processing attachment:',
        attachmentMetadata.name,
        `(${attachmentMetadata.attachmentIndex + 1}/${
          attachmentMetadata.totalAttachments
        })`
      );
    }

    // Generate file based on format
    let fileBuffer;
    let contentType;
    let fileExtension;

    if (format === 'csv') {
      console.log('Generating CSV file');
      fileBuffer = await generateCsv(url, options);
      contentType = 'text/csv';
      fileExtension = 'csv';
    } else {
      console.log('Generating PDF file');
      fileBuffer = await generatePdf(url, options);
      contentType = 'application/pdf';
      fileExtension = 'pdf';
    }

    // Upload the PDF to S3
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    // Determine S3 prefix based on whether this is a scheduled report
    let prefix = 'pdfs';
    let tags = {};

    if (scheduleId) {
      // For scheduled reports, use emails prefix and minimal tags
      prefix = 'emails';
      tags = {
        scheduleId: scheduleId || 'unknown',
        recipients: email || 'none',
        format: format || 'pdf',
        attachmentName: attachmentMetadata?.name || 'Report',
        attachmentIndex: String(attachmentMetadata?.attachmentIndex ?? 0),
        totalAttachments: String(attachmentMetadata?.totalAttachments ?? 1),
      };
    } else if (email) {
      // For direct email requests (non-scheduled), keep existing behavior
      prefix = 'emails';
      tags = {
        email: email || '',
        subject: subject || '',
        scheduleId: '', // Empty for non-scheduled
      };
    }

    const fileKey = `${prefix}/document-${Date.now()}.${fileExtension}`;
    console.log('S3 upload:', fileKey, '- Format:', format);

    // Function to sanitize tag values for S3 requirements
    // S3 tags can only contain: Unicode letters, whitespace, numbers, +, -, =, ., _, :, /, @
    const sanitizeTagValue = (value) => {
      if (!value) return '';
      // Replace invalid characters with underscores
      // Keep: letters, numbers, spaces, +, -, =, ., _, :, /, @
      return String(value).replace(/[^a-zA-Z0-9\s+\-=._:/@]/g, '_');
    };

    // Validate and sanitize tags - S3 doesn't accept empty or undefined values
    const sanitizedTags = {};
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined && value !== null && value !== '') {
        const stringValue = String(value);
        // Don't sanitize recipients field - we need commas for email list
        // Instead, we'll skip it entirely from tags since Email Sender fetches from API
        if (key === 'recipients') {
          // Skip recipients tag - Email Sender will get from API
          continue;
        }
        const sanitizedValue = sanitizeTagValue(stringValue);
        sanitizedTags[key] = sanitizedValue;
      }
    }

    // Convert tags to URL-encoded string format
    const tagging = Object.entries(sanitizedTags)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      )
      .join('&');

    const uploadParams = {
      Bucket: bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: 'private',
    };

    // Only add Tagging if we have valid tags
    if (tagging) {
      uploadParams.Tagging = tagging;
    }

    console.log(`Uploading ${fileExtension.toUpperCase()} to S3...`);
    await s3.putObject(uploadParams).promise();
    console.log(
      `${fileExtension.toUpperCase()} uploaded to S3: ${bucketName}/${fileKey}`
    );

    // Generate presigned URL for download
    const presignedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucketName,
      Key: fileKey,
      Expires: 60 * 60, // 1 hour expiry
      ResponseContentDisposition:
        'attachment; filename="' + fileKey.split('/').pop() + '"',
    });

    console.log('Returning presigned URL.');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ url: presignedUrl }),
    };
  } catch (error) {
    console.error('Lambda Handler Error:', error);
    return {
      statusCode: error.message?.includes('invalid') ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message || 'Internal server error',
        error: error.message,
      }),
    };
  }
};
