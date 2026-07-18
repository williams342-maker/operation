# URL-first onboarding migration

The migration is additive and runs through the existing `ensureIndexes()` startup path.

- Existing server documents remain valid because `primaryUrl`, `detectedPublicIps`, `enrollmentStatus`, `agentStatus`, and machine metadata are nullable/optional.
- The existing `ops-workbench` document is reused when its slug is selected. Its `_id`, name, slug, `createdAt`, project references, and `allowlistedRoots` are not replaced.
- Enrollment records may now contain `serverId`; legacy generic records remain supported.
- `primaryUrl` is deliberately not unique and is not treated as machine identity.

## Rollback

Deploy the preceding application commit. The preceding version ignores the additive fields and index. Do not unset fields or restore the database unless corruption is independently confirmed. The optional `orgId_1_enrollmentStatus_1_updatedAt_-1` index may be retained safely.
