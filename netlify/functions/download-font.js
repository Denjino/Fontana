const fetch = require("node-fetch");
const zlib = require("zlib");
const wawoff2 = require("wawoff2");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---- WOFF → TTF/OTF conversion ----
function convertWoffToSfnt(woffBuffer) {
  const buf = Buffer.from(woffBuffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const signature = view.getUint32(0);
  if (signature !== 0x774f4646) {
    throw new Error("Not a valid WOFF file");
  }

  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);

  // Read WOFF table directory (starts at offset 44)
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const off = 44 + i * 20;
    tables.push({
      tag: view.getUint32(off),
      offset: view.getUint32(off + 4),
      compLength: view.getUint32(off + 8),
      origLength: view.getUint32(off + 12),
      origChecksum: view.getUint32(off + 16),
    });
  }

  // Calculate SFNT search parameters
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) {
    searchRange *= 2;
    entrySelector++;
  }
  searchRange *= 16;
  const rangeShift = numTables * 16 - searchRange;

  // Decompress all table data first
  const tableData = tables.map((t) => {
    const compressed = buf.slice(t.offset, t.offset + t.compLength);
    if (t.compLength < t.origLength) {
      // Table is zlib-compressed
      try {
        const decompressed = zlib.inflateSync(compressed);
        return decompressed.slice(0, t.origLength);
      } catch {
        // If inflate fails, try raw deflate (skip zlib header)
        try {
          const decompressed = zlib.inflateRawSync(compressed.slice(2));
          return decompressed.slice(0, t.origLength);
        } catch {
          return compressed;
        }
      }
    }
    return compressed.slice(0, t.origLength);
  });

  // Calculate total output size
  const headerSize = 12;
  const dirSize = numTables * 16;
  let dataOffset = headerSize + dirSize;
  // Align to 4 bytes
  dataOffset = (dataOffset + 3) & ~3;

  let totalSize = dataOffset;
  for (const data of tableData) {
    totalSize += data.length;
    totalSize = (totalSize + 3) & ~3; // Pad each table to 4 bytes
  }

  const output = Buffer.alloc(totalSize);
  const outView = new DataView(output.buffer, output.byteOffset, output.byteLength);

  // Write SFNT header
  outView.setUint32(0, flavor);
  outView.setUint16(4, numTables);
  outView.setUint16(6, searchRange);
  outView.setUint16(8, entrySelector);
  outView.setUint16(10, rangeShift);

  // Write table directory and data
  let currentOffset = dataOffset;
  for (let i = 0; i < numTables; i++) {
    const t = tables[i];
    const data = tableData[i];
    const dirOff = 12 + i * 16;

    // Table directory entry: tag, checksum, offset, length
    outView.setUint32(dirOff, t.tag);
    outView.setUint32(dirOff + 4, t.origChecksum);
    outView.setUint32(dirOff + 8, currentOffset);
    outView.setUint32(dirOff + 12, t.origLength);

    // Copy table data
    data.copy(output, currentOffset, 0, data.length);

    currentOffset += data.length;
    // Pad to 4-byte boundary
    while (currentOffset % 4 !== 0) currentOffset++;
  }

  return output;
}

// ---- WOFF2 → TTF/OTF conversion ----
async function convertWoff2ToSfnt(woff2Buffer) {
  const result = await wawoff2.decompress(Buffer.from(woff2Buffer));
  return Buffer.from(result);
}

// ---- Detect format from buffer signature ----
function detectFormat(buffer) {
  if (buffer.length < 4) return "unknown";
  const sig = buffer.readUInt32BE(0);

  if (sig === 0x774f4646) return "woff";    // wOFF
  if (sig === 0x774f4632) return "woff2";   // wOF2
  if (sig === 0x00010000) return "ttf";      // TrueType
  if (sig === 0x4f54544f) return "otf";      // OTTO (OpenType/CFF)
  if (sig === 0x74727565) return "ttf";      // 'true' (Apple TrueType)

  return "unknown";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let fontUrl, filename, convertToTtf;
  try {
    const body = JSON.parse(event.body);
    fontUrl = body.url;
    filename = body.filename || "font";
    convertToTtf = body.convertToTtf || false;
  } catch {
    return {
      statusCode: 400,
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  if (!fontUrl) {
    return {
      statusCode: 400,
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Font URL is required" }),
    };
  }

  try {
    const res = await fetch(fontUrl, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      timeout: 15000,
    });

    if (!res.ok) {
      return {
        statusCode: 400,
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Failed to download font: HTTP ${res.status}`,
        }),
      };
    }

    let buffer = await res.buffer();

    // Convert to TTF if requested
    if (convertToTtf) {
      const format = detectFormat(buffer);

      if (format === "woff2") {
        buffer = await convertWoff2ToSfnt(buffer);
      } else if (format === "woff") {
        buffer = convertWoffToSfnt(buffer);
      }
      // ttf/otf are already SFNT — pass through as-is
    }

    const contentType = convertToTtf
      ? "font/sfnt"
      : res.headers.get("content-type") || "application/octet-stream";

    return {
      statusCode: 200,
      headers: {
        ...HEADERS,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: `Download failed: ${e.message}`,
      }),
    };
  }
};
