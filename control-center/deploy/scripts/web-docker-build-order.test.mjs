import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../../apps/web/Dockerfile", import.meta.url), "utf8");
const dockerignore = await readFile(new URL("../../.dockerignore", import.meta.url), "utf8");

test("web image builds shared output before compiling the dependent web workspace", () => {
  const sharedBuild = "RUN npm run build --workspace @control-center/shared";
  const webBuild = "RUN npm run build --workspace @control-center/web";
  const sharedIndex = dockerfile.indexOf(sharedBuild);
  const webIndex = dockerfile.indexOf(webBuild);

  assert.notEqual(sharedIndex, -1, "the clean image build must create packages/shared/dist");
  assert.notEqual(webIndex, -1, "the image must compile the web workspace");
  assert.ok(sharedIndex < webIndex, "the shared workspace must build before the web workspace");
  assert.match(dockerignore, /^dist$/m, "host-generated dist directories must stay outside the build context");
});

test("web runtime still serves only the production bundle with the established nginx image", () => {
  assert.match(dockerfile, /FROM nginx:1\.27-alpine AS runtime/);
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/web\/dist \/usr\/share\/nginx\/html/);
  assert.match(dockerfile, /HEALTHCHECK .*wget -qO- http:\/\/127\.0\.0\.1:8080\//);
  assert.doesNotMatch(dockerfile, /COPY --from=build \/app\/packages\/shared\/dist/);
});
