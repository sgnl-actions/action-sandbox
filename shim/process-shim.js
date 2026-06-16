// process-shim.js — Process and OS shim objects for sandboxed actions.

export const processShim = {
  env: {},
  cwd: () => "/app",
  version: "v22.0.0",
  versions: { node: "22.0.0" },
  hrtime: () => [0, 0],
  emitWarning: () => {},
  geteuid: () => 0,
};

export const osShim = {
  homedir: () => "/tmp",
  tmpdir: () => "/tmp",
  platform: () => "linux",
  arch: () => "x64",
  type: () => "Linux",
  release: () => "6.0.0",
  hostname: () => "sandbox",
  cpus: () => [{ model: "sandbox", speed: 0, times: {} }],
  totalmem: () => 0,
  freemem: () => 0,
  EOL: "\n",
};
