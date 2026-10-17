module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: { path: "^src" },
      to: { circular: true },
    },
    {
      name: "modules-do-not-depend-on-workflows",
      severity: "error",
      from: { path: "^src/modules" },
      to: { path: "^src/workflows" },
    },
    {
      name: "modules-do-not-depend-on-app",
      severity: "error",
      from: { path: "^src/modules" },
      to: { path: "^src/app" },
    },
    {
      name: "modules-do-not-depend-on-worker",
      severity: "error",
      from: { path: "^src/modules" },
      to: { path: "^src/worker" },
    },
    {
      name: "modules-use-public-api",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/[^/]+/.+",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "workflows-use-module-public-api",
      severity: "error",
      from: { path: "^src/workflows/" },
      to: {
        path: "^src/modules/[^/]+/.+",
        pathNot: ["^src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "shared-does-not-depend-on-modules",
      severity: "error",
      from: { path: "^src/shared" },
      to: { path: "^src/modules" },
    },
    {
      name: "scheduling-does-not-depend-on-waitlist",
      severity: "error",
      from: { path: "^src/modules/scheduling" },
      to: { path: "^src/modules/waitlist" },
    },
    {
      name: "ui-primitives-do-not-depend-on-application-or-domain",
      severity: "error",
      from: { path: "^src/components/ui" },
      to: { path: "^src/(?:app|infrastructure|modules|worker|workflows)" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
  },
};
