<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import HomePage from "./pages/HomePage.vue";
import PoliciesPage from "./pages/PoliciesPage.vue";
import ClassroomPage from "./pages/ClassroomPage.vue";

const routes = {
  "/dashboard": { name: "Overview", component: HomePage },
  "/dashboard/": { name: "Overview", component: HomePage },
  "/dashboard/policies": { name: "Website policies", component: PoliciesPage },
  "/dashboard/classroom": { name: "Classroom activity", component: ClassroomPage }
};
const pathname = ref(window.location.pathname);
const route = computed(() => routes[pathname.value] ?? routes["/dashboard"]);

function navigate(path) {
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
  pathname.value = path;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handlePopState() { pathname.value = window.location.pathname; }

onMounted(() => window.addEventListener("popstate", handlePopState));
onBeforeUnmount(() => window.removeEventListener("popstate", handlePopState));
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <a class="brand" href="/dashboard" @click.prevent="navigate('/dashboard')">
        <span class="brand-mark" aria-hidden="true">S</span>
        <span><strong>Study Shield</strong><small>Teacher dashboard</small></span>
      </a>
      <nav aria-label="Dashboard navigation">
        <a v-for="(item, path) in routes" v-show="path !== '/dashboard/'" :key="path" :href="path"
          :class="{ active: route.name === item.name }" @click.prevent="navigate(path)">{{ item.name }}</a>
      </nav>
    </header>
    <main class="page-container">
      <component :is="route.component" @navigate="navigate" />
    </main>
  </div>
</template>
