/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  JsonFile,
  ArrayNode,
  JsonAstNode,
  NamedAstNode,
} from './util/ast.js';
import type {Failure} from './event.js';
import {PotentiallyValidScriptConfig} from './analyzer.js';

/**
 * The location on disk of an npm package.
 */
export interface PackageReference {
  /** Absolute path to an npm package directory. */
  packageDir: string;
}

/**
 * The name and package location of a script.
 */
export interface ScriptReference extends PackageReference {
  /** A concrete script name (no ./ or $WORKSPACES etc.) */
  name: string;
}

export interface Dependency<Config extends PotentiallyValidScriptConfig> {
  config: Config;
  astNode: JsonAstNode<string>;
}

export type ScriptConfig = NoOpScriptConfig | OneShotScriptConfig;

/**
 * A script that doesn't run or produce anything. A pass-through for
 * dependencies and/or files.
 */
export interface NoOpScriptConfig extends BaseScriptConfig {
  command: undefined;
}

/**
 * A script with a command that exits by itself.
 */
export interface OneShotScriptConfig extends BaseScriptConfig {
  /**
   * The shell command to execute.
   */
  command: JsonAstNode<string>;
}

/**
 * The name and location of a script, along with its full configuration.
 */
interface BaseScriptConfig extends ScriptReference {
  state: 'valid';

  /**
   * Scripts that must run before this one.
   *
   * Note that the {@link Analyzer} returns dependencies sorted by package
   * directory + script name, but the {@link Executor} then randomizes the order
   * during execution.
   */
  dependencies: Array<Dependency<ScriptConfig>>;

  /**
   * Input file globs for this script.
   *
   * If undefined, the input files are unknown (meaning the script cannot safely
   * be cached). If defined but empty, there are no input files (meaning the
   * script can safely be cached).
   */
  files: ArrayNode<string> | undefined;

  /**
   * Output file globs for this script.
   */
  output: ArrayNode<string> | undefined;

  /**
   * When to clean output:
   *
   * - true: Before the script executes, and before restoring from cache.
   * - false: Before restoring from cache.
   * - "if-file-deleted": If an input file has been deleted, and before restoring from
   *   cache.
   */
  clean: boolean | 'if-file-deleted';

  /**
   * The command string in the scripts section. i.e.:
   *
   * ```json
   *   "scripts": {
   *     "build": "tsc"
   *              ~~~~~
   *   }
   * ```
   */
  scriptAstNode: NamedAstNode<string>;

  /**
   * The entire config in the wireit section. i.e.:
   *
   * ```json
   *   "build": {
   *            ~
   *     "command": "tsc"
   *   ~~~~~~~~~~~~~~~~~~
   *   }
   *   ~
   * ```
   */
  configAstNode: NamedAstNode | undefined;

  /** The parsed JSON file that declared this script. */
  declaringFile: JsonFile;
  failures: Failure[];
}

/**
 * Convert a {@link ScriptReference} to a string that can be used as a key in a
 * Set, Map, etc.
 */
export const scriptReferenceToString = ({
  packageDir,
  name,
}: ScriptReference): ScriptReferenceString =>
  JSON.stringify([packageDir, name]) as ScriptReferenceString;

/**
 * Inverse of {@link scriptReferenceToString}.
 */
export const stringToScriptReference = (
  str: ScriptReferenceString
): ScriptReference => {
  const [packageDir, name] = JSON.parse(str) as [string, string];
  return {packageDir, name};
};

/**
 * Brand that ensures {@link stringToScriptReference} only takes strings that
 * were returned by {@link scriptReferenceToString}.
 */
export type ScriptReferenceString = string & {
  __ScriptReferenceStringBrand__: never;
};

/**
 * All meaningful inputs of a script. Used for determining if a script is fresh,
 * and as the key for storing cached output.
 */
export interface Fingerprint {
  /**
   * Whether the output for this script can be fresh or cached.
   *
   * True only if the "files" array was defined for this script, and for all of
   * this script's transitive dependencies.
   */
  cacheable: boolean;

  /** E.g. linux, win32 */
  platform: NodeJS.Platform;

  /** E.g. x64 */
  arch: string;

  /** E.g. 16.7.0 */
  nodeVersion: string;

  /**
   * The shell command from the Wireit config.
   */
  command: string | undefined;

  /**
   * The "clean" setting from the Wireit config.
   *
   * This is included in the fingerprint because switching from "false" to "true"
   * could produce different output, so a re-run should be triggered even if
   * nothing else changed.
   */
  clean: boolean | 'if-file-deleted';

  // Must be sorted.
  files: {[packageDirRelativeFilename: string]: Sha256HexDigest};

  /**
   * The "output" glob patterns from the Wireit config.
   *
   * This is included in the fingerprint because changing the output patterns
   * could produce different output when "clean" is true, and because it affects
   * which files get included in a cache entry.
   *
   * Note the undefined vs empty-array distinction is not meaningful here,
   * because both cases cause no files to be deleted, and the undefined case is
   * never cached anyway.
   */
  output: string[];

  // Must be sorted.
  dependencies: {[dependency: ScriptReferenceString]: Fingerprint};
}

/**
 * String serialization of a {@link Fingerprint}.
 */
export type FingerprintString = string & {
  __FingerprintStringBrand__: never;
};

/**
 * SHA256 hash hexadecimal digest of a file's content.
 */
export type Sha256HexDigest = string & {
  __Sha256HexDigestBrand__: never;
};
