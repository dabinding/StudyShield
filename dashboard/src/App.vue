<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElDialog,
  ElEmpty, ElInput, ElOption, ElSelect, ElTag
} from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/descriptions/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/tag/style/css";

const snapshot = ref({ summary: {}, devices: [], generatedAt: null });
const connected = ref(false);
const errorMessage = ref("");
const search = ref("");
const filter = ref("all");
const previewVisible = ref(false);
const preview = ref({ studentName: "", capturedAt: null, dataUrl: "" });
let refreshTimer;

const summaryCards = computed(() => [
  { label: "Online", value: snapshot.value.summary.online ?? 0, tone: "online" },
  { label: "Students", value: snapshot.value.summary.total ?? 0 },
  { label: "Idle", value: snapshot.value.summary.idle ?? 0 },
  { label: "Blocked now", value: snapshot.value.summary.blocked ?? 0, tone: "danger" },
  { label: "Violations", value: snapshot.value.summary.violations ?? 0, tone: "warning" }
]);

const visibleDevices = computed(() => {
  const query = search.value.trim().toLowerCase();
  return snapshot.value.devices.filter(device => {
    const text = `${device.studentName} ${device.deviceLabel} ${device.activity.title} ${device.activity.domain}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesFilter = filter.value === "all" ||
      (filter.value === "online" && device.online) ||
      (filter.value === "offline" && !device.online) ||
      (filter.value === "blocked" && device.blocked) ||
      (filter.value === "idle" && device.online && device.idleState !== "active") ||
      (filter.value === "games" && device.gameDetected);
    return matchesQuery && matchesFilter;
  });
});

function relativeTime(timestamp) {
  if (!timestamp) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(timestamp).toLocaleString();
}

function status(device) {
  if (device.blocked) return { label: "Blocked", type: "danger" };
  if (!device.online) return { label: "Offline", type: "info" };
  if (device.idleState !== "active") return { label: device.idleState, type: "warning" };
  return { label: "Online", type: "success" };
}

function aiLabel(device) {
  if (device.aiStatus.state !== "complete") return device.aiStatus.state || "Not applicable";
  return `${device.aiStatus.category || "classified"}${device.aiStatus.cached ? " · cached" : ""}`;
}

async function refresh() {
  try {
    const response = await fetch("/v1/dashboard/snapshot", { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    snapshot.value = await response.json();
    connected.value = true;
    errorMessage.value = "";
  } catch (error) {
    connected.value = false;
    errorMessage.value = error.message;
  }
}

async function showPreview(device) {
  const response = await fetch(`/v1/dashboard/screenshot/${encodeURIComponent(device.deviceId)}`, { cache: "no-store" });
  if (!response.ok) return;
  const screenshot = await response.json();
  preview.value = { studentName: device.studentName, ...screenshot };
  previewVisible.value = true;
}

onMounted(() => {
  refresh();
  refreshTimer = setInterval(refresh, 3000);
});
onBeforeUnmount(() => clearInterval(refreshTimer));
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Study Shield</p>
        <h1>Classroom activity</h1>
      </div>
      <div class="live-state" :class="{ connected }">
        <span class="live-dot" />
        <div><strong>{{ connected ? "Live" : "Disconnected" }}</strong><small>{{ errorMessage || (snapshot.generatedAt ? `Updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : "Connecting") }}</small></div>
      </div>
    </header>

    <main>
      <el-alert title="Development dashboard: authentication is not enabled. Keep this server on a trusted test network." type="warning" :closable="false" show-icon />

      <section class="metrics" aria-label="Classroom summary">
        <el-card v-for="item in summaryCards" :key="item.label" shadow="never" class="metric" :class="item.tone">
          <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
        </el-card>
      </section>

      <section class="controls">
        <el-input v-model="search" clearable placeholder="Search student, device, site, or activity" aria-label="Search students or activity" />
        <el-select v-model="filter" aria-label="Filter devices">
          <el-option label="All devices" value="all" /><el-option label="Online" value="online" />
          <el-option label="Offline" value="offline" /><el-option label="Blocked" value="blocked" />
          <el-option label="Idle" value="idle" /><el-option label="Games detected" value="games" />
        </el-select>
      </section>

      <el-empty v-if="!snapshot.devices.length" description="No student devices yet. Reload the extension to send its first heartbeat." />
      <el-empty v-else-if="!visibleDevices.length" description="No devices match the current search and filter." />
      <section v-else class="device-grid" aria-live="polite">
        <el-card v-for="device in visibleDevices" :key="device.deviceId" shadow="hover" class="device-card" :class="{ blocked: device.blocked }">
          <template #header>
            <div class="card-head">
              <div class="identity"><h2>{{ device.studentName }}</h2><p>{{ device.deviceLabel }}</p></div>
              <el-tag :type="status(device).type" effect="light" round>{{ status(device).label }}</el-tag>
            </div>
          </template>
          <div class="activity">
            <strong>{{ device.activity.title || "No active page reported" }}</strong>
            <span>{{ device.activity.domain || "—" }}</span>
          </div>
          <div class="badges">
            <el-tag size="small" type="info">{{ device.activity.category || "web" }}</el-tag>
            <el-tag v-if="device.gameDetected" size="small" type="danger">Game detected</el-tag>
            <el-tag v-if="device.blocked" size="small" type="danger">Policy blocked</el-tag>
            <el-tag v-if="device.violations" size="small" type="warning">{{ device.violations }} violation{{ device.violations === 1 ? "" : "s" }}</el-tag>
          </div>
          <el-descriptions :column="2" direction="vertical" size="small" class="details">
            <el-descriptions-item label="Last activity">{{ relativeTime(device.lastActivityAt) }}</el-descriptions-item>
            <el-descriptions-item label="AI status">{{ aiLabel(device) }}</el-descriptions-item>
            <el-descriptions-item label="Network">{{ device.network.online ? device.network.effectiveType : "Offline" }}</el-descriptions-item>
            <el-descriptions-item label="Device health">{{ device.deviceHealth.status }}<template v-if="device.deviceHealth.extensionVersion"> · v{{ device.deviceHealth.extensionVersion }}</template></el-descriptions-item>
          </el-descriptions>
          <el-button class="preview-button" :disabled="!device.screenshot.available" @click="showPreview(device)">
            {{ device.screenshot.available ? "View recent screen preview" : `Screen preview: ${device.screenshot.status.replaceAll("_", " ")}` }}
          </el-button>
        </el-card>
      </section>
    </main>

    <el-dialog v-model="previewVisible" :title="`${preview.studentName} — recent screen preview`" width="min(900px, 92vw)" @closed="preview.dataUrl = ''">
      <p class="preview-time">Captured {{ relativeTime(preview.capturedAt) }}</p>
      <img v-if="preview.dataUrl" class="preview-image" :src="preview.dataUrl" alt="Recent student screen preview">
    </el-dialog>
  </div>
</template>
