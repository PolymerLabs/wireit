/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {suite} from 'uvu';
import * as assert from 'uvu/assert';
import {timeout} from './util/uvu-timeout.js';
import {WireitTestRig} from './util/test-rig.js';
import {Executor, registerExecutorConstructorHook} from '../executor.js';
import {Analyzer} from '../analyzer.js';
import {DefaultLogger} from '../logging/default-logger.js';
import {WorkerPool} from '../util/worker-pool.js';
import {registerExecutionConstructorHook} from '../execution/base.js';
import {Deferred} from '../util/deferred.js';

const test = suite<{rig: WireitTestRig}>();

let numLiveExecutors = 0;
let numLiveExecutions = 0;

test.before.each(async (ctx) => {
  try {
    const executorFinalizationRegistry = new FinalizationRegistry(() => {
      numLiveExecutors--;
    });
    registerExecutorConstructorHook((executor) => {
      numLiveExecutors++;
      executorFinalizationRegistry.register(executor, null);
    });

    const executionFinalizationRegistry = new FinalizationRegistry(() => {
      numLiveExecutions--;
    });
    registerExecutionConstructorHook((execution) => {
      numLiveExecutions++;
      executionFinalizationRegistry.register(execution, null);
    });
    ctx.rig = new WireitTestRig();
    await ctx.rig.setup();
  } catch (error) {
    // Uvu has a bug where it silently ignores failures in before and after,
    // see https://github.com/lukeed/uvu/issues/191.
    console.error('uvu before error', error);
    process.exit(1);
  }
});

test.after.each(async (ctx) => {
  try {
    numLiveExecutors = 0;
    numLiveExecutions = 0;
    await ctx.rig.cleanup();
  } catch (error) {
    // Uvu has a bug where it silently ignores failures in before and after,
    // see https://github.com/lukeed/uvu/issues/191.
    console.error('uvu after error', error);
    process.exit(1);
  }
});

async function retryWithGcUntilCallbackDoesNotThrow(
  cb: () => void
): Promise<void> {
  for (const wait of [0, 10, 100, 500, 1000]) {
    global.gc();
    try {
      cb();
      return;
    } catch {
      // Ignore
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  cb();
}

test(
  'standard garbage collection',
  timeout(async ({rig}) => {
    const standard = await rig.newCommand();
    await rig.writeAtomic({
      'package.json': {
        scripts: {
          standard: 'wireit',
        },
        wireit: {
          standard: {
            command: standard.command,
          },
        },
      },
    });

    const logger = new DefaultLogger(rig.temp);
    const script = await new Analyzer().analyze(
      {packageDir: rig.temp, name: 'standard'},
      []
    );
    if (!script.config.ok) {
      for (const error of script.config.error) {
        logger.log(error);
      }
      throw new Error(`Analysis error`);
    }

    const workerPool = new WorkerPool(Infinity);
    const abort = new Deferred<void>();

    const numIterations = 10;
    for (let i = 0; i < numIterations; i++) {
      const executor = new Executor(
        script.config.value,
        logger,
        workerPool,
        undefined,
        'no-new',
        abort,
        undefined
      );
      const resultPromise = executor.execute();
      assert.ok(numLiveExecutors >= 1);
      assert.ok(numLiveExecutions >= 1);
      (await standard.nextInvocation()).exit(0);
      const result = await resultPromise;
      if (!result.ok) {
        for (const error of result.error) {
          logger.log(error);
        }
        throw new Error(`Execution error`);
      }
    }

    await retryWithGcUntilCallbackDoesNotThrow(() => {
      assert.equal(numLiveExecutors, 0);
      assert.equal(numLiveExecutions, 0);
    });
    assert.equal(standard.numInvocations, numIterations);
  })
);

test.run();
