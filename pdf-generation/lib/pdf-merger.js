// Use standard pdf-lib for merging (encryption is handled separately)
import { PDFDocument } from 'pdf-lib';

/**
 * Merges multiple PDF buffers into a single PDF document
 * @param {Buffer[]} pdfBuffers - Array of PDF buffers to merge
 * @returns {Promise<Buffer>} - Merged PDF as a buffer
 */
export async function mergePDFs(pdfBuffers) {
  if (!pdfBuffers || pdfBuffers.length === 0) {
    throw new Error('No PDF buffers provided for merging');
  }
  
  if (pdfBuffers.length === 1) {
    // No need to merge if only one PDF
    return pdfBuffers[0];
  }
  
  console.log(`Merging ${pdfBuffers.length} PDFs...`);
  
  try {
    // Create a new PDF document
    const mergedPdf = await PDFDocument.create();
    
    // Process each PDF buffer
    for (let i = 0; i < pdfBuffers.length; i++) {
      const pdfBuffer = pdfBuffers[i];
      
      if (!pdfBuffer || pdfBuffer.length === 0) {
        console.warn(`Skipping empty PDF buffer at index ${i}`);
        continue;
      }
      
      try {
        // Load the PDF from buffer
        const pdf = await PDFDocument.load(pdfBuffer);
        
        // Copy all pages from the source PDF
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        
        // Add each page to the merged document
        pages.forEach(page => {
          mergedPdf.addPage(page);
        });
        
        console.log(`Added ${pages.length} pages from PDF ${i + 1}`);
      } catch (error) {
        console.error(`Error processing PDF at index ${i}:`, error);
        throw new Error(`Failed to merge PDF at index ${i}: ${error.message}`);
      }
    }
    
    // Get total page count
    const pageCount = mergedPdf.getPageCount();
    console.log(`Merged PDF contains ${pageCount} total pages`);
    
    if (pageCount === 0) {
      throw new Error('Merged PDF has no pages');
    }
    
    // Save the merged PDF as a buffer
    const mergedPdfBytes = await mergedPdf.save();
    const mergedBuffer = Buffer.from(mergedPdfBytes);
    
    console.log(`Successfully merged PDFs. Final size: ${mergedBuffer.length} bytes`);
    
    return mergedBuffer;
  } catch (error) {
    console.error('Error during PDF merging:', error);
    throw error;
  }
}

/**
 * Merges PDFs with sheet information for better organization
 * @param {Array<{buffer: Buffer, sheetId: string, title: string}>} pdfSheets - Array of PDF buffers with metadata
 * @returns {Promise<Buffer>} - Merged PDF as a buffer
 */
export async function mergePDFsWithMetadata(pdfSheets) {
  if (!pdfSheets || pdfSheets.length === 0) {
    throw new Error('No PDF sheets provided for merging');
  }
  
  console.log('Merging PDFs with metadata:');
  pdfSheets.forEach((sheet, index) => {
    console.log(`  ${index + 1}. ${sheet.title} (ID: ${sheet.sheetId})`);
  });
  
  // Extract just the buffers for merging
  const buffers = pdfSheets.map(sheet => sheet.buffer);
  
  return mergePDFs(buffers);
}