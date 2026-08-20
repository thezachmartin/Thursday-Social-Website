window.THURSDAY_SOCIAL_CONFIG = {
  apiEndpoint:
    "https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/signup",
  activeCountEndpoint:
    "https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/admin/active-count",
  sendMessagesEndpoint:
    "https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/admin/sendMessages",
  adminJobsEndpoint:
    "https://gacse1myqa.execute-api.us-east-1.amazonaws.com/prod/admin/jobs",
  adminBroadcastHosts: ["thezachmartin.github.io"],
  adminComposer: {
    costPerSegment: 0.012,
    maxEstimatedCostUsd: 250,
    maxRecipients: 10000,
    maxSegmentsPerRecipient: 1,
    pollIntervalMs: 3000,
    mockAdminFlowOnLocalhost: true,
  },
  cognito: {
    region: "us-east-1",
    userPoolId: "us-east-1_MgIIQ8dKB",
    userPoolClientId: "7g5h92qh2k10tv7edrnsqlk50n",
  },
};
