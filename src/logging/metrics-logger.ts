import {hrtime} from 'process';
import {Event} from '../event.js';
import {Logger} from './logger.js';

interface Metric {
  name: string;
  matches: (event: Event) => boolean;
  count: number;
}

/**
 * A {@link Logger} that keeps track of metrics.
 */
export class MetricsLogger implements Logger {
  private readonly _actualLogger: Logger;
  private _startTime: [number, number] = hrtime();
  private readonly _metrics: Metric[] = [
    {
      name: 'Success',
      matches: (e: Event) => e.type === 'success',
      count: 0,
    },
    {
      name: 'Ran',
      matches: (e: Event) => e.type === 'success' && e.reason === 'exit-zero',
      count: 0,
    },
    {
      name: 'Skipped (fresh)',
      matches: (e: Event) => e.type === 'success' && e.reason === 'fresh',
      count: 0,
    },
    {
      name: 'Skipped (cached)',
      matches: (e: Event) => e.type === 'success' && e.reason === 'cached',
      count: 0,
    },
  ];

  constructor(actualLogger: Logger) {
    this._actualLogger = actualLogger;
  }

  /**
   * Update relevant metrics for an event and pass it along to the next logger.
   */
  log(event: Event): void {
    this._updateMetrics(event);
    this._actualLogger.log(event);
  }

  /**
   * Log the current metrics and reset the state of each metric.
   */
  printMetrics(): void {
    const successes = this._metrics[0].count;

    if (!successes) {
      this._resetMetrics();
      return;
    }

    const elapsed = this._getElapsedTime();
    const nameOffset = 16;

    const out: string[] = [
      `🏁 [metrics] Executed ${successes} script(s) in ${elapsed} seconds`,
    ];

    for (const metric of this._metrics.slice(1)) {
      const name = metric.name.padEnd(nameOffset);
      const count = metric.count;
      const percent = this._calculatePercentage(count, successes);

      out.push(`\t${name}: ${count} (${percent}%)`);
    }

    console.log(out.join('\n'));

    this._resetMetrics();
  }

  private _updateMetrics(event: Event): void {
    for (const metric of this._metrics) {
      if (metric.matches(event)) {
        metric.count++;
      }
    }
  }

  private _resetMetrics(): void {
    this._startTime = hrtime();

    for (const metric of this._metrics) {
      metric.count = 0;
    }
  }

  private _getElapsedTime(): string {
    const [seconds, nanoseconds] = hrtime(this._startTime);
    const time = seconds + nanoseconds / 1e9;
    return time.toFixed(2);
  }

  private _calculatePercentage(numerator: number, denominator: number): number {
    if (denominator === 0) {
      return 0;
    }

    return Math.floor((numerator / denominator) * 100);
  }
}
