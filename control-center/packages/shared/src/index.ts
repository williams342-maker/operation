export * from "./protocol.js";
export * from "./rbac.js";
export * from "./signing.js";
export * from "./paths.js";
export * from "./telemetry.js";
export * from "./audit.js";
export * from "./tasks.js";
export * from "./enrollment.js";
export * from "./onboarding.js";
export * from "./aiAssistant.js";
export * from "./configuration.js";
export * from "./configurationDeployment.js";
export * from "./aiSettings.js";
export * from "./agentUpgrades.js";
export * from "./agentKeys.js";
export * from "./agentProtocol.js";
export * from "./ownerAuthorization.js";
export * from "./billing.js";
export * from "./authority.js";
// THE REVIEW GATE IS NOT HERE ANY MORE.
//
// Its policy, its store and its evaluator moved into `apps/review-gate`, which is a separate process
// with its own database. The control-center reaches it over an authenticated HTTP API and holds no
// object that can decide anything.
//
// Ten review rounds went into trying to make this a boundary while it lived in a package the
// control-center imports. Each fix relocated the reachable primitive rather than removing it: the
// evaluator was exported, then the minting function, then the store, then the store through a property,
// then the write capability through a caller-supplied wrapper. The reviewer's conclusion was that the
// design treated packaging as an authority boundary, and packaging is not one.
//
// This absence is hygiene, not the security argument. The argument is process isolation, exclusive
// database credentials, server-side authentication, and the enforcement point in
// `docs/REVIEW_GATE_OPTION_B_DESIGN.md` §2.
