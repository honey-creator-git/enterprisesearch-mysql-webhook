const mysql = require("mysql2/promise");
const client = require("./elasticsearch");
const { uploadFileToBlob } = require("./blobStorage.js");
const fs = require("fs"); // To read the SSL certificate file
const axios = require("axios");
const processFieldContent =
  require("./mysqlwebhookServices.js").processFieldContent;
const processBlobField = require("./mysqlwebhookServices.js").processBlobField;
const detectMimeType = require("./mysqlwebhookServices.js").detectMimeType;
require("dotenv").config();

function splitLargeText(content, maxChunkSize = 30000) {
  const chunks = [];
  for (let i = 0; i < content.length; i += maxChunkSize) {
    chunks.push(content.substring(i, i + maxChunkSize));
  }
  return chunks;
}

exports.lastProcessedIdListener = async () => {
  try {
    console.log("Starting MySQL Last Processed ID Monitor...");

    // Step 1: Get all indices with the prefix "datasource_mysql_connection_"
    const indicesResponse = await client.cat.indices({ format: "json" });
    const indices = indicesResponse
      .map((index) => index.index)
      .filter((name) => name.startsWith("datasource_mysql_connection_"));

    console.log("Found indices: ", indices);

    for (const index of indices) {
      // Step 2: Query ElasticSearch for database configuration
      const query = {
        query: {
          match_all: {},
        },
      };

      const result = await client.search({
        index,
        body: query,
      });

      for (const configDoc of result.hits.hits) {
        const {
          host,
          user,
          password,
          database,
          table_name,
          field_name,
          title_field,
          category,
          coid,
          lastProcessedId,
        } = configDoc._source;

        console.log(
          `Processing table: ${table_name} in database: ${database} at host: ${host}`
        );

        // Step 3: Create a MySQL connection
        const connection = await mysql.createConnection({
          host: host,
          user: user,
          password: password,
          database: database,
          ssl: {
            ca: fs.readFileSync("./DigiCertGlobalRootCA.crt.pem"), // Replace with the actual path to the certificate
          },
        });

        // Step 4: Fetch new rows from the table based on the last processed ID
        const [rows] = await connection.query(
          `SELECT id, ${title_field} AS title, ${field_name} AS field_value,
                LENGTH(${field_name}) AS file_size,
                CURRENT_TIMESTAMP AS uploaded_at
            FROM ${table_name}
            WHERE id > ?
            ORDER BY id ASC`,
          [lastProcessedId || 0]
        );

        console.log("New rows fetched: ", rows);

        if (rows.length > 0) {
          console.log(`New rows detected:`, rows);

          const documents = [];

          for (const row of rows) {
            let processedContent;
            let fileUrl = "";
            const fileBuffer = row.field_value;
            const fileName = row.title;
            const fileSizeInMB = (row.file_size / (1024 * 1024)).toFixed(2); // Convert to MB

            try {
              // Detect MIME type dynamically
              const mimeType = await detectMimeType(fileBuffer);

              if (
                mimeType.startsWith("application/") ||
                mimeType === "text/html" ||
                mimeType === "text/csv" ||
                mimeType === "text/xml" ||
                mimeType === "text/plain"
              ) {
                console.log(`Detected MIME type: ${mimeType}`);
                const { extractedText } = await processBlobField(
                  fileBuffer,
                  mimeType
                );

                // Upload file to Azure Blob Storage
                fileUrl = await uploadFileToBlob(
                  fileBuffer,
                  fileName,
                  mimeType
                );

                console.log("File URL => ", fileUrl);

                processedContent = extractedText;

                console.log("Extracted text from buffer => ", processedContent);
              } else {
                console.log("Unsupported MIME type:", mimeType);
                continue;
              }
            } catch (error) {
              console.error(
                `Error processing content for row ID ${row.id}:`,
                error.message
              );
              continue;
            }

            if (processedContent) {
              const chunks = splitLargeText(processedContent);
              chunks.forEach((chunk, index) => {
                documents.push({
                  "@search.action": "mergeOrUpload",
                  id: `mysql_${database}_${table_name}_${row.id}_${index}`,
                  content: chunk,
                  title: fileName,
                  description: "No description",
                  image: null,
                  category: category,
                  fileUrl: fileUrl,
                  fileSize: parseFloat(fileSizeInMB), // Add file size (in MB)
                  uploadedAt:
                    row.uploaded_at ||
                    row.created_at ||
                    row.updated_at ||
                    row.uploadedAt ||
                    row.createdAt ||
                    row.updatedAt, // Add uploaded timestamp
                });
              });
            }
          }

          if (documents.length > 0) {
            const indexName = `tenant_${coid.toLowerCase()}`;

            const payload = {
              value: documents,
            };

            // Push data to Azure Search (uncomment if necessary)
            const esResponse = await axios.post(
              `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${indexName}/docs/index?api-version=2021-04-30-Preview`,
              payload,
              {
                headers: {
                  "Content-Type": "application/json",
                  "api-key": process.env.AZURE_SEARCH_API_KEY,
                },
              }
            );

            console.log("ES Response Data => ", esResponse.data);

            console.log(
              `Documents pushed successfully to Azure Search in index: ${indexName}`
            );
          } else {
            console.log("No documents to index.");
          }

          // Step 5: Update the last processed ID in ElasticSearch
          const newLastProcessedId = rows[rows.length - 1].id;

          await client.update({
            index,
            id: configDoc._id,
            body: {
              doc: {
                lastProcessedId: newLastProcessedId,
                updatedAt: new Date().toISOString(),
              },
            },
          });

          console.log(`Last processed ID updated to: ${newLastProcessedId}`);
        } else {
          console.log(`No new rows detected for table: ${table_name}`);
        }

        // Close MySQL connection
        await connection.end();
      }
    }
  } catch (error) {
    console.error("Error in MySQL Last Processed ID Monitor:", error.message);
  }
};
