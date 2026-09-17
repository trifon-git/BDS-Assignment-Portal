// Small progressive-enhancement helpers. Every form still works with JS
// disabled -- this only adds confirmations, a copy button, live forum
// polling, and a generic click-to-record ping.

// Dark/light mode toggle. Absence of a stored preference means "follow OS",
// handled purely by the CSS prefers-color-scheme block.
const themeToggle = document.querySelector("[data-theme-toggle]");
function currentTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function paintToggle() {
  if (themeToggle) themeToggle.textContent = currentTheme() === "dark" ? "☀️" : "🌙";
}
if (themeToggle) {
  paintToggle();
  themeToggle.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    paintToggle();
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-confirm]");
  if (btn && !confirm(btn.getAttribute("data-confirm"))) {
    e.preventDefault();
    e.stopPropagation();
  }
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  const text = btn.getAttribute("data-copy");
  navigator.clipboard?.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = original), 1500);
  });
});

// Reshuffle confirm toggle on the teams page. Scoped to the nearest
// [data-reshuffle-scope] ancestor rather than a page-wide id, since the
// random-shuffle and questionnaire-split forms each have their own trigger
// living in the same page.
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-reshuffle-trigger]");
  if (trigger) {
    const scope = trigger.closest("[data-reshuffle-scope]") || document;
    scope.querySelector("[data-reshuffle-confirm]")?.classList.remove("hidden");
    trigger.classList.add("hidden");
  }
  const cancel = e.target.closest("[data-reshuffle-cancel]");
  if (cancel) {
    const scope = cancel.closest("[data-reshuffle-scope]") || document;
    scope.querySelector("[data-reshuffle-confirm]")?.classList.add("hidden");
    scope.querySelector("[data-reshuffle-trigger]")?.classList.remove("hidden");
  }
});

// Simple tab switcher: click a [data-tab-btn] to show the matching
// [data-tab-panel] within the same [data-tab-group] and hide the rest.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab-btn]");
  if (!btn) return;
  const group = btn.getAttribute("data-tab-group");
  const key = btn.getAttribute("data-tab-btn");
  document.querySelectorAll(`[data-tab-btn][data-tab-group="${group}"]`).forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
  document.querySelectorAll(`[data-tab-panel][data-tab-group="${group}"]`).forEach((p) => {
    p.classList.toggle("hidden", p.getAttribute("data-tab-panel") !== key);
  });
});

// A click that should record something server-side without blocking the
// click's own default action (e.g. a mailto: link still has to open).
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-ping]");
  if (!el) return;
  fetch(el.getAttribute("data-ping"), { method: "POST" }).catch(() => {});
  const marker = document.getElementById(el.getAttribute("data-ping-marker") || "");
  if (marker) marker.classList.remove("hidden");
});

// Poll the team forum for new messages so a teammate's post shows up
// without anyone hitting refresh. Only swaps the DOM when the fetched HTML
// actually differs from what's already shown, so an open reply box isn't
// wiped every few seconds for nothing -- it can still be wiped if someone
// else posts while you're mid-reply, which is an acceptable rare cost for
// a small team's chat.
const forumPoll = document.querySelector("[data-forum-poll]");
if (forumPoll) {
  let lastHtml = forumPoll.innerHTML;
  setInterval(() => {
    fetch(forumPoll.getAttribute("data-forum-poll"))
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => {
        if (html !== null && html !== lastHtml) {
          lastHtml = html;
          forumPoll.innerHTML = html;
        }
      })
      .catch(() => {});
  }, 4000);
}
