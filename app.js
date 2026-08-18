const form = document.querySelector("#signup-form");
const submitButton = form.querySelector("button[type='submit']");
const statusMessage = document.querySelector("#form-status");
const phoneInput = document.querySelector("#phone");
const successPanel = document.querySelector("#signup-success");
const successPhone = document.querySelector("#success-phone");
const joinAnotherButton = document.querySelector("#join-another");
const signupDescription = document.querySelector("#signup-description");
const config = window.THURSDAY_SOCIAL_CONFIG ?? {};

function setStatus(message, state = "") {
  statusMessage.textContent = message;
  statusMessage.dataset.state = state;
}

async function getResponseMessage(response) {
  try {
    const body = await response.json();

    if (typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
  } catch {
    // The status-specific message below is sufficient for non-JSON responses.
  }

  return "";
}

async function getSignupError(response) {
  const responseMessage = await getResponseMessage(response);

  if (response.status === 400 || response.status === 422) {
    return responseMessage || "Check your phone number and consent, then try again.";
  }

  if (response.status === 409) {
    return responseMessage || "That phone number is already signed up.";
  }

  if (response.status === 429) {
    return "Too many signup attempts. Please wait a moment and try again.";
  }

  if (response.status >= 500) {
    return "The signup service is temporarily unavailable. Please try again soon.";
  }

  return responseMessage || "We couldn't complete your signup. Please try again.";
}

function normalizeUsPhoneNumber(value) {
  const trimmedValue = value.trim();

  if (!/^[\d\s()+.-]+$/.test(trimmedValue)) {
    return null;
  }

  const plusCount = (trimmedValue.match(/\+/g) ?? []).length;

  if (
    plusCount > 1 ||
    (plusCount === 1 && !trimmedValue.startsWith("+1"))
  ) {
    return null;
  }

  let digits = trimmedValue.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  // NANP area codes and central-office codes cannot begin with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    return null;
  }

  return `+1${digits}`;
}

function formatUsPhoneNumber(value) {
  const digits = value.slice(2);

  return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function showSuccess(phone) {
  successPhone.textContent = formatUsPhoneNumber(phone);
  form.hidden = true;
  signupDescription.hidden = true;
  successPanel.hidden = false;
  successPanel.focus();
}

phoneInput.addEventListener("input", () => {
  phoneInput.setCustomValidity("");
});

joinAnotherButton.addEventListener("click", () => {
  successPanel.hidden = true;
  form.hidden = false;
  signupDescription.hidden = false;
  setStatus("");
  phoneInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  const normalizedPhone = normalizeUsPhoneNumber(phoneInput.value);

  if (!normalizedPhone) {
    phoneInput.setCustomValidity(
      "Enter a valid U.S. phone number, such as (555) 555-5555.",
    );
    phoneInput.reportValidity();
    return;
  }

  const formData = new FormData(form);
  const payload = {
    phone: normalizedPhone,
    consent: formData.get("consent") === "on",
  };

  submitButton.disabled = true;
  setStatus("Joining...");

  try {
    if (!config.apiEndpoint) {
      throw new Error("Signup endpoint is not configured.");
    }

    const response = await fetch(config.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setStatus(await getSignupError(response), "error");
      return;
    }

    form.reset();
    setStatus("");
    showSuccess(normalizedPhone);
  } catch {
    setStatus(
      "We couldn't reach the signup service. Check your connection and try again.",
      "error",
    );
  } finally {
    submitButton.disabled = false;
  }
});
