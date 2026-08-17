const ADMIN_EMAIL = "zach@beltlinesocialclub.com";
const ADMIN_PASSWORD_HASH =
  "9adb69068af052903d828f298ee6bbf3cccb28ad9bd2b7836ac0871074d0e2bf";
const AUTH_SESSION_KEY = "thursday-social-admin-authenticated";

const loginView = document.querySelector("#login-view");
const adminView = document.querySelector("#admin-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const signOutButton = document.querySelector("#sign-out");

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
}

function showLogin() {
  adminView.hidden = true;
  loginView.hidden = false;
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!loginForm.reportValidity()) {
    return;
  }

  const formData = new FormData(loginForm);
  const email = formData.get("email").trim().toLowerCase();
  const passwordHash = await hash(formData.get("password"));

  if (email !== ADMIN_EMAIL || passwordHash !== ADMIN_PASSWORD_HASH) {
    loginStatus.textContent = "The email or password is incorrect.";
    loginStatus.dataset.state = "error";
    return;
  }

  sessionStorage.setItem(AUTH_SESSION_KEY, "true");
  loginForm.reset();
  loginStatus.textContent = "";
  loginStatus.dataset.state = "";
  showAdmin();
});

signOutButton.addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  showLogin();
  document.querySelector("#email").focus();
});

if (sessionStorage.getItem(AUTH_SESSION_KEY) === "true") {
  showAdmin();
}
