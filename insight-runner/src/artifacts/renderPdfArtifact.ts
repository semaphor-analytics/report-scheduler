import { writeFile } from "node:fs/promises";
import { renderHtmlArtifact } from "./renderHtmlArtifact.js";

export interface PdfArtifact {
  path?: string;
  bytes: Uint8Array;
}

export async function writePdfArtifact(input: {
  markdown: string;
  outputPath: string;
  html?: string;
}): Promise<PdfArtifact> {
  const bytes = renderInsightLoopPdf({
    markdown: input.markdown,
    html: input.html,
  });
  await writeFile(input.outputPath, bytes);
  return {
    path: input.outputPath,
    bytes,
  };
}

export function renderInsightLoopPdf(input: {
  markdown: string;
  html?: string;
}): Uint8Array {
  const html =
    input.html ??
    renderHtmlArtifact({
      markdown: input.markdown,
    });
  const lines = htmlToPdfLines(html);
  const content = renderPdfContent(lines);
  const contentLength = Buffer.byteLength(content, "utf8");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body, "utf8"));
}

function htmlToPdfLines(html: string): string[] {
  const textLines = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, (_match, code) =>
      `\nSQL:\n${decodeHtml(String(code))}\n`,
    )
    .replace(/<\/h1>/gi, "\n")
    .replace(/<\/h2>/gi, "\n")
    .replace(/<\/h3>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "* ")
    .replace(/<[^>]+>/g, "")
    .split(/\r?\n/)
    .map((line) => decodeHtml(line).trim())
    .filter((line, index, lines) => line || lines[index - 1]);

  return wrapLines(textLines, 92).slice(0, 58);
}

function wrapLines(lines: string[], width: number): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.length <= width) {
      wrapped.push(line);
      continue;
    }

    let remaining = line;
    while (remaining.length > width) {
      const breakAt = remaining.lastIndexOf(" ", width);
      const index = breakAt > 20 ? breakAt : width;
      wrapped.push(remaining.slice(0, index));
      remaining = remaining.slice(index).trimStart();
    }
    wrapped.push(remaining);
  }
  return wrapped;
}

function renderPdfContent(lines: string[]): string {
  const operations = ["BT", "/F1 10 Tf", "50 750 Td", "14 TL"];
  lines.forEach((line, index) => {
    if (index > 0) {
      operations.push("T*");
    }
    operations.push(`(${escapePdfText(line)}) Tj`);
  });
  operations.push("ET");
  return operations.join("\n");
}

function escapePdfText(value: string): string {
  return stripUnsupportedPdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function stripUnsupportedPdfText(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    })
    .join("");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
