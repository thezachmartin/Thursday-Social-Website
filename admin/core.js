(function exposeAdminCore(root, factory) {
  const core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }

  if (root) {
    root.ThursdaySocialAdminCore = core;
  }
})(typeof globalThis === "object" ? globalThis : this, function createAdminCore() {
  "use strict";

  const GSM_BASIC_CHARACTERS = new Set(
    Array.from(
      "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
    ),
  );
  const GSM_EXTENSION_CHARACTERS = new Set(Array.from("\f^{}\\[~]|€"));
  const TERMINAL_JOB_STATUSES = new Set(["completed", "failed"]);
  const JOB_STATUSES = new Set([
    "preparing",
    "queued",
    "sending",
    ...TERMINAL_JOB_STATUSES,
  ]);
  const ATTEMPT_STORAGE_KEY = "thursday-social-admin-broadcast-attempt";
  const JOB_STORAGE_KEY = "thursday-social-admin-current-job";

  class AdminApiError extends Error {
    constructor(message, status, code = "") {
      super(message);
      this.name = "AdminApiError";
      this.status = status;
      this.code = code;
    }
  }

  function getMessageMetrics(message) {
    let septets = 0;
    const unsupportedCharacters = [];

    for (const character of message) {
      if (GSM_BASIC_CHARACTERS.has(character)) {
        septets += 1;
      } else if (GSM_EXTENSION_CHARACTERS.has(character)) {
        septets += 2;
      } else {
        unsupportedCharacters.push(character);
      }
    }

    const segments =
      septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153);

    return {
      characters: Array.from(message).length,
      encoding: unsupportedCharacters.length === 0 ? "GSM-7" : "unsupported",
      isGsm: unsupportedCharacters.length === 0,
      remaining: segments <= 1 ? 160 - septets : 0,
      segments,
      septets,
      unsupportedCharacters: [...new Set(unsupportedCharacters)],
    };
  }

  function estimateBroadcast(message, recipients, limits = {}) {
    const metrics = getMessageMetrics(message);
    const costPerSegment = limits.costPerSegment ?? 0.012;
    const totalSegments =
      Number.isInteger(recipients) && recipients >= 0
        ? recipients * metrics.segments
        : null;
    const estimatedCostUsd =
      totalSegments === null ? null : totalSegments * costPerSegment;
    const errors = [];

    if (!message) {
      errors.push("Enter a message before continuing.");
    }

    if (!metrics.isGsm) {
      const hasSmartQuote = metrics.unsupportedCharacters.some((character) =>
        ["‘", "’", "“", "”"].includes(character),
      );
      errors.push(
        hasSmartQuote
          ? "Smart quotes are not supported. Use straight quotes and apostrophes."
          : "This message contains characters that are not supported by GSM-7.",
      );
    }

    if (metrics.segments > (limits.maxSegmentsPerRecipient ?? 1)) {
      errors.push("The message must fit in one SMS segment.");
    }

    if (
      Number.isInteger(recipients) &&
      recipients > (limits.maxRecipients ?? 10000)
    ) {
      errors.push("The active recipient count exceeds the 10,000-recipient limit.");
    }

    if (
      estimatedCostUsd !== null &&
      estimatedCostUsd > (limits.maxEstimatedCostUsd ?? 250)
    ) {
      errors.push("The estimated broadcast cost exceeds the $250 limit.");
    }

    return {
      errors,
      estimatedCostUsd,
      isValid:
        errors.length === 0 && Number.isInteger(recipients) && recipients >= 0,
      metrics,
      recipients,
      segmentsPerRecipient: metrics.segments,
      totalSegments,
    };
  }

  function getAdminSession(session) {
    if (!session?.isValid?.()) {
      throw new AdminApiError("Your session has expired. Sign in again.", 401);
    }

    const idToken = session.getIdToken?.();
    const jwt = idToken?.getJwtToken?.();
    const groups = idToken?.payload?.["cognito:groups"];

    if (!jwt) {
      throw new AdminApiError("Your session has expired. Sign in again.", 401);
    }

    if (!Array.isArray(groups) || !groups.includes("admins")) {
      throw new AdminApiError(
        "Administrator access is required for this account.",
        403,
      );
    }

    return { jwt };
  }

  async function readResponse(response) {
    let body = null;

    try {
      body = await response.json();
    } catch {
      if (response.ok) {
        throw new AdminApiError(
          "The service returned an invalid response.",
          response.status,
        );
      }
    }

    if (!response.ok) {
      throw new AdminApiError(
        typeof body?.message === "string" && body.message
          ? body.message
          : getStatusMessage(response.status, body?.code),
        response.status,
        typeof body?.code === "string" ? body.code : "",
      );
    }

    return body;
  }

  function getStatusMessage(status, code = "") {
    if (status === 400) return "The backend rejected this message.";
    if (status === 401) return "Your session has expired. Sign in again.";
    if (status === 403) return "Administrator access is required.";
    if (status === 404) return "The broadcast job was not found.";
    if (status === 409 && code === "idempotency_conflict") {
      return "This retry key was already used for different message content.";
    }
    if (status === 409 && code === "broadcast_failed") {
      return "This failed broadcast cannot be restarted with the same retry key.";
    }
    if (status === 503) {
      return "The broadcast service is temporarily unavailable. Your retry key has been preserved.";
    }
    return "The broadcast service returned an unexpected error.";
  }

  function createAdminApi(fetchImplementation, endpoints) {
    function request(url, jwt, options = {}) {
      return fetchImplementation(url, {
        ...options,
        headers: {
          Authorization: jwt,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      }).then(readResponse);
    }

    return {
      async getActiveCount(jwt, options = {}) {
        const body = await request(endpoints.activeCount, jwt, options);

        if (!Number.isInteger(body?.count) || body.count < 0) {
          throw new AdminApiError("The service returned an invalid count.", 200);
        }

        return body.count;
      },

      getJob(jwt, jobId) {
        return request(
          `${endpoints.jobs}/${encodeURIComponent(jobId)}`,
          jwt,
        ).then((body) => {
          if (!body?.jobId || !JOB_STATUSES.has(body.status)) {
            throw new AdminApiError(
              "The service returned invalid job progress.",
              200,
            );
          }
          return body;
        });
      },

      submitBroadcast(jwt, message, idempotencyKey) {
        return request(endpoints.sendMessages, jwt, {
          method: "POST",
          body: JSON.stringify({ message, idempotencyKey }),
        });
      },
    };
  }

  function createAttemptStore(storage, randomUUID) {
    function read() {
      const serialized = storage.getItem(ATTEMPT_STORAGE_KEY);
      if (!serialized) return null;

      try {
        const attempt = JSON.parse(serialized);
        return typeof attempt.message === "string" &&
          typeof attempt.idempotencyKey === "string"
          ? attempt
          : null;
      } catch {
        storage.removeItem(ATTEMPT_STORAGE_KEY);
        return null;
      }
    }

    return {
      beginConfirmedAttempt(message) {
        const existing = read();
        if (existing?.message === message) return existing;

        const attempt = { message, idempotencyKey: randomUUID() };
        storage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
        return attempt;
      },

      clear() {
        storage.removeItem(ATTEMPT_STORAGE_KEY);
      },

      getForMessage(message) {
        const attempt = read();
        return attempt?.message === message ? attempt : null;
      },

      messageEdited(message) {
        const attempt = read();
        if (attempt && attempt.message !== message) this.clear();
      },
    };
  }

  function createConfirmationGate(onConfirm) {
    let pending = null;
    let inProgress = false;

    return {
      cancel() {
        pending = null;
      },

      async confirm() {
        if (!pending || inProgress) return null;

        const confirmed = pending;
        inProgress = true;
        try {
          return await onConfirm(confirmed);
        } finally {
          inProgress = false;
          pending = null;
        }
      },

      review(message, estimate) {
        pending = { estimate, message };
        return pending;
      },
    };
  }

  function createJobStore(storage) {
    return {
      clear() {
        storage.removeItem(JOB_STORAGE_KEY);
      },
      get() {
        return storage.getItem(JOB_STORAGE_KEY);
      },
      save(jobId) {
        storage.setItem(JOB_STORAGE_KEY, jobId);
      },
    };
  }

  function getProgressPercentage(job) {
    if (!Number.isFinite(job?.totalRecipients) || job.totalRecipients <= 0) {
      return job?.status === "completed" ? 100 : 0;
    }

    return Math.min(
      100,
      Math.max(0, ((job.totalRecipients - (job.remaining ?? 0)) / job.totalRecipients) * 100),
    );
  }

  function canStartBroadcast(jobStatus) {
    return !jobStatus || TERMINAL_JOB_STATUSES.has(jobStatus);
  }

  function isAllowedBroadcastEnvironment(location, allowedHosts) {
    return (
      location?.protocol === "https:" &&
      Array.isArray(allowedHosts) &&
      allowedHosts.includes(location.hostname)
    );
  }

  return {
    AdminApiError,
    ATTEMPT_STORAGE_KEY,
    JOB_STORAGE_KEY,
    TERMINAL_JOB_STATUSES,
    canStartBroadcast,
    createAdminApi,
    createAttemptStore,
    createConfirmationGate,
    createJobStore,
    estimateBroadcast,
    getAdminSession,
    getMessageMetrics,
    getProgressPercentage,
    getStatusMessage,
    isAllowedBroadcastEnvironment,
  };
});
