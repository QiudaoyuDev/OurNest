const ENVIRONMENTS = {
  test: {
    id: "lzx-d2g06cmqi4267e6a7",
    label: "测试环境",
  },
  production: {
    id: "",
    label: "生产环境",
  },
};

const LOCAL_OVERRIDE = "";

function resolveEnvironment(envVersion = "develop") {
  const key = LOCAL_OVERRIDE || (envVersion === "release" ? "production" : "test");
  const environment = ENVIRONMENTS[key];
  if (!environment) throw new Error("UNKNOWN_CLOUD_ENVIRONMENT");
  if (!environment.id) throw new Error("CLOUD_ENVIRONMENT_ID_MISSING:" + key);
  return { key, ...environment };
}

module.exports = { ENVIRONMENTS, resolveEnvironment };
