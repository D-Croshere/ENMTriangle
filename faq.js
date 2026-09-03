"use strict";

// Renders faq.json into #faq. Answers may contain [label](url) links;
// everything else is escaped and shown as plain text.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderParagraph(text) {
  return escapeHtml(text).replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`,
  );
}

async function loadFaq() {
  const mount = document.getElementById("faq");
  try {
    const res = await fetch("faq.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = (await res.json()).faq || [];

    mount.innerHTML = items.map((item) => `
      <div class="faq-item">
        <h2 class="faq-q">${escapeHtml(item.question)}</h2>
        <div class="faq-a">
          ${(item.answer || []).map((p) => `<p>${renderParagraph(p)}</p>`).join("")}
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.warn("Could not load faq.json:", err);
    mount.innerHTML = `<p class="faq-a">The FAQ couldn't load. Try refreshing.</p>`;
  }
}

loadFaq();
