const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AdminApiError,
  TERMINAL_JOB_STATUSES,
  createAdminApi,
  createAttemptStore,
  createConfirmationGate,
  createJobStore,
  canStartBroadcast,
  estimateBroadcast,
  getAdminSession,
  getMessageMetrics,
  isAllowedBroadcastEnvironment,
} = require("../admin/core.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function apiWith(fetchImplementation) {
  return createAdminApi(fetchImplementation, {
    activeCount: "https://test.local/active-count",
    jobs: "https://test.local/jobs",
    sendMessages: "https://test.local/send",
  });
}

test("preserves straight apostrophes and counts GSM extension septets", () => {
  const message = "We're at Zach's {place}";
  const metrics = getMessageMetrics(message);

  assert.equal(metrics.isGsm, true);
  assert.equal(metrics.characters, Array.from(message).length);
  assert.equal(metrics.septets, metrics.characters + 2);
});

test("rejects smart quotes and unsupported GSM characters", () => {
  const smartQuote = estimateBroadcast("We’re meeting", 100);
  const emoji = estimateBroadcast("Meet here 🎉", 100);

  assert.equal(smartQuote.isValid, false);
  assert.match(smartQuote.errors[0], /Smart quotes/);
  assert.equal(emoji.isValid, false);
  assert.match(emoji.errors[0], /GSM-7/);
});

test("requires a valid admins Cognito session", () => {
  const session = (valid, groups) => ({
    isValid: () => valid,
    getIdToken: () => ({
      getJwtToken: () => "jwt-token",
      payload: { "cognito:groups": groups },
    }),
  });

  assert.deepEqual(getAdminSession(session(true, ["admins"])), {
    jwt: "jwt-token",
  });
  assert.throws(() => getAdminSession(session(false, ["admins"])), {
    status: 401,
  });
  assert.throws(() => getAdminSession(session(true, ["members"])), {
    status: 403,
  });
});

test("adds the Cognito JWT and exact JSON body to admin requests", async () => {
  const calls = [];
  const api = apiWith(async (url, options) => {
    calls.push({ options, url });
    if (url.endsWith("active-count")) return response(200, { count: 10 });
    if (url.includes("/jobs/")) {
      return response(200, { jobId: "job-1", status: "sending" });
    }
    return response(202, { jobId: "job-1", status: "preparing" });
  });

  await api.getActiveCount("jwt-token");
  await api.submitBroadcast("jwt-token", "We're here", "stable-key");
  await api.getJob("jwt-token", "job-1");

  assert.equal(calls.length, 3);
  assert.equal(
    calls.every((call) => call.options.headers.Authorization === "jwt-token"),
    true,
  );
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    idempotencyKey: "stable-key",
    message: "We're here",
  });
});

test("requires confirmation and prevents duplicate confirmation clicks", async () => {
  let submissions = 0;
  let resolveSubmission;
  const gate = createConfirmationGate(
    () =>
      new Promise((resolve) => {
        submissions += 1;
        resolveSubmission = resolve;
      }),
  );

  assert.equal(await gate.confirm(), null);
  gate.review("Exact message", { recipients: 10 });
  const first = gate.confirm();
  assert.equal(await gate.confirm(), null);
  assert.equal(submissions, 1);
  resolveSubmission("done");
  assert.equal(await first, "done");
});

test("blocks a second broadcast while the current job is nonterminal", () => {
  assert.equal(canStartBroadcast("preparing"), false);
  assert.equal(canStartBroadcast("queued"), false);
  assert.equal(canStartBroadcast("sending"), false);
  assert.equal(canStartBroadcast("completed"), true);
  assert.equal(canStartBroadcast("failed"), true);
});

test("allows sends only from an allowlisted HTTPS production host", () => {
  const hosts = ["thezachmartin.github.io"];

  assert.equal(
    isAllowedBroadcastEnvironment(
      { hostname: "thezachmartin.github.io", protocol: "https:" },
      hosts,
    ),
    true,
  );
  assert.equal(
    isAllowedBroadcastEnvironment(
      { hostname: "localhost", protocol: "http:" },
      hosts,
    ),
    false,
  );
  assert.equal(
    isAllowedBroadcastEnvironment(
      { hostname: "192.168.1.2", protocol: "http:" },
      hosts,
    ),
    false,
  );
});

test("reuses an idempotency key for retries and replaces it after edits", () => {
  const storage = memoryStorage();
  let sequence = 0;
  const attempts = createAttemptStore(storage, () => `key-${++sequence}`);

  assert.equal(attempts.beginConfirmedAttempt("Same").idempotencyKey, "key-1");
  assert.equal(attempts.beginConfirmedAttempt("Same").idempotencyKey, "key-1");
  attempts.messageEdited("Changed");
  assert.equal(attempts.beginConfirmedAttempt("Changed").idempotencyKey, "key-2");
});

test("accepts new 202 and idempotent 200 submission responses", async () => {
  for (const status of [202, 200]) {
    const api = apiWith(async () =>
      response(status, { jobId: `job-${status}`, status: "preparing" }),
    );
    const result = await api.submitBroadcast("jwt", "Message", "key");
    assert.equal(result.jobId, `job-${status}`);
  }
});

test("loads progress and identifies terminal states", async () => {
  const api = apiWith(async () =>
    response(200, {
      jobId: "job-1",
      status: "completed",
      totalRecipients: 10,
      remaining: 0,
    }),
  );
  const job = await api.getJob("jwt", "job-1");

  assert.equal(TERMINAL_JOB_STATUSES.has("preparing"), false);
  assert.equal(TERMINAL_JOB_STATUSES.has(job.status), true);
});

test("surfaces 400, 403, 404, 409, and 503 backend responses", async () => {
  const cases = [
    [400, "validation", "Backend validation failed"],
    [403, "", "Administrator access is required."],
    [404, "", "The broadcast job was not found."],
    [409, "idempotency_conflict", "different message content"],
    [409, "broadcast_failed", "cannot be restarted"],
    [503, "", "retry key has been preserved"],
  ];

  for (const [status, code, expected] of cases) {
    const api = apiWith(async () =>
      response(status, code === "validation" ? { message: expected } : { code }),
    );
    await assert.rejects(
      api.submitBroadcast("jwt", "Message", "key"),
      (error) =>
        error instanceof AdminApiError &&
        error.status === status &&
        error.message.includes(expected),
    );
  }
});

test("restores an in-progress job ID from local storage", () => {
  const storage = memoryStorage();
  const jobs = createJobStore(storage);

  jobs.save("job-restored");
  assert.equal(createJobStore(storage).get(), "job-restored");
  jobs.clear();
  assert.equal(jobs.get(), null);
});
