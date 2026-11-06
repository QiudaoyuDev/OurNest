import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const automator = require("miniprogram-automator");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const update = process.argv.includes("--update");
const cliPath =
  process.argv.find((argument) => argument.startsWith("--cli="))?.slice(6) ||
  process.env.TL_WECHAT_CLI;
if (!cliPath) throw new Error("Set TL_WECHAT_CLI to the WeChat developer tools CLI path.");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ournest-analysis-visual-"));
const mini = path.join(fixture, "miniprogram");
fs.cpSync(path.join(root, "miniprogram"), mini, { recursive: true });
const app = JSON.parse(fs.readFileSync(path.join(mini, "app.json"), "utf8"));
app.pages = ["pages/visual-analysis/index"];
fs.writeFileSync(path.join(mini, "app.json"), JSON.stringify(app, null, 2));
fs.writeFileSync(
  path.join(mini, "app.js"),
  'App({ globalData: { loggedIn: true, currentLedger: { _id: "fixture", name: "我们的小家", type: "personal" } }, async loginWithWechat() {} });\n'
);
fs.copyFileSync(
  path.join(root, "tests/visual-fixtures/analysis-data.js"),
  path.join(mini, "services/ledger.service.js")
);
const page = path.join(mini, "pages/visual-analysis");
fs.mkdirSync(page, { recursive: true });
fs.writeFileSync(
  path.join(page, "index.json"),
  JSON.stringify({ usingComponents: { "tl-tab-analysis": "/components/tl-tab-analysis/index" } })
);
fs.writeFileSync(
  path.join(page, "index.js"),
  'Page({ onReady() { const view = this.selectComponent("#analysis"); view.setData({ anchor: "2025-11" }); view.loadAnalysis(); } });\n'
);
fs.writeFileSync(
  path.join(page, "index.wxml"),
  '<view class="visual-page"><tl-navbar title="分析"></tl-navbar><tl-tab-analysis id="analysis"></tl-tab-analysis></view>\n'
);
fs.writeFileSync(
  path.join(page, "index.wxss"),
  ".visual-page { display: flex; flex-direction: column; height: 100vh; background: var(--tl-color-page); }\n"
);
fs.writeFileSync(
  path.join(fixture, "project.config.json"),
  JSON.stringify(
    {
      appid: "touristappid",
      compileType: "miniprogram",
      miniprogramRoot: "miniprogram/",
      setting: { es6: true, enhance: true },
      libVersion: "2.20.1",
    },
    null,
    2
  )
);
const baselineDir = path.join(root, "tests/visual-baseline");
const actualDir = path.join(root, "tests/visual-actual");
fs.mkdirSync(actualDir, { recursive: true });
let miniProgram;
let cliChild;
let cliFinished = false;
const pendingBaselines = [];
try {
  if (process.platform === "win32") {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const portNumber = server.address().port;
        server.close(() => resolve(portNumber));
      });
    });
    const quote = (value) => value.replaceAll("'", "''");
    const command = `& '${quote(cliPath)}' auto --project '${quote(fixture)}' --auto-port ${port} --trust-project`;
    cliChild = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    cliChild.on("exit", () => {
      cliFinished = true;
    });
    let launchOutput = "";
    cliChild.stdout.on("data", (data) => {
      launchOutput += data.toString();
    });
    cliChild.stderr.on("data", (data) => {
      launchOutput += data.toString();
    });
    for (let attempt = 0; attempt < 30 && !miniProgram; attempt += 1) {
      try {
        miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
      } catch (_error) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!miniProgram)
      throw new Error(`Developer tools automation unavailable: ${launchOutput.slice(-600)}`);
  } else {
    miniProgram = await automator.launch({
      projectPath: fixture,
      cliPath,
      trustProject: true,
      timeout: 60000,
    });
  }
  const current = await miniProgram.currentPage();
  if (!current || current.path !== "pages/visual-analysis/index")
    throw new Error("Connected developer tools instance is not the isolated analysis fixture");
  await current.waitFor(1500);
  const component = await current.$("#analysis");
  if (!component) throw new Error("Analysis fixture component did not load");
  const state = await component.data();
  if (state.loading || state.error || !state.dashboardView || state.dashboardView.recordCount !== 4)
    throw new Error("Analysis fixture did not reach its expected ready state");
  const cases = [
    { name: "analysis-overview", section: null },
    { name: "analysis-calendar", section: "calendar" },
    { name: "analysis-category", section: "category" },
    { name: "analysis-account", section: "account" },
  ];
  for (const item of cases) {
    if (item.section === "calendar") {
      const scroll = await component.$(".analysis-scroll");
      const calendar = await component.$(".dashboard-calendar");
      if (!scroll || !calendar) throw new Error("Calendar fixture is unavailable");
      const [scrollOffset, calendarOffset, scrollTop] = await Promise.all([
        scroll.offset(),
        calendar.offset(),
        scroll.property("scrollTop"),
      ]);
      await scroll.scrollTo(0, Math.max(0, scrollTop + calendarOffset.top - scrollOffset.top - 80));
      await current.waitFor(400);
    } else if (item.section) {
      const control = await component.$(`[data-section="${item.section}"]`);
      if (!control) throw new Error(`Missing section control: ${item.section}`);
      await control.tap();
      await current.waitFor(400);
    }
    const actual = path.join(actualDir, `${item.name}.png`);
    const baseline = path.join(baselineDir, `${item.name}.png`);
    await miniProgram.screenshot({ path: actual });
    if (update) {
      pendingBaselines.push({ actual, baseline, name: item.name });
    } else {
      if (!fs.existsSync(baseline)) throw new Error(`Missing baseline: ${item.name}`);
      const a = PNG.sync.read(fs.readFileSync(actual));
      const b = PNG.sync.read(fs.readFileSync(baseline));
      if (a.width !== b.width || a.height !== b.height)
        throw new Error(`Size mismatch: ${item.name}`);
      const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.15 });
      if (diff / (a.width * a.height) > 0.01) throw new Error(`Visual mismatch: ${item.name}`);
      console.log(`Passed ${item.name}`);
    }
  }
  for (const item of pendingBaselines) {
    fs.copyFileSync(item.actual, item.baseline);
    console.log(`Updated ${item.name}`);
  }
} finally {
  if (miniProgram) await miniProgram.close();
  if (cliChild && !cliFinished) {
    cliChild.kill();
    console.warn(`CLI process did not finish; temporary fixture preserved at ${fixture}`);
  } else {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
