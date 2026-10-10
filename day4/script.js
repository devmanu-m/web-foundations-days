// ---------- Select the elements ----------
const textarea = document.getElementById("note-text");
const charCount = document.getElementById("char-count");
const wordCount = document.getElementById("word-count");
const clearBtn = document.getElementById("clear-btn");
const themeBtn = document.getElementById("theme-toggle");

const MAX_CHARS = 200;
const WARNING_AT = 180;

// ---------- Update both counters and the warning classes ----------
function updateCounts() {
  const text = textarea.value;
  const chars = text.length;
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

  charCount.textContent = `${chars} / ${MAX_CHARS} characters`;
  wordCount.textContent = `${words} words`;

  charCount.classList.toggle("warning", chars > WARNING_AT);
  charCount.classList.toggle("over", chars > MAX_CHARS);
}

// ---------- Clear everything ----------
function clearAll() {
  textarea.value = "";
  localStorage.removeItem("draft");
  updateCounts();
  textarea.focus();
}

// ---------- Theme ----------
function updateThemeButton() {
  const isDark = document.body.classList.contains("dark");
  themeBtn.textContent = isDark ? "Light mode" : "Dark mode";
}

// ---------- Events ----------
textarea.addEventListener("input", function () {
  updateCounts();
  localStorage.setItem("draft", textarea.value);
});

clearBtn.addEventListener("click", clearAll);

textarea.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    clearAll();
  }
});

themeBtn.addEventListener("click", function () {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeButton();
});

// ---------- On page load: restore draft and theme ----------
const savedDraft = localStorage.getItem("draft");
if (savedDraft !== null) {
  textarea.value = savedDraft;
}

if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark");
}
updateThemeButton();
updateCounts();