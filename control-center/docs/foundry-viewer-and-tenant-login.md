# Foundry access and tenant selection

Viewers can list and read projects and ready artifacts within their organization. Every
Foundry write requires `projects:manage`, including creation, preparation, suggestions,
brief/section updates and approval. The UI shows read-only access and never automatically
prepares a Viewer’s unfinished project. Server authorization remains the boundary.

Enrollment permission applies only to enrollment and Cloudflare Access integration
routes. It must not intercept unrelated Foundry reads.

For a deployment with an established default tenant, operators may set
`CONTROL_CENTER_DEFAULT_ORGANIZATION_SLUG` to that existing organization's exact slug.
Password login without a slug and verified Google login then select that tenant; they
still require an enabled user in it and valid authentication. An explicit password-login
organization slug selects only that organization. No cross-tenant user lookup is made.
An invalid configured default fails closed. With no default configured, the original
single-organization fallback remains; ambiguous multi-organization login fails closed.
Owner replacement retains its separate single-organization guards.

Before adding disposable tenants on staging, configure and verify the existing default
organization so its user's slugless login remains available. Remove disposable users,
sessions and projects before their organizations. Retain audit evidence.

No schema migration, index change or data rewrite is introduced. Rollback must restore
API and web together. The predecessor lacks default-tenant selection and must only be
restored after all disposable extra tenants are removed. A source-level finding is not
a substitute for the required live rollback and journey checks.
