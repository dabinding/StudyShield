const text = (value, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : "";
const boolean = value => value === true;

export class ClassroomStore {
  constructor({ now = Date.now, offlineAfterMs = 75000, maxDevices = 500 } = {}) {
    this.now = now;
    this.offlineAfterMs = Math.max(1000, Number(offlineAfterMs) || 75000);
    this.maxDevices = Math.max(1, Number(maxDevices) || 500);
    this.devices = new Map();
    this.screenshots = new Map();
  }

  report(payload = {}) {
    const deviceId = text(payload.deviceId, 128);
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(deviceId)) {
      throw Object.assign(new Error("deviceId is invalid"), { status: 400 });
    }

    const previous = this.devices.get(deviceId) ?? { deviceId, violations: 0, lastEventId: "" };
    const eventId = text(payload.policyEvent?.eventId, 128);
    const isNewViolation = boolean(payload.policyEvent?.violation) && eventId && eventId !== previous.lastEventId;
    const device = {
      ...previous,
      deviceId,
      studentName: text(payload.studentName, 120) || previous.studentName || "Unassigned student",
      deviceLabel: text(payload.deviceLabel, 120) || previous.deviceLabel || deviceId,
      lastSeenAt: this.now(),
      lastActivityAt: Number(payload.lastActivityAt) || previous.lastActivityAt || this.now(),
      idleState: ["active", "idle", "locked"].includes(payload.idleState) ? payload.idleState : "unknown",
      blocked: boolean(payload.blocked),
      gameDetected: boolean(payload.gameDetected),
      activity: {
        title: text(payload.activity?.title, 300),
        url: text(payload.activity?.url, 2048),
        domain: text(payload.activity?.domain, 253),
        category: text(payload.activity?.category, 80) || "web"
      },
      aiStatus: {
        state: text(payload.aiStatus?.state, 40) || "not_applicable",
        category: text(payload.aiStatus?.category, 80),
        confidence: Number.isFinite(payload.aiStatus?.confidence) ? Math.max(0, Math.min(1, payload.aiStatus.confidence)) : null,
        cached: boolean(payload.aiStatus?.cached),
        reason: text(payload.aiStatus?.reason, 240),
        checkedAt: Number(payload.aiStatus?.checkedAt) || null
      },
      network: {
        online: payload.network?.online !== false,
        effectiveType: text(payload.network?.effectiveType, 30) || "unknown"
      },
      deviceHealth: {
        status: text(payload.deviceHealth?.status, 40) || "unknown",
        platform: text(payload.deviceHealth?.platform, 80),
        extensionVersion: text(payload.deviceHealth?.extensionVersion, 30),
        memoryCapacityBytes: Number(payload.deviceHealth?.memoryCapacityBytes) || null
      },
      violations: previous.violations + (isNewViolation ? 1 : 0),
      lastViolation: isNewViolation ? {
        eventId,
        at: Number(payload.policyEvent?.at) || this.now(),
        reason: text(payload.policyEvent?.reason, 240),
        category: text(payload.policyEvent?.category, 80)
      } : previous.lastViolation ?? null,
      lastEventId: isNewViolation ? eventId : previous.lastEventId,
      screenshot: this.screenshots.has(deviceId)
        ? { available: true, capturedAt: this.screenshots.get(deviceId).capturedAt, status: "available" }
        : { available: false, capturedAt: null, status: text(payload.screenshotStatus, 60) || "disabled_by_policy" }
    };

    this.devices.delete(deviceId);
    this.devices.set(deviceId, device);
    while (this.devices.size > this.maxDevices) {
      const oldest = this.devices.keys().next().value;
      this.devices.delete(oldest);
      this.screenshots.delete(oldest);
    }
    return this.publicDevice(device);
  }

  saveScreenshot(deviceIdValue, dataUrl, capturedAt) {
    const deviceId = text(deviceIdValue, 128);
    if (!this.devices.has(deviceId)) throw Object.assign(new Error("device not found"), { status: 404 });
    if (typeof dataUrl !== "string" || !/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl) || dataUrl.length > 1_500_000) {
      throw Object.assign(new Error("screenshot is invalid or too large"), { status: 400 });
    }
    this.screenshots.set(deviceId, { dataUrl, capturedAt: Number(capturedAt) || this.now() });
  }

  getScreenshot(deviceId) {
    return this.screenshots.get(deviceId);
  }

  publicDevice(device) {
    const { lastEventId: _lastEventId, ...safe } = device;
    const screenshot = this.screenshots.get(device.deviceId);
    return {
      ...safe,
      online: this.now() - device.lastSeenAt <= this.offlineAfterMs && device.network.online,
      screenshot: screenshot
        ? { available: true, capturedAt: screenshot.capturedAt, status: "available" }
        : safe.screenshot
    };
  }

  snapshot() {
    const devices = [...this.devices.values()].map(device => this.publicDevice(device)).reverse();
    return {
      generatedAt: this.now(),
      summary: {
        total: devices.length,
        online: devices.filter(device => device.online).length,
        idle: devices.filter(device => device.online && device.idleState !== "active").length,
        blocked: devices.filter(device => device.blocked).length,
        violations: devices.reduce((sum, device) => sum + device.violations, 0)
      },
      devices
    };
  }
}
