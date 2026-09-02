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
// reviewGate is exported BY NAME, deliberately. `export *` previously re-exported evaluateTransition,
// so any consumer could bypass ReviewGateService and supply its own state, ledger, binding and verdict —
// exactly the hole the service exists to close. The evaluator is pure policy and is NOT part of the
// package's public surface; reach it through ReviewGateService. reviewGateInternal.test.ts fails if it
// leaks again.
export {
  reviewStates, TRANSITIONS, terminalStates, participantRoles, participantSchema,
  candidateBindingSchema, candidateDigest, contentDigest, contentFields,
  verdictSchema, isTransitionAllowed, independenceOf,
  ReviewGateError, MAX_VERDICT_AGE_MS, MAX_CLOCK_SKEW_MS,
  type ReviewState, type ParticipantRole, type Participant, type CandidateBinding, type Verdict,
} from "./reviewGate.js";
// reviewGateService is likewise exported BY NAME. Two things are deliberately absent:
//
//   - TrustedPrincipal is exported as a TYPE ONLY. Round 3 of the independent review pointed out that
//     `export *` published `principalFromSession` and the class value, so any consumer could mint the
//     identity of an uninvolved reviewer and have the gate believe it. A type-only export gives external
//     code no value binding, so there is no `TrustedPrincipal.mint` to reach.
//   - the minting path is not here at all. Identity is established by the SessionAuthenticator the
//     application injects into ReviewGateService, and operations take an opaque proof.
export {
  billingClasses, nonBillableClasses, isCustomerBillable,
  InMemoryReviewGateStore, ReviewGateService,
  type BillingClass, type CandidateRecord, type TransitionOccurrence,
  type ReviewGateStore, type ServiceResult, type SessionAuthenticator,
  type TrustedPrincipal,
} from "./reviewGateService.js";
