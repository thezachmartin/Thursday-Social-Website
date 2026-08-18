const loginView = document.querySelector("#login-view");
const adminView = document.querySelector("#admin-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const signOutButton = document.querySelector("#sign-out");
const activeCount = document.querySelector("#active-count");
const countStatus = document.querySelector("#count-status");
const messageForm = document.querySelector("#message-form");
const messageBody = document.querySelector("#message-body");
const characterCount = document.querySelector("#character-count");
const septetCount = document.querySelector("#septet-count");
const segmentCount = document.querySelector("#segment-count");
const remainingCount = document.querySelector("#remaining-count");
const segmentProgress = document.querySelector("#segment-progress");
const segmentLabel = document.querySelector("#segment-label");
const segmentUsage = document.querySelector("#segment-usage");
const encodingBadge = document.querySelector("#encoding-badge");
const messageError = document.querySelector("#message-error");
const sendMessageButton = document.querySelector("#send-message");
const segmentCost = document.querySelector("#segment-cost");
const increaseSegmentCost = document.querySelector("#increase-segment-cost");
const decreaseSegmentCost = document.querySelector("#decrease-segment-cost");
const estimatedCost = document.querySelector("#estimated-cost");
const costSubscribers = document.querySelector("#cost-subscribers");
const costSegments = document.querySelector("#cost-segments");
const config = window.THURSDAY_SOCIAL_CONFIG ?? {};
const cognitoConfig = config.cognito ?? {};
const composerConfig = config.adminComposer ?? {};
const Cognito = window.AmazonCognitoIdentity;
const previewSubscriberCount = (() => {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const value = Number(
    new URLSearchParams(window.location.search).get("subscribers"),
  );

  return isLocalhost && Number.isInteger(value) && value >= 0 ? value : null;
})();
const GSM_BASIC_CHARACTERS = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const GSM_EXTENSION_CHARACTERS = new Set(Array.from("\f^{}\\[~]|€"));
const SINGLE_SEGMENT_SEPTETS = 160;
const MULTI_SEGMENT_SEPTETS = 153;
const SINGLE_SEGMENT_UNICODE_UNITS = 70;
const MULTI_SEGMENT_UNICODE_UNITS = 67;
const singleSegmentTarget =
  Number.isInteger(composerConfig.singleSegmentTarget) &&
  composerConfig.singleSegmentTarget > 0
    ? composerConfig.singleSegmentTarget
    : SINGLE_SEGMENT_SEPTETS;
let currentUser = null;
let countRequestController = null;
let activeSubscriberCount = null;
let currentSegments = 0;

segmentCost.value =
  Number.isFinite(composerConfig.costPerSegment) &&
  composerConfig.costPerSegment >= 0
    ? composerConfig.costPerSegment
    : 0.012;

function getMessageMetrics(message) {
  let septets = 0;
  let isGsm = true;

  for (const character of message) {
    if (GSM_BASIC_CHARACTERS.has(character)) {
      septets += 1;
    } else if (GSM_EXTENSION_CHARACTERS.has(character)) {
      septets += 2;
    } else {
      isGsm = false;
    }
  }

  const messageUnits = isGsm ? septets : message.length;
  const singleSegmentCapacity = isGsm
    ? SINGLE_SEGMENT_SEPTETS
    : SINGLE_SEGMENT_UNICODE_UNITS;
  const multiSegmentCapacity = isGsm
    ? MULTI_SEGMENT_SEPTETS
    : MULTI_SEGMENT_UNICODE_UNITS;
  const segments =
    messageUnits === 0
      ? 0
      : messageUnits <= singleSegmentCapacity
        ? 1
        : Math.ceil(messageUnits / multiSegmentCapacity);
  const segmentCapacity =
    segments <= 1
      ? singleSegmentCapacity
      : segments * multiSegmentCapacity;
  const usedInCurrentSegment =
    segments <= 1
      ? messageUnits
      : messageUnits - (segments - 1) * multiSegmentCapacity;

  return {
    characters: Array.from(message).length,
    isGsm,
    messageUnits,
    remaining:
      segments <= 1
        ? singleSegmentCapacity - messageUnits
        : multiSegmentCapacity - usedInCurrentSegment,
    segmentCapacity,
    segmentSize: segments <= 1 ? singleSegmentCapacity : multiSegmentCapacity,
    segments,
    septets,
    usedInCurrentSegment,
  };
}

function updateCostEstimate() {
  const cost = Number(segmentCost.value);
  costSubscribers.textContent =
    activeSubscriberCount === null
      ? "—"
      : activeSubscriberCount.toLocaleString();
  costSegments.textContent = currentSegments.toLocaleString();

  if (
    activeSubscriberCount === null ||
    !Number.isFinite(cost) ||
    cost < 0
  ) {
    estimatedCost.textContent = "—";
    return;
  }

  estimatedCost.textContent = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(activeSubscriberCount * currentSegments * cost);
}

function adjustSegmentCost(direction) {
  const currentCost = Number(segmentCost.value);
  const step = Number(segmentCost.step);
  const nextCost = Math.max(
    0,
    (Number.isFinite(currentCost) ? currentCost : 0) + direction * step,
  );

  segmentCost.value = nextCost.toFixed(3);
  updateCostEstimate();
}

function updateComposer() {
  const metrics = getMessageMetrics(messageBody.value);
  const isNearLimit =
    metrics.isGsm &&
    metrics.septets > 150 &&
    metrics.septets <= singleSegmentTarget;
  const exceedsSingleSegment =
    metrics.isGsm && metrics.septets > singleSegmentTarget;
  const progressUnits = metrics.isGsm
    ? metrics.septets
    : metrics.messageUnits;
  const progressCapacity = metrics.isGsm
    ? singleSegmentTarget
    : metrics.segmentSize;
  const progress = Math.min(
    (progressUnits / progressCapacity) * 100,
    100,
  );

  currentSegments = metrics.segments;
  characterCount.textContent = metrics.characters.toLocaleString();
  septetCount.textContent = metrics.isGsm
    ? metrics.septets.toLocaleString()
    : "—";
  segmentCount.textContent = metrics.segments.toLocaleString();
  remainingCount.textContent = metrics.remaining.toLocaleString();
  segmentProgress.style.width = `${Number.isFinite(progress) ? progress : 0}%`;
  segmentLabel.textContent = `Segment ${Math.max(metrics.segments, 1)}`;
  segmentUsage.textContent = metrics.isGsm
    ? `${metrics.septets.toLocaleString()} / ${singleSegmentTarget.toLocaleString()} characters`
    : `${metrics.messageUnits.toLocaleString()} / ${metrics.segmentCapacity.toLocaleString()} Unicode units`;
  encodingBadge.textContent = metrics.isGsm ? "GSM-7" : "Non-GSM";
  encodingBadge.dataset.encoding = metrics.isGsm ? "gsm" : "unicode";
  messageForm.dataset.invalid = String(!metrics.isGsm);
  messageForm.dataset.warning = String(isNearLimit);
  messageForm.dataset.overLimit = String(exceedsSingleSegment);
  sendMessageButton.disabled = !messageBody.value || !metrics.isGsm;

  if (!metrics.isGsm) {
    messageError.textContent =
      "This message contains non-GSM characters. Remove them before sending.";
  } else if (exceedsSingleSegment) {
    messageError.textContent =
      `This message uses ${metrics.segments.toLocaleString()} SMS segments and will cost more to send.`;
  } else {
    messageError.textContent = "";
  }

  updateCostEstimate();
}

function setLoginStatus(message, state = "") {
  loginStatus.textContent = message;
  loginStatus.dataset.state = state;
}

function showAdmin(user) {
  currentUser = user;
  loginView.hidden = true;
  adminView.hidden = false;
}

function showLogin(message = "") {
  currentUser = null;
  adminView.hidden = true;
  loginView.hidden = false;
  setLoginStatus(message, message ? "error" : "");
}

function getUserPool() {
  if (
    !Cognito ||
    !cognitoConfig.userPoolId ||
    !cognitoConfig.userPoolClientId
  ) {
    return null;
  }

  return new Cognito.CognitoUserPool({
    UserPoolId: cognitoConfig.userPoolId,
    ClientId: cognitoConfig.userPoolClientId,
    Storage: sessionStorage,
  });
}

const userPool = getUserPool();

function signOut(message = "") {
  countRequestController?.abort();
  countRequestController = null;
  const user = currentUser ?? userPool?.getCurrentUser();
  user?.signOut();
  loginForm.reset();
  activeCount.textContent = "—";
  activeSubscriberCount = null;
  updateCostEstimate();
  countStatus.textContent = "";
  showLogin(message);
}

function getCountError(status) {
  if (status === 401) {
    return "Your session has expired. Sign in again.";
  }

  if (status === 403) {
    return "Your account is not authorized to view subscriber data.";
  }

  return "The subscriber count service is unavailable. Please try again later.";
}

function getAuthenticationError(error) {
  const errorCode = error?.code ?? error?.name;

  if (
    errorCode === "NotAuthorizedException" ||
    errorCode === "UserNotFoundException"
  ) {
    return "The email or password is incorrect.";
  }

  if (errorCode === "PasswordResetRequiredException") {
    return "This admin account requires a password reset before sign-in.";
  }

  if (errorCode === "UserNotConfirmedException") {
    return "This admin account has not been confirmed.";
  }

  if (
    errorCode === "LimitExceededException" ||
    errorCode === "TooManyRequestsException"
  ) {
    return "Too many sign-in attempts. Please wait a moment and try again.";
  }

  return "The authentication service is unavailable. Please try again.";
}

async function loadActiveCount(idToken) {
  activeCount.textContent = "—";
  countStatus.textContent = "Loading subscriber count…";

  if (previewSubscriberCount !== null) {
    activeSubscriberCount = previewSubscriberCount;
    activeCount.textContent = previewSubscriberCount.toLocaleString();
    countStatus.textContent = "Local preview subscriber total.";
    updateCostEstimate();
    return;
  }

  if (!config.activeCountEndpoint) {
    countStatus.textContent = "The subscriber count service is not configured.";
    return;
  }

  countRequestController?.abort();
  countRequestController = new AbortController();

  try {
    const response = await fetch(config.activeCountEndpoint, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: countRequestController.signal,
    });

    if (response.status === 401) {
      signOut(getCountError(response.status));
      return;
    }

    if (!response.ok) {
      countStatus.textContent = getCountError(response.status);
      return;
    }

    let body;

    try {
      body = await response.json();
    } catch {
      countStatus.textContent =
        "The subscriber count service returned an invalid response.";
      return;
    }

    if (!Number.isInteger(body.count) || body.count < 0) {
      countStatus.textContent =
        "The subscriber count service returned an invalid response.";
      return;
    }

    activeCount.textContent = body.count.toLocaleString();
    activeSubscriberCount = body.count;
    updateCostEstimate();
    countStatus.textContent = "Current active subscriber total.";
  } catch (error) {
    if (error.name !== "AbortError") {
      countStatus.textContent =
        "We couldn't reach the subscriber count service. Check your connection and try again.";
    }
  }
}

function completeAuthentication(user, session) {
  if (!session?.isValid()) {
    signOut("Your session has expired. Sign in again.");
    return;
  }

  loginForm.reset();
  setLoginStatus("");
  showAdmin(user);
  loadActiveCount(session.getIdToken().getJwtToken());
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!loginForm.reportValidity()) {
    return;
  }

  if (!userPool) {
    setLoginStatus(
      "The authentication service is unavailable. Please try again later.",
      "error",
    );
    return;
  }

  const formData = new FormData(loginForm);
  const submitButton = loginForm.querySelector("button[type='submit']");
  const user = new Cognito.CognitoUser({
    Username: formData.get("email").trim(),
    Pool: userPool,
    Storage: sessionStorage,
  });
  const authenticationDetails = new Cognito.AuthenticationDetails({
    Username: formData.get("email").trim(),
    Password: formData.get("password"),
  });

  submitButton.disabled = true;
  setLoginStatus("Signing in…");

  user.authenticateUser(authenticationDetails, {
    onSuccess(session) {
      submitButton.disabled = false;
      completeAuthentication(user, session);
    },
    onFailure(error) {
      submitButton.disabled = false;
      setLoginStatus(getAuthenticationError(error), "error");
    },
    newPasswordRequired() {
      submitButton.disabled = false;
      user.signOut();
      setLoginStatus(
        "This account requires an administrator password update before sign-in.",
        "error",
      );
    },
  });
});

signOutButton.addEventListener("click", () => {
  signOut();
  document.querySelector("#email").focus();
});

messageBody.addEventListener("input", updateComposer);
segmentCost.addEventListener("input", updateCostEstimate);
increaseSegmentCost.addEventListener("click", () => adjustSegmentCost(1));
decreaseSegmentCost.addEventListener("click", () => adjustSegmentCost(-1));
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

updateComposer();

if (userPool) {
  const storedUser = userPool.getCurrentUser();

  if (storedUser) {
    storedUser.getSession((error, session) => {
      if (error || !session?.isValid()) {
        storedUser.signOut();
        showLogin();
        return;
      }

      completeAuthentication(storedUser, session);
    });
  }
}
