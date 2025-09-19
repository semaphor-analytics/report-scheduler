// Wrapper module to handle pdf-lib-with-encrypt 
// Using CommonJS version to avoid ES module issues with pako
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Use CommonJS version which handles pako correctly
const { PDFDocument } = require('pdf-lib-with-encrypt');

// Re-export PDFDocument
export { PDFDocument };

// Helper function to encrypt a PDF buffer
export async function encryptPdfBuffer(pdfBuffer, password, options = {}) {
  // Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  
  // Default permissions
  const defaultPermissions = {
    printing: 'highResolution',
    modifying: false,
    copying: false,
    annotating: false,
    fillingForms: true,
    contentAccessibility: true,
    documentAssembly: false,
  };
  
  // Encrypt the PDF
  pdfDoc.encrypt({
    userPassword: password,
    ownerPassword: options.ownerPassword || password,
    permissions: { ...defaultPermissions, ...options.permissions }
  });
  
  // Return encrypted buffer
  return await pdfDoc.save();
}