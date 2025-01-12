const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const cheerio = require("cheerio");
const textract = require("textract");
const iconv = require("iconv-lite");

async function extractTextFromCsv(content) {
  return content; // Process CSV content if needed
}

async function extractTextFromDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function extractTextFromPdf(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

// XML Path Helper
function getValueFromXmlPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    current = current[part];
    if (!current) return null;
  }
  return current.toString();
}

async function extractTextFromXml(content, paths = []) {
  const xml2js = require("xml2js");
  const parser = new xml2js.Parser();

  return new Promise((resolve, reject) => {
    parser.parseString(content, (err, result) => {
      if (err) {
        console.error("Error parsing XML:", err);
        return reject(err);
      }

      if (!paths || paths.length === 0) {
        resolve(JSON.stringify(result));
      } else {
        const extracted = paths
          .map((path) => getValueFromXmlPath(result, path))
          .filter(Boolean)
          .join(" ");
        resolve(extracted);
      }
    });
  });
}

async function extractTextFromJson(content, properties = []) {
  try {
    const jsonData = JSON.parse(content);
    if (!properties || properties.length === 0) {
      return JSON.stringify(jsonData);
    }

    const extracted = properties.map((prop) => jsonData[prop] || "").join(" ");
    return extracted;
  } catch (err) {
    console.error("Error extracting JSON content:", err);
    return null;
  }
}

// Text Extraction Functions
async function extractTextFromTxt(content) {
  return content;
}

async function extractTextFromXlsx(buffer) {
  const xlsx = require("xlsx");
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_csv(sheet);
}

async function extractTextFromHtml(htmlContent) {
  try {
    const $ = cheerio.load(htmlContent); // Load the HTML content
    return $("body").text().trim(); // Extract and return the text inside the <body> tag
  } catch (error) {
    console.error("Error extracting text from HTML:", error);
    throw new Error("Failed to extract text from HTML");
  }
}

async function extractTextFromPptxBuffer(buffer) {
  return new Promise((resolve, reject) => {
    textract.fromBufferWithMime(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer,
      (err, text) => {
        if (err) {
          console.error("Error extracting PPTX:", err);
          return reject(err);
        }
        resolve(text || "");
      }
    );
  });
}

async function extractTextFromCsvBuffer(buffer) {
  return buffer.toString("utf-8");
}

async function extractTextFromXmlBuffer(buffer) {
  const xml2js = require("xml2js");
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(buffer.toString("utf-8"));
  return JSON.stringify(result);
}

// Extract Text from RTF (Placeholder)
async function extractTextFromRtf(buffer) {
  return buffer.toString("utf-8");
}

async function extractTextFromHtmlBuffer(buffer) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(buffer.toString("utf-8"));
  return $("body").text().trim();
}

async function processFieldContent(content, fieldType) {
  switch (fieldType.toUpperCase()) {
    case "TXT":
      return extractTextFromTxt(content);

    case "JSON":
      return extractTextFromJson(content);

    case "XML":
      return extractTextFromXml(content);

    case "HTML":
      return extractTextFromHtml(content);

    case "XLSX":
      return extractTextFromXlsx(Buffer.from(content, "binary"));

    case "PDF":
      return extractTextFromPdf(Buffer.from(content, "binary"));

    case "DOC":
    case "DOCX":
      return extractTextFromDocx(Buffer.from(content, "binary"));

    case "CSV":
      return extractTextFromCsv(content);

    default:
      console.log(`Unsupported field type: ${fieldType}`);
      return null;
  }
}

function normalizeEncoding(buffer) {
  try {
    // Decode the buffer using UTF-8
    const decodedContent = iconv.decode(buffer, "utf-8");
    console.log(
      "Decoded content (first 50 chars):",
      decodedContent.slice(0, 50)
    );
    return decodedContent;
  } catch (error) {
    console.error("Encoding normalization failed:", error.message);
    return buffer.toString("utf-8"); // Fallback to UTF-8 string conversion
  }
}

// Detect MIME Type from Buffer
async function detectMimeType(input) {
  const { fileTypeFromBuffer } = await import("file-type");

  try {
    let buffer;

    // Check if the input is a string
    if (typeof input === "string") {
      console.log("Input is a string, converting to buffer...");
      buffer = Buffer.from(input, "utf-8");
    } else if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
      buffer = Buffer.from(input);
    } else {
      throw new Error(
        "Expected the 'input' argument to be of type 'Uint8Array', 'ArrayBuffer', or 'string'."
      );
    }

    console.log(
      "Buffer first 20 bytes (hex):",
      buffer.slice(0, 20).toString("hex")
    );

    // Use file-type to detect MIME type
    const fileTypeResult = await fileTypeFromBuffer(buffer);

    if (fileTypeResult) {
      console.log(`Detected MIME type using file-type: ${fileTypeResult.mime}`);
      return fileTypeResult.mime;
    }

    const content = buffer.toString("utf-8").trim();

    if (content.startsWith("<!DOCTYPE html") || content.startsWith("<html")) {
      return "text/html";
    }

    // Normalize the encoding and analyze the content
    const normalizedContent = await normalizeEncoding(buffer);

    // Check for UTF-8 compliance using heuristic
    if (isUtf8(buffer)) {
      console.log("Content is UTF-8 encoded text.");
      return "text/plain";
    }

    // Fallback plain text detection
    const isPlainText = /^[\x20-\x7E\r\n\t]*$/.test(normalizedContent);
    if (isPlainText) {
      console.log("Content matches plain text heuristics.");
      return "text/plain";
    }

    console.log("Content does not match plain text heuristics.");
  } catch (error) {
    console.error("Error in MIME type detection:", error.message);
  }

  // Default fallback for undetectable or unsupported content
  return "application/octet-stream";
}

// Helper function to validate UTF-8 encoding
function isUtf8(buffer) {
  try {
    buffer.toString("utf-8"); // If it doesn't throw, it's valid UTF-8
    return true;
  } catch (error) {
    console.error("UTF-8 validation failed:", error.message);
    return false;
  }
}

// Process BLOB field for text extraction
async function processBlobField(fileBuffer) {
  let extractedText = "";
  // const mimeType = await detectMimeType(fileBuffer); // Detect MIME dynamically

  try {
    switch (mimeType) {
      case "application/pdf":
        extractedText = await extractTextFromPdf(fileBuffer);
        break;

      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": // DOCX
      case "application/msword": // DOC
        extractedText = await extractTextFromDocx(fileBuffer);
        break;

      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": // XLSX
      case "application/vnd.ms-excel": // XLS
      case "application/x-cfb":
        extractedText = await extractTextFromXlsx(fileBuffer);
        break;

      case "application/vnd.ms-powerpoint": // PPT
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation": // PPTX
        extractedText = await extractTextFromPptxBuffer(fileBuffer);
        break;

      case "text/csv":
        extractedText = await extractTextFromCsvBuffer(fileBuffer);
        break;

      case "application/xml":
      case "text/xml":
        extractedText = await extractTextFromXmlBuffer(fileBuffer);
        break;

      case "application/rtf": // RTF
        extractedText = await extractTextFromRtf(fileBuffer);
        break;

      case "text/plain":
        extractedText = fileBuffer.toString("utf-8"); // Direct text extraction for .txt
        break;

      case "application/json":
        extractedText = JSON.stringify(
          JSON.parse(fileBuffer.toString("utf-8")),
          null,
          2
        );
        break;

      case "text/html":
        extractedText = await extractTextFromHtmlBuffer(fileBuffer);
        break;

      default:
        console.log("Unsupported BLOB type, uploading without extraction.");
    }
  } catch (error) {
    console.error("Error extracting text from BLOB:", error.message);
  }

  return { extractedText, mimeType };
}

module.exports = {
  processFieldContent,
  processBlobField,
  detectMimeType,
};
