const loginView = document.querySelector("#login-view");
const adminView = document.querySelector("#admin-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const signOutButton = document.querySelector("#sign-out");
const activeCount = document.querySelector("#active-count");
const countStatus = document.querySelector("#count-status");
const config = window.THURSDAY_SOCIAL_CONFIG ?? {};
const cognitoConfig = config.cognito ?? {};
const Cognito = window.AmazonCognitoIdentity;
let currentUser = null;
let countRequestController = null;

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
