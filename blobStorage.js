const { BlobServiceClient } = require("@azure/storage-blob");
require("dotenv").config();

// Initialize Azure Blob Storage Client
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_BLOB_CONNECTION_STRING
);
const containerClient = blobServiceClient.getContainerClient(
  process.env.AZURE_BLOB_CONTAINER_NAME
);

function generatePreviewUrl(fileUrl, mimeType) {
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || // DOCX
    mimeType === "application/msword" || // DOC
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || // XLSX
    mimeType === "application/vnd.ms-excel" || // XLS
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" // PPTX
  ) {
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(
      fileUrl
    )}`;
  } else if (
    mimeType === "application/pdf" ||
    mimeType === "text/plain" ||
    mimeType === "text/csv" ||
    mimeType === "application/xml" ||
    mimeType === "text/xml" ||
    mimeType === "text/html"
  ) {
    return fileUrl; // Directly accessible in the browser
  } else {
    return fileUrl; // Default to download for unsupported types
  }
}

// Function to upload file to Azure Blob Storage
async function uploadFileToBlob(fileBuffer, fileName, mimeType) {
  const blobClient = containerClient.getBlockBlobClient(fileName);
  const options = {
    blobHTTPHeaders: {
      blobContentType: mimeType || "application/octet-stream",
    },
  };

  await blobClient.upload(fileBuffer, fileBuffer.length, options);
  const fileUrl = blobClient.url;
  const previewUrl = generatePreviewUrl(fileUrl, mimeType);
  return previewUrl;
}

module.exports = {
  uploadFileToBlob,
};
