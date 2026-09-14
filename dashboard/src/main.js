import { createApp } from "vue";
import {
  ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElDialog, ElEmpty,
  ElForm, ElFormItem, ElInput, ElLoading, ElOption, ElSelect, ElSwitch, ElTable,
  ElTableColumn, ElTag
} from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/descriptions/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/loading/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/switch/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/tag/style/css";
import "./styles.css";
import App from "./App.vue";

const app = createApp(App);
for (const component of [
  ElAlert, ElButton, ElCard, ElDescriptions, ElDescriptionsItem, ElDialog, ElEmpty,
  ElForm, ElFormItem, ElInput, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTag
]) app.component(component.name, component);
app.directive("loading", ElLoading.directive);
app.mount("#app");
