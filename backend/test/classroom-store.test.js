import test from "node:test";
import assert from "node:assert/strict";
import { ClassroomStore } from "../src/classroom-store.js";

const heartbeat = {
  deviceId: "device-classroom-01",
  studentName: "Jordan Lee",
  deviceLabel: "Chromebook 14",
  lastActivityAt: 1000,
  idleState: "active",
  blocked: true,
  gameDetected: true,
  activity: { title: "Minecraft gameplay", url: "https://youtube.com/watch?v=test", domain: "youtube.com", category: "non_educational" },
  aiStatus: { state: "complete", category: "non_educational", confidence: 0.96, cached: false, reason: "Gameplay", checkedAt: 1000 },
  network: { online: true, effectiveType: "4g" },
  deviceHealth: { status: "healthy", platform: "cros arm64", extensionVersion: "0.2.0", memoryCapacityBytes: 4000000000 },
  policyEvent: { eventId: "event-1", violation: true, at: 1000, reason: "Gameplay", category: "non_educational" },
  screenshotStatus: "disabled_by_policy"
};

test("classroom snapshot reports activity, status, and unique violations", () => {
  let now = 1000;
  const store = new ClassroomStore({ now: () => now, offlineAfterMs: 75000 });
  store.report(heartbeat);
  store.report(heartbeat);
  let snapshot = store.snapshot();
  assert.equal(snapshot.summary.online, 1);
  assert.equal(snapshot.summary.blocked, 1);
  assert.equal(snapshot.summary.violations, 1);
  assert.equal(snapshot.devices[0].activity.domain, "youtube.com");
  assert.equal(snapshot.devices[0].gameDetected, true);

  now = 77000;
  snapshot = store.snapshot();
  assert.equal(snapshot.summary.online, 0);
  assert.equal(snapshot.devices[0].online, false);
});

test("screen preview data is stored separately from dashboard snapshots", () => {
  const store = new ClassroomStore({ now: () => 1000 });
  store.report({ ...heartbeat, blocked: false, policyEvent: null });
  const dataUrl = `data:image/jpeg;base64,${Buffer.from("preview").toString("base64")}`;
  store.saveScreenshot(heartbeat.deviceId, dataUrl, 900);
  const device = store.snapshot().devices[0];
  assert.deepEqual(device.screenshot, { available: true, capturedAt: 900, status: "available" });
  assert.equal("dataUrl" in device.screenshot, false);
  assert.equal(store.getScreenshot(heartbeat.deviceId).dataUrl, dataUrl);
});

test("classroom store rejects invalid device IDs and oversized screenshots", () => {
  const store = new ClassroomStore();
  assert.throws(() => store.report({ deviceId: "!" }), /deviceId is invalid/);
  store.report({ deviceId: "valid-device" });
  assert.throws(() => store.saveScreenshot("valid-device", "data:text/plain;base64,test"), /screenshot is invalid/);
});
