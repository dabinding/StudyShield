<script setup>
defineEmits(["navigate"]);

const destinations = [
  {
    path: "/dashboard/classroom", eyebrow: "Live monitoring", title: "Classroom activity",
    description: "See online students, active sites, blocked activity, device health, and recent screen previews.",
    action: "Open classroom"
  },
  {
    path: "/dashboard/policies", eyebrow: "Content controls", title: "Website policies",
    description: "Create and edit hierarchical whitelist and blacklist rules for your organization.",
    action: "Manage policies"
  }
];
</script>

<template>
  <section class="hero">
    <p class="eyebrow">Study Shield</p>
    <h1>Keep learning focused.</h1>
    <p class="hero-copy">Monitor classroom activity and manage website access from one clear, school-friendly workspace.</p>
  </section>

  <section class="destination-grid" aria-label="Dashboard pages">
    <article v-for="item in destinations" :key="item.path" class="destination-card">
      <p class="card-eyebrow">{{ item.eyebrow }}</p>
      <h2>{{ item.title }}</h2>
      <p>{{ item.description }}</p>
      <el-button type="primary" @click="$emit('navigate', item.path)">{{ item.action }} <span aria-hidden="true">→</span></el-button>
    </article>
  </section>

  <el-alert class="development-alert" title="Development environment" description="Teacher authentication is not enabled. Keep this server on a trusted test network." type="warning" :closable="false" show-icon />
</template>
