const fetch = require("node-fetch");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  let fontUrl, filename;
  try {
    const body = JSON.parse(event.body);
    fontUrl = body.url;
    filename = body.filename || "font";
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

    const buffer = await res.buffer();
    const contentType =
      res.headers.get("content-type") || "application/octet-stream";

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
