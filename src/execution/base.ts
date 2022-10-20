/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {shuffle} from '../util/shuffle.js';
import {Fingerprint} from '../fingerprint.js';

import type {Result} from '../error.js';
import type {Executor} from '../executor.js';
import type {ScriptConfig, ScriptReference} from '../config.js';
import type {Logger} from '../logging/logger.js';
import type {Failure} from '../event.js';

export type ExecutionResult = Result<Fingerprint, Failure[]>;

/**
 * What to do when a script failure occurs:
 *
 * - `no-new`: Allow running scripts to finish, but don't start new ones.
 * - `continue`: Allow running scripts to finish, and start new ones unless a
 *   dependency failed.
 * - `kill`: Immediately kill running scripts, and don't start new ones.
 */
export type FailureMode = 'no-new' | 'continue' | 'kill';

/**
 * A single execution of a specific script.
 */
export abstract class BaseExecution<T extends ScriptConfig> {
  protected readonly _config: T;
  protected readonly _executor: Executor;
  protected readonly _logger: Logger;

  protected constructor(config: T, executor: Executor, logger: Logger) {
    this._config = config;
    this._executor = executor;
    this._logger = logger;
  }

  /**
   * Execute all of this script's dependencies.
   */
  protected async _executeDependencies(): Promise<
    Result<Array<[ScriptReference, Fingerprint]>, Failure[]>
  > {
    // Randomize the order we execute dependencies to make it less likely for a
    // user to inadvertently depend on any specific order, which could indicate
    // a missing edge in the dependency graph.
    shuffle(this._config.dependencies);

    const dependencyResults = await Promise.all(
      this._config.dependencies.map((dependency) => {
        return this._executor.execute(dependency.config);
      })
    );
    const results: Array<[ScriptReference, Fingerprint]> = [];
    const errors = new Set<Failure>();
    for (let i = 0; i < dependencyResults.length; i++) {
      const result = dependencyResults[i];
      if (!result.ok) {
        for (const error of result.error) {
          errors.add(error);
        }
      } else {
        results.push([this._config.dependencies[i].config, result.value]);
      }
    }
    if (errors.size > 0) {
      return {ok: false, error: [...errors]};
    }
    return {ok: true, value: results};
  }
}
