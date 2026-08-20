"use strict";

const loginView = document.querySelector("#login-view");
const adminView = document.querySelector("#admin-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const signOutButton = document.querySelector("#sign-out");
const refreshEstimateButton = document.querySelector("#refresh-estimate");
const activeCount = document.querySelector("#active-count");
const countStatus = document.querySelector("#count-status");
const messageForm = document.querySelector("#message-form");
const messageBody = document.querySelector("#message-body");
const characterCount = document.querySelector("#character-count");
const messageCharacterCount = document.querySelector("#message-character-count");
const segmentCount = document.querySelector("#segment-count");
const remainingCount = document.querySelector("#remaining-count");
const segmentProgress = document.querySelector("#segment-progress");
const segmentUsage = document.querySelector("#segment-usage");
const encodingBadge = document.querySelector("#encoding-badge");
const messageError = document.querySelector("#message-error");
const reviewButton = document.querySelector("#review-message");
const estimatedCost = document.querySelector("#estimated-cost");
const costSubscribers = document.querySelector("#cost-subscribers");
const costSegments = document.querySelector("#cost-segments");
const confirmationDialog = document.querySelector("#confirmation-dialog");
const confirmationMessage = document.querySelector("#confirmation-message");
const confirmationRecipients = document.querySelector("#confirmation-recipients");
const confirmationSegments = document.querySelector("#confirmation-segments");
const confirmationTotalSegments = document.querySelector("#confirmation-total-segments");
const confirmationCost = document.querySelector("#confirmation-cost");
const confirmationWarning = document.querySelector("#confirmation-warning");
const confirmSendButton = document.querySelector("#confirm-send");
const cancelSendButton = document.querySelector("#cancel-send");
const jobPanel = document.querySelector("#job-panel");
const jobStatus = document.querySelector("#job-status");
const jobSent = document.querySelector("#job-sent");
const jobFailed = document.querySelector("#job-failed");
const jobProgressTrack = document.querySelector(".job-progress-track");
const jobProgress = document.querySelector("#job-progress");
const jobProgressLabel = document.querySelector("#job-progress-label");
const jobError = document.querySelector("#job-error");
const dismissJobButton = document.querySelector("#dismiss-job");
const config = window.THURSDAY_SOCIAL_CONFIG ?? {};
const composerConfig = config.adminComposer ?? {};
const cognitoConfig = config.cognito ?? {};
const Cognito = window.AmazonCognitoIdentity;
const core = window.ThursdaySocialAdminCore;
const api = core.createAdminApi(window.fetch.bind(window), {
  activeCount: config.activeCountEndpoint,
  jobs: config.adminJobsEndpoint,
  sendMessages: config.sendMessagesEndpoint,
});
const attemptStore = core.createAttemptStore(
  localStorage,
  () => window.crypto.randomUUID(),
);
const currentJobStore = core.createJobStore(localStorage);
const limits = {
  costPerSegment: composerConfig.costPerSegment ?? 0.012,
  maxEstimatedCostUsd: composerConfig.maxEstimatedCostUsd ?? 250,
  maxRecipients: composerConfig.maxRecipients ?? 10000,
  maxSegmentsPerRecipient: composerConfig.maxSegmentsPerRecipient ?? 1,
};
const pollIntervalMs = composerConfig.pollIntervalMs ?? 3000;
const isLocalMockPreview =
  composerConfig.mockAdminFlowOnLocalhost === true &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const isBroadcastEnvironment = core.isAllowedBroadcastEnvironment(
  window.location,
  config.adminBroadcastHosts,
);
const canSubmitBroadcast = isBroadcastEnvironment || isLocalMockPreview;

let currentUser = null;
let currentJwt = "";
let activeSubscriberCount = null;
let currentEstimate = core.estimateBroadcast("", null, limits);
let countController = null;
let pollTimer = null;
let pollGeneration = 0;
let submissionInProgress = false;
let currentJobStatus = "";
let jobLookupFailures = 0;
const confirmationGate = core.createConfirmationGate(({ message }) =>
  submitConfirmedBroadcast(message),
);

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "—";
}

function formatCurrency(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value)
    : "—";
}

function setLoginStatus(message, state = "") {
  loginStatus.textContent = message;
  loginStatus.dataset.state = state;
}

function getUserPool() {
  if (!Cognito || !cognitoConfig.userPoolId || !cognitoConfig.userPoolClientId) {
    return null;
  }

  return new Cognito.CognitoUserPool({
    UserPoolId: cognitoConfig.userPoolId,
    ClientId: cognitoConfig.userPoolClientId,
    Storage: sessionStorage,
  });
}

const userPool = getUserPool();

function stopPolling() {
  pollGeneration += 1;
  window.clearTimeout(pollTimer);
  pollTimer = null;
}

function showLogin(message = "") {
  currentUser = null;
  currentJwt = "";
  adminView.hidden = true;
  loginView.hidden = false;
  setLoginStatus(message, message ? "error" : "");
}

function signOut(message = "") {
  stopPolling();
  countController?.abort();
  countController = null;
  (currentUser ?? userPool?.getCurrentUser())?.signOut();
  loginForm.reset();
  activeSubscriberCount = null;
  activeCount.textContent = "—";
  countStatus.textContent = "";
  showLogin(message);
}

function handleApiError(error, target) {
  if (error instanceof core.AdminApiError && [401, 403].includes(error.status)) {
    signOut(error.message);
    return true;
  }

  target.textContent =
    error instanceof core.AdminApiError
      ? error.message
      : "We couldn't reach the broadcast service. Check your connection and try again.";
  return false;
}

function updateComposer() {
  attemptStore.messageEdited(messageBody.value);
  currentEstimate = core.estimateBroadcast(
    messageBody.value,
    activeSubscriberCount,
    limits,
  );
  const { metrics } = currentEstimate;
  const progress = Math.min((metrics.septets / 160) * 100, 100);

  characterCount.textContent = formatNumber(metrics.characters);
  messageCharacterCount.textContent = formatNumber(metrics.characters);
  segmentCount.textContent = formatNumber(metrics.segments);
  remainingCount.textContent = metrics.isGsm ? formatNumber(metrics.remaining) : "—";
  segmentProgress.style.width = `${Number.isFinite(progress) ? progress : 0}%`;
  segmentUsage.textContent = metrics.isGsm
    ? `${formatNumber(metrics.characters)} / 160 characters`
    : "Unsupported GSM-7 characters";
  encodingBadge.textContent = metrics.isGsm ? "GSM-7" : "Unsupported";
  encodingBadge.dataset.encoding = metrics.isGsm ? "gsm" : "unicode";
  messageForm.dataset.invalid = String(!metrics.isGsm);
  messageForm.dataset.overLimit = String(metrics.segments > 1);
  messageError.textContent =
    (messageBody.value ? currentEstimate.errors[0] : null) ??
    (!canSubmitBroadcast && messageBody.value
      ? "Broadcast submission is enabled only on the configured production host."
      : !core.canStartBroadcast(currentJobStatus)
        ? "Wait for the current broadcast to finish before starting another."
      : "");
  reviewButton.disabled =
    !currentEstimate.isValid ||
    submissionInProgress ||
    !canSubmitBroadcast ||
    !core.canStartBroadcast(currentJobStatus);
  costSubscribers.textContent = formatNumber(activeSubscriberCount);
  costSegments.textContent = formatNumber(currentEstimate.totalSegments);
  estimatedCost.textContent = formatCurrency(currentEstimate.estimatedCostUsd);
}

async function loadActiveCount() {
  if (isLocalMockPreview) {
    activeSubscriberCount = 100;
    activeCount.textContent = formatNumber(activeSubscriberCount);
    countStatus.textContent = "Mock subscriber total for local preview.";
    updateComposer();
    return;
  }

  countController?.abort();
  const controller = new AbortController();
  countController = controller;
  activeCount.textContent = "—";
  countStatus.textContent = "Refreshing subscriber count…";
  refreshEstimateButton.disabled = true;

  try {
    activeSubscriberCount = await api.getActiveCount(currentJwt, {
      signal: controller.signal,
    });
    activeCount.textContent = formatNumber(activeSubscriberCount);
    countStatus.textContent = "Current active subscriber total.";
  } catch (error) {
    if (error.name === "AbortError") return;
    activeSubscriberCount = null;
    handleApiError(error, countStatus);
  } finally {
    if (countController === controller) {
      countController = null;
      refreshEstimateButton.disabled = false;
      updateComposer();
    }
  }
}

function showAdmin(user, jwt) {
  currentUser = user;
  currentJwt = jwt;
  loginView.hidden = true;
  adminView.hidden = false;
  if (isLocalMockPreview) {
    activeSubscriberCount = 100;
    activeCount.textContent = formatNumber(activeSubscriberCount);
    countStatus.textContent = "Mock subscriber total for local preview.";
    confirmationWarning.textContent =
      "Local preview only. Sending simulates broadcast progress without contacting the production backend.";
    confirmationWarning.classList.add("preview-warning");
    renderJob({
      jobId: "local-preview",
      status: "completed",
      totalRecipients: 100,
      queued: 0,
      sent: 98,
      failed: 2,
      remaining: 0,
    });
    return;
  }

  loadActiveCount();
  restoreCurrentJob();
}

function completeAuthentication(user, session) {
  try {
    const { jwt } = core.getAdminSession(session);
    loginForm.reset();
    setLoginStatus("");
    showAdmin(user, jwt);
  } catch (error) {
    user?.signOut();
    showLogin(error.message);
  }
}

function openConfirmation() {
  if (!canSubmitBroadcast) {
    messageError.textContent =
      "Broadcast submission is enabled only on the configured production host.";
    return;
  }

  if (!core.canStartBroadcast(currentJobStatus)) {
    messageError.textContent =
      "Wait for the current broadcast to finish before starting another.";
    return;
  }

  currentEstimate = core.estimateBroadcast(
    messageBody.value,
    activeSubscriberCount,
    limits,
  );
  if (!currentEstimate.isValid) {
    updateComposer();
    return;
  }

  confirmationMessage.textContent = messageBody.value;
  confirmationRecipients.textContent = formatNumber(currentEstimate.recipients);
  confirmationSegments.textContent = formatNumber(
    currentEstimate.segmentsPerRecipient,
  );
  confirmationTotalSegments.textContent = formatNumber(
    currentEstimate.totalSegments,
  );
  confirmationCost.textContent = formatCurrency(
    currentEstimate.estimatedCostUsd,
  );
  confirmationGate.review(messageBody.value, currentEstimate);
  confirmationDialog.showModal();
}

function saveCurrentJob(id) {
  currentJobStore.save(id);
}

function clearCurrentJob() {
  currentJobStore.clear();
  currentJobStatus = "";
  jobLookupFailures = 0;
}

function renderJob(job) {
  const percentage = core.getProgressPercentage(job);
  const isComplete = job.status === "completed" && percentage === 100;
  currentJobStatus = job.status;
  jobLookupFailures = 0;
  jobPanel.hidden = false;
  jobStatus.textContent = job.status;
  jobStatus.dataset.status = job.status;
  jobSent.textContent = formatNumber(job.sent);
  jobFailed.textContent = formatNumber(job.failed);
  jobProgress.style.width = `${percentage}%`;
  jobProgressTrack.setAttribute("aria-valuenow", String(Math.round(percentage)));
  jobProgressLabel.textContent = `${Math.round(percentage)}%`;
  jobStatus.hidden = isComplete;
  dismissJobButton.hidden = !isComplete;
  updateComposer();
}

function runLocalMockBroadcast(totalRecipients) {
  const steps = [
    { status: "queued", sent: 0, failed: 0, remaining: totalRecipients },
    {
      status: "sending",
      sent: Math.floor(totalRecipients * 0.4),
      failed: 0,
      remaining: totalRecipients - Math.floor(totalRecipients * 0.4),
    },
    {
      status: "sending",
      sent: Math.max(0, totalRecipients - 3),
      failed: 1,
      remaining: Math.min(2, totalRecipients),
    },
    {
      status: "completed",
      sent: Math.max(0, totalRecipients - 1),
      failed: Math.min(1, totalRecipients),
      remaining: 0,
    },
  ];
  const generation = ++pollGeneration;
  let stepIndex = 0;

  function advance() {
    if (generation !== pollGeneration) return;

    const step = steps[stepIndex];
    renderJob({
      jobId: "local-preview",
      totalRecipients,
      queued: step.remaining,
      ...step,
    });
    stepIndex += 1;
    if (stepIndex < steps.length) {
      pollTimer = window.setTimeout(advance, 1200);
    }
  }

  advance();
}

async function pollJob(id, generation = ++pollGeneration) {
  try {
    const job = await api.getJob(currentJwt, id);
    if (generation !== pollGeneration) return;

    jobError.textContent = "";
    renderJob(job);
    if (!core.TERMINAL_JOB_STATUSES.has(job.status)) {
      pollTimer = window.setTimeout(() => pollJob(id, generation), pollIntervalMs);
    }
  } catch (error) {
    if (generation !== pollGeneration) return;
    if (handleApiError(error, jobError)) return;

    if (error instanceof core.AdminApiError && error.status === 404) {
      jobLookupFailures += 1;
      if (jobLookupFailures >= 3) {
        jobError.textContent =
          "The job could not be found after several attempts.";
        return;
      }
    }

    pollTimer = window.setTimeout(() => pollJob(id, generation), pollIntervalMs);
  }
}

function restoreCurrentJob() {
  const storedJobId = currentJobStore.get();
  if (storedJobId) {
    currentJobStatus = "restoring";
    jobPanel.hidden = false;
    jobStatus.textContent = "Restoring…";
    pollJob(storedJobId);
    updateComposer();
  }
}

async function submitConfirmedBroadcast(confirmedMessage) {
  if (submissionInProgress) return;

  submissionInProgress = true;
  confirmSendButton.disabled = true;
  cancelSendButton.disabled = true;
  reviewButton.disabled = true;
  jobError.textContent = "";

  if (currentJobStore.get()) {
    stopPolling();
    clearCurrentJob();
    attemptStore.clear();
    jobPanel.hidden = true;
  }

  const attempt = attemptStore.beginConfirmedAttempt(confirmedMessage);

  try {
    if (isLocalMockPreview) {
      confirmationDialog.close();
      attemptStore.clear();
      runLocalMockBroadcast(currentEstimate.recipients);
      return;
    }

    const result = await api.submitBroadcast(
      currentJwt,
      attempt.message,
      attempt.idempotencyKey,
    );
    if (!result?.jobId) {
      throw new core.AdminApiError("The service returned an invalid job.", 200);
    }

    stopPolling();
    clearCurrentJob();
    saveCurrentJob(result.jobId);
    confirmationDialog.close();
    renderJob({
      jobId: result.jobId,
      status: result.status,
      totalRecipients: result.estimate?.recipients ?? 0,
      queued: 0,
      sent: 0,
      failed: 0,
      remaining: result.estimate?.recipients ?? 0,
    });
    pollJob(result.jobId);
  } catch (error) {
    confirmationDialog.close();
    if (
      error instanceof core.AdminApiError &&
      error.status === 409 &&
      error.code === "broadcast_failed"
    ) {
      attemptStore.clear();
    }
    handleApiError(error, messageError);
  } finally {
    submissionInProgress = false;
    confirmSendButton.disabled = false;
    cancelSendButton.disabled = false;
    updateComposer();
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;

  if (isLocalMockPreview) {
    loginForm.reset();
    setLoginStatus("");
    showAdmin(null, "");
    return;
  }

  if (!userPool) {
    setLoginStatus("The authentication service is unavailable.", "error");
    return;
  }

  const formData = new FormData(loginForm);
  const username = formData.get("email").trim();
  const submitButton = loginForm.querySelector("button[type='submit']");
  const user = new Cognito.CognitoUser({
    Username: username,
    Pool: userPool,
    Storage: sessionStorage,
  });
  const authenticationDetails = new Cognito.AuthenticationDetails({
    Username: username,
    Password: formData.get("password"),
  });

  user.setAuthenticationFlowType("USER_SRP_AUTH");
  submitButton.disabled = true;
  setLoginStatus("Signing in…");
  user.authenticateUser(authenticationDetails, {
    onSuccess(session) {
      submitButton.disabled = false;
      completeAuthentication(user, session);
    },
    onFailure(error) {
      submitButton.disabled = false;
      const invalidCredentials = [
        "NotAuthorizedException",
        "UserNotFoundException",
      ].includes(error?.code ?? error?.name);
      setLoginStatus(
        invalidCredentials
          ? "The email or password is incorrect."
          : "The authentication service is unavailable. Please try again.",
        "error",
      );
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

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openConfirmation();
});
messageBody.addEventListener("input", updateComposer);
refreshEstimateButton.addEventListener("click", loadActiveCount);
confirmSendButton.addEventListener("click", () => confirmationGate.confirm());
cancelSendButton.addEventListener("click", () => {
  confirmationGate.cancel();
  confirmationDialog.close();
});
signOutButton.addEventListener("click", () => signOut());
dismissJobButton.addEventListener("click", () => {
  stopPolling();
  clearCurrentJob();
  attemptStore.clear();
  jobPanel.hidden = true;
  updateComposer();
});

updateComposer();

if (!isLocalMockPreview && userPool) {
  const storedUser = userPool.getCurrentUser();
  if (storedUser) {
    storedUser.getSession((error, session) => {
      if (error) {
        storedUser.signOut();
        showLogin();
        return;
      }
      completeAuthentication(storedUser, session);
    });
  }
}
