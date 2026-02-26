import AWS from 'aws-sdk';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';
import { generatePdfFromData } from './lib/pdf-from-data-generator.js';

// Initialize S3 client
const s3 = new AWS.S3();

function sanitizeFilenameBase(name, fallback = 'Report') {
  const safe = String(name || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return (safe || fallback).slice(0, 120);
}

function buildExportFilename(name, extension) {
  const base = sanitizeFilenameBase(name, 'Report');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}-${stamp}.${extension}`;
}

/**
 * Handle data-direct POST requests (fast path)
 * Receives pre-organized table structure and generates PDF without URL rendering
 */
async function handleDataDirectRequest(event) {
  try {
    // Parse request body
    const payload = JSON.parse(event.body);
    console.log('Data-direct payload received:', {
      cardType: payload.cardType,
      reportTitle: payload.reportTitle,
      rows: payload.tableStructure?.rows?.length || 0,
    });

    // Validate payload
    if (!payload.cardType || !payload.tableStructure || !payload.reportTitle) {
      throw new Error('Missing required fields: cardType, tableStructure, reportTitle');
    }

    // Normalize defaults expected by generator
    payload.pageSize = payload.pageSize || 'Letter';
    payload.orientation = payload.orientation || 'portrait';
    payload.timezone = payload.timezone || 'UTC';
    payload.filterLine = payload.filterLine || '';
    payload.wideTableStrategy = payload.wideTableStrategy || 'auto';
    payload.rowCount =
      typeof payload.rowCount === 'number'
        ? payload.rowCount
        : payload.tableStructure?.rows?.length || 0;

    const options = {
      isLambda: true,
      wideTableStrategy: payload.wideTableStrategy,
    };

    console.log('Generating PDF from data with options:', options);

    // Generate PDF from data
    let pdfBuffer = await generatePdfFromData(payload, options);
    const layoutApplied = pdfBuffer?.layoutApplied || null;

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Empty PDF buffer generated');
    }

    console.log('PDF generated successfully:', pdfBuffer.length, 'bytes');

    // Upload to S3
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('S3_BUCKET_NAME environment variable is not set');
    }

    const outputFilename = buildExportFilename(payload.reportTitle, 'pdf');
    const fileKey = `pdfs/${outputFilename}`;
    console.log('Uploading to S3:', fileKey);

    const uploadParams = {
      Bucket: bucketName,
      Key: fileKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ACL: 'private',
    };

    await s3.putObject(uploadParams).promise();
    console.log('PDF uploaded to S3:', `${bucketName}/${fileKey}`);

    // Generate presigned URL
    const presignedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucketName,
      Key: fileKey,
      Expires: 60 * 60, // 1 hour expiry
      ResponseContentDisposition: `attachment; filename="${outputFilename}"`,
    });

    console.log('Returning presigned URL');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({ url: presignedUrl, layoutApplied }),
    };
  } catch (error) {
    console.error('Data-direct PDF generation error:', error);
    return {
      statusCode: error.message?.includes('invalid') ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message || 'Internal server error',
        error: error.message,
      }),
    };
  }
}

export const handler = async (event) => {
  try {
    // Check if this is a data-direct POST request (fast path)
    // Lambda Function URLs use requestContext.http.method, not httpMethod
    const method = event.requestContext?.http?.method || event.httpMethod;

    console.log('Lambda invocation - Method:', method, 'Has body:', !!event.body);

    if (event.body && method === 'POST') {
      console.log('Detected data-direct POST request (fast path)');
      return await handleDataDirectRequest(event);
    }

    // Traditional URL-based request
    console.log('Using traditional URL-based PDF generation');

    // Extract parameters from query string
    const url = event?.queryStringParameters?.url;
    const email = event?.queryStringParameters?.email;
    const subject = event?.queryStringParameters?.subject;
    const scheduleId = event?.queryStringParameters?.scheduleId;
    const leaseOwner = event?.queryStringParameters?.leaseOwner;
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
    console.log('Url:', url);

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

    const tableMode = event?.queryStringParameters?.tableMode === 'true';
    // Detect if this is a single visual export (URL contains /visual/) unless explicitly in table mode
    // Visual exports support pageSize and orientation settings
    const isVisualExport = url ? url.includes('/visual/') && !tableMode : false;

    // Parse watermark settings
    const watermarkEnabled =
      event?.queryStringParameters?.watermarkEnabled === 'true';
    const watermarkText = event?.queryStringParameters?.watermarkText || '';

    // Parse header logo URL (for visual-view.tsx rendering)
    const headerLogoUrl = event?.queryStringParameters?.headerLogoUrl || '';

    // Parse expanded state for custom components (if provided)
    const expandedState = event?.queryStringParameters?.expandedState || null;

    // Generation options
    const options = {
      isLambda: true,
      tableMode: tableMode,
      pageSize: event?.queryStringParameters?.pageSize || 'A4',
      orientation: event?.queryStringParameters?.orientation || 'portrait',
      wideTableStrategy: event?.queryStringParameters?.wideTableStrategy || 'auto',
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
      isVisualExport: isVisualExport,
      watermarkEnabled: watermarkEnabled,
      watermarkText: watermarkText,
      expandedState: expandedState,
    };

    console.log(
      'Lambda handler - Format:',
      format,
      'ScheduleId:',
      scheduleId || 'none',
      'IsVisualExport:',
      isVisualExport
    );
    if (isVisualExport) {
      console.log('  Visual export - PageSize:', options.pageSize, 'Orientation:', options.orientation);
    }
    if (watermarkEnabled) {
      console.log('  Watermark enabled:', watermarkText);
    }
    if (headerLogoUrl) {
      console.log('  Header logo URL provided');
    }
    if (expandedState) {
      console.log('  Expanded state provided for custom components');
    }
    if (attachmentMetadata?.name) {
      console.log(
        'Processing attachment:',
        attachmentMetadata.name,
        `(${attachmentMetadata.attachmentIndex + 1}/${
          attachmentMetadata.totalAttachments
        })`
      );
    }

    // Append headerLogoUrl to view URL if provided (visual-view.tsx reads from searchParams)
    let targetUrl = url;
    if (headerLogoUrl) {
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.set('headerLogoUrl', headerLogoUrl);
        targetUrl = urlObj.toString();
        console.log('  URL updated with headerLogoUrl');
      } catch (e) {
        console.error('Error adding headerLogoUrl to URL:', e);
      }
    }

    // Generate file based on format
    let fileBuffer;
    let contentType;
    let fileExtension;

    if (format === 'csv') {
      console.log('Generating CSV file');
      fileBuffer = await generateCsv(targetUrl, options);
      contentType = 'text/csv';
      fileExtension = 'csv';
    } else {
      console.log('Generating PDF file');
      fileBuffer = await generatePdf(targetUrl, options);
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
        leaseOwner: leaseOwner || '',
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

    const outputFilename = buildExportFilename(
      attachmentMetadata?.name || options.reportTitle || 'Report',
      fileExtension,
    );
    const fileKey = `${prefix}/${outputFilename}`;
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
      ResponseContentDisposition: `attachment; filename="${outputFilename}"`,
    });

    const layoutApplied = format === 'pdf' ? fileBuffer?.layoutApplied || null : null;

    console.log('Returning presigned URL.');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
      body: JSON.stringify({
        url: presignedUrl,
        ...(layoutApplied ? { layoutApplied } : {}),
      }),
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
