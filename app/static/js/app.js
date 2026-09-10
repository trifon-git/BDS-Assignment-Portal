// Small progressive-enhancement helpers. Every form still works with JS
// disabled -- this only adds confirmations, a copy button, live forum
// polling, and a generic click-to-record ping.

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

// Reshuffle confirm toggle on the teams page.
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-reshuffle-trigger]");
  if (trigger) {
    document.getElementById("reshuffle-confirm")?.classList.remove("hidden");
    trigger.classList.add("hidden");
  }
  const cancel = e.target.closest("[data-reshuffle-cancel]");
  if (cancel) {
    document.getElementById("reshuffle-confirm")?.classList.add("hidden");
    document.getElementById("reshuffle-trigger")?.classList.remove("hidden");
  }
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
