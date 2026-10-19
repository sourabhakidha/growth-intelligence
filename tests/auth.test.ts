import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionValid, matchRole, passwordFingerprint } from "../lib/auth/passwords.ts";

const env = { DASHBOARD_PASSWORD: "view-pw", DASHBOARD_PASSWORD_ADMIN: "admin-pw", DASHBOARD_PASSWORD_FINANCE: "fin-pw" };

test("passwords map to roles and are deny-by-default", async () => {
  assert.equal(await matchRole("view-pw", env), "viewer");
  assert.equal(await matchRole("admin-pw", env), "admin");
  assert.equal(await matchRole("fin-pw", env), "finance");
  assert.equal(await matchRole("Admin-pw", env), null);
  assert.equal(await matchRole("", env), null);
  assert.equal(await matchRole(undefined, env), null);
  assert.equal(await matchRole("", { DASHBOARD_PASSWORD: "" }), null);
  assert.equal(await matchRole("anything", {}), null);
});

test("changing or removing a password invalidates existing sessions", async () => {
  const fp = await passwordFingerprint("admin", env);
  assert.equal(await isSessionValid("admin", fp, env), true);
  assert.equal(await isSessionValid("admin", fp, { ...env, DASHBOARD_PASSWORD_ADMIN: "new-pw" }), false);
  assert.equal(await isSessionValid("admin", fp, { ...env, DASHBOARD_PASSWORD_ADMIN: undefined }), false);
  assert.equal(await isSessionValid("finance", fp, env), false);
  assert.equal(await isSessionValid("root", fp, env), false);
  assert.equal(await isSessionValid("admin", undefined, env), false);
});
