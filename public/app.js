/* =========================================
   FONTANA — Frontend Application
   ========================================= */

(function () {
  "use strict";

  // ---- DOM References ----
  const urlInput = document.getElementById("urlInput");
  const extractBtn = document.getElementById("extractBtn");
  const loadingSection = document.getElementById("loadingSection");
  const loadingDots = document.getElementById("loadingDots");
  const loadingStatus = document.getElementById("loadingStatus");
  const errorSection = document.getElementById("errorSection");
  const errorText = document.getElementById("errorText");
  const retryBtn = document.getElementById("retryBtn");
  const resultsSection = document.getElementById("resultsSection");
  const fontCount = document.getElementById("fontCount");
  const sourceUrl = document.getElementById("sourceUrl");
  const fontFamilies = document.getElementById("fontFamilies");
  const downloadAllBtn = document.getElementById("downloadAllBtn");
  const downloadAllTtfBtn = document.getElementById("downloadAllTtfBtn");

  // ---- State ----
  let currentData = null;
  let loadedFontFaces = [];

  // ---- Weight name mapping ----
  const WEIGHT_NAMES = {
    100: "Thin",
    200: "ExtraLight",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
  };

  function getWeightName(weight) {
    const w = parseInt(weight) || 400;
    return WEIGHT_NAMES[w] || `W${w}`;
  }

  function getWeightStyle(weight, style) {
    const name = getWeightName(weight);
    const isItalic = style === "italic";
    return isItalic ? `${name} Italic` : name;
  }

  // ---- Preview text ----
  const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog. 0123456789";

  // ---- Toast notifications ----
  function showToast(message, type = "info") {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ---- Loading dots animation ----
  let dotsInterval = null;
  function startLoadingDots() {
    let count = 0;
    dotsInterval = setInterval(() => {
      count = (count + 1) % 4;
      loadingDots.textContent = ".".repeat(count || 1) + "\u00A0".repeat(3 - (count || 1));
    }, 400);
  }
  function stopLoadingDots() {
    if (dotsInterval) clearInterval(dotsInterval);
  }

  // ---- UI State management ----
  function showSection(section) {
    loadingSection.classList.add("hidden");
    errorSection.classList.add("hidden");
    resultsSection.classList.add("hidden");

    if (section) section.classList.remove("hidden");
  }

  function setLoading(isLoading, statusText) {
    if (isLoading) {
      extractBtn.disabled = true;
      extractBtn.querySelector(".btn-text").textContent = "SCANNING";
      showSection(loadingSection);
      startLoadingDots();
      if (statusText) loadingStatus.textContent = statusText;
    } else {
      extractBtn.disabled = false;
      extractBtn.querySelector(".btn-text").textContent = "EXTRACT";
      stopLoadingDots();
    }
  }

  function showError(message) {
    setLoading(false);
    errorText.textContent = message;
    showSection(errorSection);
  }

  // ---- Dynamic font loading for preview ----
  function loadFontForPreview(family, variant) {
    const fontId = `fontana-${family}-${variant.weight}-${variant.style}`.replace(/[^a-zA-Z0-9-]/g, "_");

    // Check if already loaded
    if (loadedFontFaces.includes(fontId)) return fontId;

    try {
      const fontFace = new FontFace(fontId, `url(${variant.url})`, {
        weight: variant.weight,
        style: variant.style,
      });

      fontFace
        .load()
        .then((loaded) => {
          document.fonts.add(loaded);
          // Update any preview elements using this font
          const els = document.querySelectorAll(`[data-font-id="${fontId}"]`);
          els.forEach((el) => {
            el.style.fontFamily = `"${fontId}", sans-serif`;
          });
        })
        .catch(() => {
          // Silent fail — preview just won't render in the custom font
        });

      loadedFontFaces.push(fontId);
    } catch {
      // FontFace API not supported or URL invalid
    }

    return fontId;
  }

  // ---- Render results ----
  function renderResults(data) {
    currentData = data;
    fontCount.textContent = data.totalFonts;
    sourceUrl.textContent = data.url;

    // Clean up old dynamic fonts
    loadedFontFaces = [];

    if (data.families.length === 0) {
      fontFamilies.innerHTML = `
        <div class="no-fonts">
          <div class="no-fonts-icon">
            <svg viewBox="0 0 60 60" fill="none">
              <circle cx="30" cy="30" r="25" stroke-dasharray="6 4" stroke-width="1.5"/>
              <text x="30" y="36" text-anchor="middle" font-size="18" fill="currentColor">?</text>
            </svg>
          </div>
          <div class="no-fonts-text">No downloadable font files found on this page</div>
        </div>
      `;
      downloadAllBtn.classList.add("hidden");
      downloadAllTtfBtn.classList.add("hidden");
      showSection(resultsSection);
      return;
    }

    downloadAllBtn.classList.remove("hidden");
    downloadAllTtfBtn.classList.remove("hidden");

    fontFamilies.innerHTML = "";

    data.families.forEach((family, famIdx) => {
      const card = document.createElement("div");
      card.className = "font-family-card";
      if (famIdx === 0) card.classList.add("expanded"); // Expand first by default

      // Load the first variant for the family preview
      const firstVariant = family.variants[0];
      const previewFontId = loadFontForPreview(family.family, firstVariant);

      const formats = [...new Set(family.variants.map((v) => v.format))].join(", ");

      card.innerHTML = `
        <div class="family-header">
          <div class="family-info">
            <div class="family-name">${escapeHtml(family.family)}</div>
            <div class="family-meta">${formats.toUpperCase()} · ${family.variants.length} variant${family.variants.length !== 1 ? "s" : ""}</div>
          </div>
          <div class="family-toggle">
            <span class="variant-count">${family.variants.length} file${family.variants.length !== 1 ? "s" : ""}</span>
            <svg viewBox="0 0 24 24" fill="none" class="toggle-icon">
              <path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
        <div class="family-preview">
          <div class="preview-text" data-font-id="${previewFontId}" style="font-family: '${previewFontId}', sans-serif; font-weight: ${firstVariant.weight}; font-style: ${firstVariant.style};">
            ${PREVIEW_TEXT}
          </div>
        </div>
        <div class="family-variants">
          ${family.variants
            .map((variant) => {
              const fontId = loadFontForPreview(family.family, variant);
              const label = getWeightStyle(variant.weight, variant.style);
              const isTtf = variant.format === "ttf";
              return `
              <div class="variant-item">
                <div class="variant-info">
                  <div class="variant-label">${escapeHtml(label)}</div>
                  <div class="variant-format">.${variant.format}</div>
                </div>
                <div class="variant-sample" data-font-id="${fontId}" style="font-family: '${fontId}', sans-serif; font-weight: ${variant.weight}; font-style: ${variant.style};">
                  Aa Bb Cc 123
                </div>
                <div class="variant-actions">
                  <button class="variant-btn variant-btn-download" data-url="${escapeAttr(variant.url)}" data-family="${escapeAttr(family.family)}" data-weight="${variant.weight}" data-style="${variant.style}" data-format="${variant.format}">
                    .${variant.format.toUpperCase()}
                  </button>
                  ${
                    !isTtf
                      ? `<button class="variant-btn variant-btn-ttf" data-url="${escapeAttr(variant.url)}" data-family="${escapeAttr(family.family)}" data-weight="${variant.weight}" data-style="${variant.style}" data-format="${variant.format}">
                      .TTF
                    </button>`
                      : ""
                  }
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      `;

      // Toggle expand/collapse
      const header = card.querySelector(".family-header");
      header.addEventListener("click", () => {
        card.classList.toggle("expanded");
      });

      fontFamilies.appendChild(card);
    });

    // Attach download handlers
    fontFamilies.querySelectorAll(".variant-btn-download").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const { url, family, weight, style, format } = btn.dataset;
        const filename = buildFilename(family, weight, style, format);
        downloadFont(url, filename, btn);
      });
    });

    fontFamilies.querySelectorAll(".variant-btn-ttf").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const { url, family, weight, style, format } = btn.dataset;
        const filename = buildFilename(family, weight, style, "ttf");
        downloadAndConvertToTtf(url, filename, format, btn);
      });
    });

    showSection(resultsSection);
  }

  // ---- Filename builder ----
  function buildFilename(family, weight, style, format) {
    const cleanFamily = family.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-");
    const weightName = getWeightName(weight);
    const suffix = style === "italic" ? "-Italic" : "";
    return `${cleanFamily}-${weightName}${suffix}.${format}`;
  }

  // ---- Font download ----
  async function downloadFont(url, filename, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "...";
    }

    try {
      const res = await fetch("/.netlify/functions/download-font", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, filename }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      triggerDownload(blob, filename);
      showToast(`Downloaded ${filename}`, "success");
    } catch (e) {
      showToast(`Failed: ${e.message}`, "error");
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        const format = filename.split(".").pop().toUpperCase();
        btnEl.textContent = `.${format}`;
      }
    }
  }

  // ---- Convert & download as TTF (server-side conversion) ----
  async function downloadAndConvertToTtf(url, filename, sourceFormat, btnEl) {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "...";
    }

    try {
      const res = await fetch("/.netlify/functions/download-font", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, filename, convertToTtf: true }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      triggerDownload(blob, filename);
      showToast(`Converted & downloaded ${filename}`, "success");
    } catch (e) {
      showToast(`Conversion failed: ${e.message}`, "error");
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = ".TTF";
      }
    }
  }

  // ---- Trigger file download ----
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- Download all fonts ----
  async function downloadAllFonts(asTtf = false) {
    if (!currentData || !currentData.families.length) return;

    const allVariants = [];
    currentData.families.forEach((fam) => {
      fam.variants.forEach((v) => {
        allVariants.push({ ...v, family: fam.family });
      });
    });

    showToast(`Downloading ${allVariants.length} fonts...`, "info");

    let completed = 0;
    const batchSize = 3;

    for (let i = 0; i < allVariants.length; i += batchSize) {
      const batch = allVariants.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (v) => {
          const format = asTtf && v.format !== "ttf" ? "ttf" : v.format;
          const filename = buildFilename(v.family, v.weight, v.style, format);

          if (asTtf && v.format !== "ttf") {
            await downloadAndConvertToTtf(v.url, filename, v.format, null);
          } else {
            await downloadFont(v.url, filename, null);
          }
          completed++;
        })
      );

      // Small delay between batches
      if (i + batchSize < allVariants.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    showToast(`All ${completed} fonts downloaded!`, "success");
  }

  // ---- Extract fonts from URL ----
  async function extractFonts(url) {
    setLoading(true, "Fetching page & analyzing stylesheets");

    try {
      const res = await fetch("/.netlify/functions/extract-fonts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setLoading(false);
      renderResults(data);
    } catch (e) {
      showError(e.message || "Failed to extract fonts. Please check the URL and try again.");
    }
  }

  // ---- HTML escaping ----
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Normalize URL ----
  function normalizeUrl(input) {
    let url = input.trim();
    if (!url) return "";

    // Remove protocol if user typed it (since we show https:// prefix)
    url = url.replace(/^https?:\/\//i, "");
    // Remove leading slashes
    url = url.replace(/^\/+/, "");

    return url ? `https://${url}` : "";
  }

  // ---- Event Handlers ----
  extractBtn.addEventListener("click", () => {
    const url = normalizeUrl(urlInput.value);
    if (!url) {
      showToast("Please enter a URL", "error");
      urlInput.focus();
      return;
    }
    extractFonts(url);
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      extractBtn.click();
    }
  });

  retryBtn.addEventListener("click", () => {
    showSection(null);
    urlInput.focus();
  });

  downloadAllBtn.addEventListener("click", () => downloadAllFonts(false));
  downloadAllTtfBtn.addEventListener("click", () => downloadAllFonts(true));

  // Handle pasting full URLs with protocol
  urlInput.addEventListener("paste", (e) => {
    setTimeout(() => {
      const val = urlInput.value;
      urlInput.value = val.replace(/^https?:\/\//i, "");
    }, 0);
  });

  // Focus input on load
  urlInput.focus();
})();
