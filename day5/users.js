// ---------- Select elements ----------
const loadBtn = document.querySelector("#load-users");
const filterInput = document.querySelector("#filter-input");
const statusEl = document.querySelector("#status");
const usersList = document.querySelector("#users-list");

const API_URL = "https://jsonplaceholder.typicode.com/users";

// All loaded users are stored here, so filtering needs no new request
let allUsers = [];

// ---------- Build one user card (textContent only) ----------
function createUserItem(user) {
  const li = document.createElement("li");

  const name = document.createElement("strong");
  name.textContent = user.name;

  const email = document.createElement("p");
  email.textContent = "Email: " + user.email;

  const city = document.createElement("p");
  city.textContent = "City: " + user.address.city;

  const company = document.createElement("p");
  company.textContent = "Company: " + user.company.name;

  li.append(name, email, city, company);
  return li;
}

// ---------- Draw any array of users ----------
function renderUsers(list) {
  usersList.textContent = "";

  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No users match your filter.";
    usersList.appendChild(empty);
    return;
  }

  for (const user of list) {
    usersList.appendChild(createUserItem(user));
  }
}

// ---------- Filter the stored array (no new request) ----------
function applyFilter() {
  const search = filterInput.value.trim().toLowerCase();
  const matches = allUsers.filter(function (user) {
    return user.name.toLowerCase().includes(search);
  });
  renderUsers(matches);
  return matches.length;
}

// ---------- Fetch the users ----------
async function loadUsers() {
  loadBtn.disabled = true;
  statusEl.textContent = "Loading users...";

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }

    allUsers = await response.json();
    applyFilter();
    statusEl.textContent = `Loaded ${allUsers.length} users successfully.`;
  } catch (error) {
    statusEl.textContent = "Error: could not load users. Please try again.";
    console.error(error);
  } finally {
    loadBtn.disabled = false;
  }
}

// ---------- Events ----------
loadBtn.addEventListener("click", loadUsers);

filterInput.addEventListener("input", function () {
  if (allUsers.length === 0) {
    return;
  }
  applyFilter();
});