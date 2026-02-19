const fetch = require("node-fetch");
const cheerio = require("cheerio");
const csstree = require("css-tree");

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

function getFormatFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".woff2") || lower.includes("format=woff2"))
    return "woff2";
  if (lower.includes(".woff") && !lower.includes(".woff2")) return "woff";
  if (lower.includes(".ttf") || lower.includes("format=truetype"))
    return "ttf";
  if (lower.includes(".otf") || lower.includes("format=opentype")) return "otf";
  if (lower.includes(".eot")) return "eot";
  if (lower.includes(".svg")) return "svg";
  return "unknown";
}

function getFormatFromDescriptor(descriptor) {
  const d = descriptor.toLowerCase();
  if (d.includes("woff2")) return "woff2";
  if (d.includes("woff")) return "woff";
  if (d.includes("truetype")) return "ttf";
  if (d.includes("opentype")) return "otf";
  if (d.includes("embedded-opentype")) return "eot";
  if (d.includes("svg")) return "svg";
  return null;
}

function parseFontFaces(cssText, cssBaseUrl) {
  const fonts = [];

  try {
    const ast = csstree.parse(cssText, {
      parseAtrulePrelude: false,
      parseRulePrelude: false,
      parseValue: false,
      tolerant: true,
    });

    // Find @font-face blocks manually via regex as fallback
  } catch (e) {
    // Fall through to regex approach
  }

  // Use regex for robust @font-face extraction
  const fontFaceRegex = /@font-face\s*\{([^}]+)\}/gi;
  let match;

  while ((match = fontFaceRegex.exec(cssText)) !== null) {
    const block = match[1];

    // Extract font-family
    const familyMatch = block.match(
      /font-family\s*:\s*['"]?([^'";,}]+?)['"]?\s*[;,}]/i
    );
    const family = familyMatch ? familyMatch[1].trim() : "Unknown";

    // Extract font-weight
    const weightMatch = block.match(/font-weight\s*:\s*([^;}"']+)/i);
    const weight = weightMatch ? weightMatch[1].trim() : "400";

    // Extract font-style
    const styleMatch = block.match(/font-style\s*:\s*([^;}"']+)/i);
    const style = styleMatch ? styleMatch[1].trim() : "normal";

    // Extract font-display
    const displayMatch = block.match(/font-display\s*:\s*([^;}"']+)/i);
    const display = displayMatch ? displayMatch[1].trim() : "";

    // Extract all url() references from src
    const srcMatch = block.match(/src\s*:\s*([^;]+)/i);
    if (!srcMatch) continue;

    const srcValue = srcMatch[1];
    const urlRegex = /url\s*\(\s*['"]?([^'")]+?)['"]?\s*\)(?:\s*format\s*\(\s*['"]?([^'")]+?)['"]?\s*\))?/gi;
    let urlMatch;
    const sources = [];

    while ((urlMatch = urlRegex.exec(srcValue)) !== null) {
      const rawUrl = urlMatch[1].trim();
      const formatDescriptor = urlMatch[2] || "";

      // Skip data URIs
      if (rawUrl.startsWith("data:")) continue;

      const resolvedUrl = resolveUrl(cssBaseUrl, rawUrl);
      if (!resolvedUrl) continue;

      const format = formatDescriptor
        ? getFormatFromDescriptor(formatDescriptor)
        : getFormatFromUrl(resolvedUrl);

      sources.push({
        url: resolvedUrl,
        format: format || "unknown",
      });
    }

    if (sources.length > 0) {
      // Prefer woff2 > woff > ttf > otf > others
      const formatPriority = { woff2: 0, woff: 1, ttf: 2, otf: 3, eot: 4, svg: 5, unknown: 6 };
      sources.sort(
        (a, b) =>
          (formatPriority[a.format] ?? 99) - (formatPriority[b.format] ?? 99)
      );

      fonts.push({
        family,
        weight,
        style,
        display,
        sources,
        // Primary source is the best format
        url: sources[0].url,
        format: sources[0].format,
      });
    }
  }

  return fonts;
}

async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let targetUrl;
  try {
    const body = JSON.parse(event.body);
    targetUrl = body.url;
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: "URL is required" }),
    };
  }

  // Normalize URL
  if (!targetUrl.startsWith("http")) {
    targetUrl = "https://" + targetUrl;
  }

  try {
    // Fetch the page HTML
    const pageRes = await fetchWithTimeout(targetUrl, 15000);
    if (!pageRes.ok) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({
          error: `Failed to fetch page: HTTP ${pageRes.status}`,
        }),
      };
    }

    const html = await pageRes.text();
    const $ = cheerio.load(html);
    const baseUrl = targetUrl;

    // Collect all font-face declarations
    let allFonts = [];

    // 1. Parse inline <style> blocks
    $("style").each((_, el) => {
      const cssText = $(el).text();
      const fonts = parseFontFaces(cssText, baseUrl);
      allFonts.push(...fonts);
    });

    // 2. Find external CSS links
    const cssUrls = [];
    $('link[rel="stylesheet"], link[as="style"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        const resolved = resolveUrl(baseUrl, href);
        if (resolved) cssUrls.push(resolved);
      }
    });

    // Also check for @import in inline styles
    $("style").each((_, el) => {
      const text = $(el).text();
      const importRegex = /@import\s+(?:url\s*\(\s*)?['"]?([^'");\s]+)['"]?\s*\)?\s*;/gi;
      let importMatch;
      while ((importMatch = importRegex.exec(text)) !== null) {
        const resolved = resolveUrl(baseUrl, importMatch[1]);
        if (resolved) cssUrls.push(resolved);
      }
    });

    // Fetch external CSS files (in parallel, max 15)
    const cssPromises = cssUrls.slice(0, 15).map(async (cssUrl) => {
      try {
        const cssRes = await fetchWithTimeout(cssUrl, 10000);
        if (cssRes.ok) {
          const cssText = await cssRes.text();

          // Check for @import in external CSS too
          const importRegex = /@import\s+(?:url\s*\(\s*)?['"]?([^'");\s]+)['"]?\s*\)?\s*;/gi;
          let importMatch;
          const nestedImports = [];
          while ((importMatch = importRegex.exec(cssText)) !== null) {
            const resolved = resolveUrl(cssUrl, importMatch[1]);
            if (resolved) nestedImports.push(resolved);
          }

          // Fetch nested imports
          const nestedResults = await Promise.all(
            nestedImports.slice(0, 5).map(async (nestedUrl) => {
              try {
                const nestedRes = await fetchWithTimeout(nestedUrl, 8000);
                if (nestedRes.ok) {
                  const nestedCss = await nestedRes.text();
                  return parseFontFaces(nestedCss, nestedUrl);
                }
              } catch {}
              return [];
            })
          );

          const fonts = parseFontFaces(cssText, cssUrl);
          return [...fonts, ...nestedResults.flat()];
        }
      } catch {}
      return [];
    });

    const cssResults = await Promise.all(cssPromises);
    cssResults.forEach((fonts) => allFonts.push(...fonts));

    // 3. Check for Google Fonts / preconnect hints with font URLs
    $('link[href*="fonts.googleapis.com"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href && !cssUrls.includes(href)) {
        cssUrls.push(href);
      }
    });

    // Fetch any additional Google Fonts CSS
    const googleFontUrls = cssUrls.filter((u) =>
      u.includes("fonts.googleapis.com")
    );
    const googlePromises = googleFontUrls.map(async (gUrl) => {
      try {
        // Request with woff2 user agent to get woff2 format
        const gRes = await fetch(gUrl, {
          headers: {
            "User-Agent": USER_AGENT,
          },
          redirect: "follow",
        });
        if (gRes.ok) {
          const cssText = await gRes.text();
          return parseFontFaces(cssText, gUrl);
        }
      } catch {}
      return [];
    });

    const googleResults = await Promise.all(googlePromises);
    googleResults.forEach((fonts) => allFonts.push(...fonts));

    // Deduplicate by URL
    const seen = new Set();
    allFonts = allFonts.filter((f) => {
      const key = f.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Group by family
    const familyMap = {};
    allFonts.forEach((f) => {
      const key = f.family;
      if (!familyMap[key]) {
        familyMap[key] = {
          family: f.family,
          variants: [],
        };
      }
      familyMap[key].variants.push({
        weight: f.weight,
        style: f.style,
        url: f.url,
        format: f.format,
        sources: f.sources,
      });
    });

    const families = Object.values(familyMap);

    // Sort variants by weight
    families.forEach((fam) => {
      fam.variants.sort((a, b) => {
        const wa = parseInt(a.weight) || 400;
        const wb = parseInt(b.weight) || 400;
        if (wa !== wb) return wa - wb;
        return a.style === "italic" ? 1 : -1;
      });
    });

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        url: targetUrl,
        totalFonts: allFonts.length,
        families,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({
        error: `Failed to analyze site: ${e.message}`,
      }),
    };
  }
};
