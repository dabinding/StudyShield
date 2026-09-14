<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";

const rules = ref([]);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref("");
const query = ref("");
const actionFilter = ref("all");
const dialogVisible = ref(false);
const editingId = ref("");
const apiToken = ref(sessionStorage.getItem("studyShieldApiToken") ?? "");
const scopeTypes = ["global", "state", "district", "school", "class", "teacher", "student"];
const form = reactive({ scopeType: "global", scopeId: "global", action: "whitelist", matchType: "suffix", pattern: "", active: true });

watch(apiToken, value => {
  if (value) sessionStorage.setItem("studyShieldApiToken", value);
  else sessionStorage.removeItem("studyShieldApiToken");
});
watch(() => form.scopeType, value => {
  if (value === "global") form.scopeId = "global";
  else if (form.scopeId === "global") form.scopeId = "";
});

const visibleRules = computed(() => {
  const text = query.value.trim().toLowerCase();
  return rules.value.filter(rule => {
    const matchesAction = actionFilter.value === "all" || rule.action === actionFilter.value;
    const matchesText = !text || `${rule.pattern} ${rule.scopeType} ${rule.scopeId}`.toLowerCase().includes(text);
    return matchesAction && matchesText;
  });
});
const counts = computed(() => ({
  whitelist: rules.value.filter(rule => rule.action === "whitelist" && rule.active).length,
  blacklist: rules.value.filter(rule => rule.action === "blacklist" && rule.active).length,
  inactive: rules.value.filter(rule => !rule.active).length
}));

function authHeaders() { return apiToken.value ? { Authorization: `Bearer ${apiToken.value}` } : {}; }

async function loadRules() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const response = await fetch("/v1/policies/website/rules", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Policy API returned ${response.status}`);
    rules.value = body.rules;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, { scopeType: "global", scopeId: "global", action: "whitelist", matchType: "suffix", pattern: "", active: true });
}
function createRule(action = "whitelist") {
  editingId.value = "";
  resetForm();
  form.action = action;
  dialogVisible.value = true;
}
function editRule(rule) {
  editingId.value = rule.id;
  Object.assign(form, rule);
  dialogVisible.value = true;
}

async function saveRule() {
  if (!form.pattern.trim() || !form.scopeId.trim()) return ElMessage.warning("Enter a domain and scope ID.");
  saving.value = true;
  try {
    const path = editingId.value ? `/v1/policies/website/rules/${encodeURIComponent(editingId.value)}` : "/v1/policies/website/rules";
    const response = await fetch(path, {
      method: editingId.value ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(form)
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401) throw new Error("The backend API token is required or incorrect.");
      throw new Error(body.error || `Policy API returned ${response.status}`);
    }
    dialogVisible.value = false;
    ElMessage.success(editingId.value ? "Policy updated" : "Policy created");
    await loadRules();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    saving.value = false;
  }
}

onMounted(loadRules);
</script>

<template>
  <section class="page-heading heading-with-actions">
    <div><p class="eyebrow">Content controls</p><h1>Website policies</h1><p>Manage whitelist and blacklist rules across every organizational level.</p></div>
    <div class="heading-actions"><el-button @click="createRule('blacklist')">Add blacklist rule</el-button><el-button type="primary" @click="createRule('whitelist')">Add whitelist rule</el-button></div>
  </section>

  <el-alert title="Policy precedence" description="A matching blacklist always wins. Otherwise, the most-specific whitelist applies; unlisted sites are classified by AI." type="info" :closable="false" show-icon />

  <section class="policy-stats" aria-label="Policy summary">
    <div><span class="stat-dot allow" /><strong>{{ counts.whitelist }}</strong><span>Active whitelist</span></div>
    <div><span class="stat-dot block" /><strong>{{ counts.blacklist }}</strong><span>Active blacklist</span></div>
    <div><span class="stat-dot inactive" /><strong>{{ counts.inactive }}</strong><span>Inactive rules</span></div>
  </section>

  <section class="policy-panel">
    <div class="policy-toolbar">
      <el-input v-model="query" clearable placeholder="Search domain or scope" aria-label="Search policy rules" />
      <el-select v-model="actionFilter" aria-label="Filter policy action">
        <el-option label="All rules" value="all" /><el-option label="Whitelist" value="whitelist" /><el-option label="Blacklist" value="blacklist" />
      </el-select>
      <el-button @click="loadRules">Refresh</el-button>
    </div>
    <el-alert v-if="errorMessage" class="inline-alert" :title="errorMessage" type="error" :closable="false" />
    <el-table v-loading="loading" :data="visibleRules" stripe empty-text="No policy rules match this view">
      <el-table-column label="Domain" min-width="220"><template #default="{ row }"><strong class="domain-cell">{{ row.pattern }}</strong><small>{{ row.matchType === 'exact' ? 'Exact domain only' : 'Domain and subdomains' }}</small></template></el-table-column>
      <el-table-column label="Action" width="125"><template #default="{ row }"><el-tag :type="row.action === 'whitelist' ? 'success' : 'danger'" effect="light">{{ row.action }}</el-tag></template></el-table-column>
      <el-table-column label="Scope" min-width="170"><template #default="{ row }"><span class="scope-name">{{ row.scopeType }}</span><small>{{ row.scopeId }}</small></template></el-table-column>
      <el-table-column label="Status" width="105"><template #default="{ row }"><el-tag :type="row.active ? 'primary' : 'info'" effect="plain">{{ row.active ? 'Active' : 'Inactive' }}</el-tag></template></el-table-column>
      <el-table-column label="" width="90" align="right"><template #default="{ row }"><el-button link type="primary" @click="editRule(row)">Edit</el-button></template></el-table-column>
    </el-table>
  </section>

  <section class="token-panel">
    <div><strong>Backend API token</strong><p>Required for saving when <code>STUDY_SHIELD_API_TOKEN</code> is configured. Stored only for this browser session.</p></div>
    <el-input v-model="apiToken" type="password" show-password clearable placeholder="Paste API token" aria-label="Backend API token" />
  </section>

  <el-dialog v-model="dialogVisible" :title="editingId ? 'Edit website rule' : 'Add website rule'" width="min(560px, 94vw)">
    <el-form label-position="top" @submit.prevent="saveRule">
      <div class="form-grid">
        <el-form-item label="Action"><el-select v-model="form.action"><el-option label="Whitelist (allow)" value="whitelist" /><el-option label="Blacklist (block)" value="blacklist" /></el-select></el-form-item>
        <el-form-item label="Match"><el-select v-model="form.matchType"><el-option label="Domain and subdomains" value="suffix" /><el-option label="Exact domain only" value="exact" /></el-select></el-form-item>
        <el-form-item label="Scope level"><el-select v-model="form.scopeType"><el-option v-for="scope in scopeTypes" :key="scope" :label="scope[0].toUpperCase() + scope.slice(1)" :value="scope" /></el-select></el-form-item>
        <el-form-item label="Scope ID"><el-input v-model="form.scopeId" :disabled="form.scopeType === 'global'" placeholder="e.g. school-123" /></el-form-item>
      </div>
      <el-form-item label="Website domain"><el-input v-model="form.pattern" placeholder="example.org" /></el-form-item>
      <el-form-item label="Rule status"><el-switch v-model="form.active" active-text="Active" inactive-text="Inactive" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialogVisible = false">Cancel</el-button><el-button type="primary" :loading="saving" @click="saveRule">{{ editingId ? "Save changes" : "Create rule" }}</el-button></template>
  </el-dialog>
</template>
