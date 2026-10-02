// ---------- Starting data ----------
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

const VALID_CATEGORIES = ["personal", "work", "study"];

// Lower-cases, trims and collapses extra spaces
function normalise(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------- 1. searchNotes ----------
function searchNotes(word) {
  const search = word.toLowerCase();
  return notes.filter(function (note) {
    return note.text.toLowerCase().includes(search);
  });
}

// ---------- 2. longestNote ----------
function longestNote() {
  if (notes.length === 0) {
    return null;
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

// ---------- 3. countByCategory ----------
function countByCategory() {
  const counts = {};
  for (const note of notes) {
    if (counts[note.category] === undefined) {
      counts[note.category] = 0;
    }
    counts[note.category] += 1;
  }
  return counts;
}

// ---------- 4. getSummary ----------
function getSummary() {
  const counts = countByCategory();
  const total = notes.length;
  const label = total === 1 ? "note" : "notes";
  const personal = counts.personal || 0;
  const work = counts.work || 0;
  const study = counts.study || 0;
  return `${total} ${label}: ${personal} personal, ${work} work, ${study} study.`;
}

// ---------- 5. isDuplicate ----------
function isDuplicate(text) {
  const wanted = normalise(text);
  return notes.some(function (note) {
    return normalise(note.text) === wanted;
  });
}

// ---------- 6. addNote ----------
function addNote(text, category) {
  const cleaned = text.trim();

  if (cleaned.length < 1 || cleaned.length > 200) {
    console.log("Not added: text must be 1-200 characters.");
    return false;
  }
  if (isDuplicate(cleaned)) {
    console.log("Not added: that note already exists.");
    return false;
  }
  if (!VALID_CATEGORIES.includes(category)) {
    console.log("Not added: category must be personal, work or study.");
    return false;
  }

  let highestId = 0;
  for (const note of notes) {
    if (note.id > highestId) {
      highestId = note.id;
    }
  }
  notes.push({ id: highestId + 1, text: cleaned, category: category });
  return true;
}

// ================= TESTS =================

// searchNotes
console.log(searchNotes("MILK")); // [ { id: 1, text: "Buy milk and bread", category: "personal" } ]
console.log(searchNotes("xyz")); // [] (no results)

// longestNote
console.log(longestNote()); // { id: 3, text: "Email the project report to Grace", category: "work" }
const backup = notes;
notes = [];
console.log(longestNote()); // null (empty array)
notes = backup;

// countByCategory
console.log(countByCategory()); // { personal: 2, study: 2, work: 1 }
notes = [];
console.log(countByCategory()); // {} (empty array)
notes = backup;

// getSummary
console.log(getSummary()); // "5 notes: 2 personal, 1 work, 2 study."
notes = [backup[0]];
console.log(getSummary()); // "1 note: 1 personal, 0 work, 0 study."
notes = backup;

// isDuplicate
console.log(isDuplicate("  BUY   Milk and bread ")); // true (case and extra spaces ignored)
console.log(isDuplicate("Buy eggs")); // false

// addNote (these change the notes array, so keep them last)
console.log(addNote("Water the plants", "personal")); // true
console.log(addNote("water the plants", "personal")); // logs "Not added: that note already exists." then false
console.log(addNote("   ", "work")); // logs "Not added: text must be 1-200 characters." then false
console.log(addNote("a".repeat(201), "work")); // logs "Not added: text must be 1-200 characters." then false
console.log(addNote("Plan a trip", "fun")); // logs "Not added: category must be personal, work or study." then false
console.log(getSummary()); // "6 notes: 3 personal, 1 work, 2 study."