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
// InMemoryReviewGateStore is ABSENT from this list as of round 8, and that is the point.
//
// An independent review observed that publishing it handed every consumer the mutation primitive the
// service exists to mediate: `create()` takes a caller-built record including its state, and
// `compareAndSetState()` wrote any nextState it was given. Importing the store and writing a record
// straight into READY_FOR_OWNER_DECISION reconstructed the original bypass one layer below the service.
// That is the third time I have published the primitive and described the wrapper as the boundary.
//
// The store is a PORT. An application supplies its own implementation of the ReviewGateStore type; the
// in-memory one is a reference used by this package's own tests, which reach it by relative path from
// inside the package. It is not part of what the package hands out.
export {
  billingClasses, nonBillableClasses, isCustomerBillable,
  ReviewGateService,
  type BillingClass, type CandidateRecord, type TransitionOccurrence,
  type ReviewGateStore, type ServiceResult, type SessionAuthenticator,
  type EvidenceRecord, type StoredVerdict,
  type TrustedPrincipal,
} from "./reviewGateService.js";
