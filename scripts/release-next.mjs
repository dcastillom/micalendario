#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const packageJsonPath = resolve(rootDir, "package.json");

const allowedBumps = new Set(["patch", "minor", "major"]);
const usage = [
  "Uso: node scripts/release-next.mjs [patch|minor|major] [--dry-run] [--remote <nombre>]",
  "",
  "Ejemplos:",
  "  node scripts/release-next.mjs patch",
  "  node scripts/release-next.mjs minor --dry-run",
].join("\n");

function printUsageAndExit(code = 0) {
  console.log(usage);
  process.exit(code);
}

function parseArgs(argv) {
  let bumpType = "patch";
  let dryRun = false;
  let remote = "origin";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--remote") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Falta el nombre del remoto despues de --remote.");
      }
      remote = nextArg;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Opcion no soportada: ${arg}`);
    }

    if (!allowedBumps.has(arg)) {
      throw new Error(`Tipo de version no soportado: ${arg}`);
    }

    bumpType = arg;
  }

  return { bumpType, dryRun, remote };
}

function readPackageJson() {
  const raw = readFileSync(packageJsonPath, "utf8");
  return {
    raw,
    data: JSON.parse(raw),
  };
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!match) {
    throw new Error(
      `La version actual (${version}) no tiene el formato semver simple x.y.z.`,
    );
  }

  const [, majorValue, minorValue, patchValue] = match;
  return {
    major: Number(majorValue),
    minor: Number(minorValue),
    patch: Number(patchValue),
  };
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);

  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

function bumpVersion(version, bumpType) {
  const parsedVersion = parseVersion(version);
  let major = parsedVersion.major;
  let minor = parsedVersion.minor;
  let patch = parsedVersion.patch;

  if (bumpType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function runCommand(command, args, { capture = false } = {}) {
  if (capture) {
    return execFileSync(command, args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  execFileSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  return "";
}

function hasLocalTag(tagName) {
  try {
    runCommand("git", ["rev-parse", "-q", "--verify", `refs/tags/${tagName}`], {
      capture: true,
    });
    return true;
  } catch {
    return false;
  }
}

function getLatestLocalTagVersion() {
  const tagsOutput = runCommand("git", ["tag", "--list", "v*"], {
    capture: true,
  });

  const versions = tagsOutput
    .split("\n")
    .map((tagName) => tagName.trim())
    .filter(Boolean)
    .map((tagName) => tagName.replace(/^v/, ""))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version));

  if (versions.length === 0) {
    return null;
  }

  return versions.sort(compareVersions).at(-1) ?? null;
}

function ensureGitConfig() {
  const userName = runCommand("git", ["config", "user.name"], { capture: true });
  const userEmail = runCommand("git", ["config", "user.email"], { capture: true });

  if (!userName || !userEmail) {
    throw new Error(
      "Git necesita user.name y user.email configurados antes de crear la release.",
    );
  }
}

function inspectRepo(remote) {
  const status = runCommand("git", ["status", "--porcelain"], { capture: true });
  const branch = runCommand("git", ["branch", "--show-current"], { capture: true });
  if (!branch) {
    throw new Error("No se puede publicar desde un HEAD desacoplado.");
  }

  runCommand("git", ["remote", "get-url", remote], { capture: true });
  ensureGitConfig();

  return {
    branch,
    isDirty: Boolean(status),
  };
}

function writeNextVersion(nextVersion, packageJson) {
  const nextPackageJson = {
    ...packageJson,
    version: nextVersion,
  };

  writeFileSync(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { raw, data: packageJson } = readPackageJson();
  const currentVersion = packageJson.version;
  const latestTagVersion = getLatestLocalTagVersion();
  const releaseBaseVersion =
    latestTagVersion && compareVersions(latestTagVersion, currentVersion) > 0
      ? latestTagVersion
      : currentVersion;
  const nextVersion = bumpVersion(releaseBaseVersion, args.bumpType);
  const tagName = `v${nextVersion}`;
  const repoState = inspectRepo(args.remote);

  if (hasLocalTag(tagName)) {
    throw new Error(`La etiqueta local ${tagName} ya existe.`);
  }

  console.log(`Version en package.json: ${currentVersion}`);
  console.log(`Ultima tag local: ${latestTagVersion ?? "ninguna"}`);
  console.log(`Version base para release: ${releaseBaseVersion}`);
  console.log(`Siguiente version: ${nextVersion}`);
  console.log(`Branch actual: ${repoState.branch}`);
  console.log(`Remoto: ${args.remote}`);
  console.log(
    `Estado del repo: ${repoState.isDirty ? "con cambios locales" : "limpio"}`,
  );

  if (args.dryRun) {
    console.log("");
    console.log("Dry run: no se han modificado archivos ni se ha hecho push.");
    return;
  }

  if (repoState.isDirty) {
    throw new Error(
      "El repositorio tiene cambios sin commitear. Deja el arbol limpio antes de lanzar la release.",
    );
  }

  let packageJsonWritten = false;
  let commitCreated = false;
  let tagCreated = false;

  try {
    writeNextVersion(nextVersion, packageJson);
    packageJsonWritten = true;

    runCommand("git", ["add", "package.json"]);
    runCommand("git", ["commit", "-m", `chore: release ${tagName}`]);
    commitCreated = true;

    runCommand("git", ["tag", "-a", tagName, "-m", tagName]);
    tagCreated = true;

    runCommand("git", ["push", args.remote, repoState.branch]);
    runCommand("git", ["push", args.remote, tagName]);

    console.log("");
    console.log(
      `Release ${tagName} enviada. GitHub Actions deberia iniciar la publicacion automaticamente.`,
    );
  } catch (error) {
    if (packageJsonWritten && !commitCreated) {
      writeFileSync(packageJsonPath, raw);
    }

    console.error("");
    console.error("No se pudo completar el flujo de release.");

    if (commitCreated) {
      console.error(
        `El commit de release ya existe localmente${tagCreated ? ` y la etiqueta ${tagName} tambien` : ""}.`,
      );
      console.error("Revisa el estado local antes de reintentar.");
    }

    throw error;
  }
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
